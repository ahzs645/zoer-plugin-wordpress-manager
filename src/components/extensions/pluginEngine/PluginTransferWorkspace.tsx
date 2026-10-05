import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, DatabaseBackup, Download, Replace, Upload } from "lucide-react";
import { Btn, CheckboxField, Select, fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import type { ImportOptions, TransferAction, WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { engineKeys, startEngineAction, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { applyExportCapabilities, defaultReplaceTables, exportOptionsErrors, exportOptionsForAction, hasCapability, importOptionsErrors, replaceJobOptions, REQUIRES_040, TRANSFER_ACTIONS } from "../../../lib/wordpress-transfer/options";
import ConfirmDestination, { destinationConfirmed } from "../wordpressTransfer/ConfirmDestination";
import DatabasePanel, { SELECTABLE_TABLE, tableItems, unselectableTablesHint } from "../wordpressTransfer/DatabasePanel";
import FilesPanel from "../wordpressTransfer/FilesPanel";
import ReplacePanel from "../wordpressTransfer/ReplacePanel";
import SafetyPanel from "../wordpressTransfer/SafetyPanel";
import { ItemPicker, OptionToggle } from "../wordpressTransfer/TransferPanel";
import { actionAvailability } from "../wordpressTransfer/TransferWorkspace";
import { ACTION_LABELS } from "../wordpressTransfer/transferLabels";
import { initialAction, initialDraft, switchAction, type DraftUpdate, type TransferDraft } from "../wordpressTransfer/draft";
import PluginPulls from "./PluginPulls";
import PluginPushFlow from "./PluginPushFlow";
import PluginSiteRuns from "./PluginSiteRuns";
import PluginTransferHistory from "./PluginTransferHistory";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runsOfSite, SITE_RUN_ACTIONS } from "./runState";
import type { PullRecord } from "./records";

const ICONS: Record<TransferAction, React.ReactNode> = {
  pull: <Download className="h-4 w-4" aria-hidden="true" />, push: <Upload className="h-4 w-4" aria-hidden="true" />,
  replace: <Replace className="h-4 w-4" aria-hidden="true" />, backup: <DatabaseBackup className="h-4 w-4" aria-hidden="true" />,
  export: <Archive className="h-4 w-4" aria-hidden="true" />,
};
/** Actions sharing the `site-transfer` lock group: one may run per site at a time. */
/** Dry run starts on for the actions that write to the site. */
const DRY_RUN_DEFAULTS: Record<TransferAction, boolean> = { pull: false, backup: false, export: false, push: true, replace: true };

function PullStart({ siteId, connection, diagnostics, diagnosticsLoading, draft, update, dryRun, onDryRun, busy }: {
  siteId: string; connection: ZoerConnectConnection; diagnostics: WordPressDiagnostics | null | undefined; diagnosticsLoading: boolean;
  draft: TransferDraft; update: DraftUpdate; dryRun: boolean; onDryRun: (value: boolean) => void; busy: boolean;
}) {
  const client = useQueryClient();
  const action = draft.action as "pull" | "backup" | "export";
  const caps = connection.status.capabilities;
  const options = exportOptionsForAction(action, draft.exportOptions);
  const gated = applyExportCapabilities(options, caps);
  const canPauseSource = options.resources.database && !options.resources.core && caps?.resumableDatabaseExport === true && connection.status.push;
  const [pause, setPause] = useState({ action, paused: false, writersStopped: false });
  const pauseSource = canPauseSource && pause.action === action && pause.paused;
  const writersStopped = pause.action === action && pause.writersStopped;
  const errors = [...exportOptionsErrors(gated.options), ...(pauseSource && !writersStopped ? ["Confirm source writers are stopped before starting."] : [])];
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const setOptions = (next: typeof options) => update(d => ({ ...d, exportOptions: next }));
  async function start() {
    setStarting(true); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.pull, { siteId, pullId: newHexId(), exportOptions: gated.options, action,
        ...(pauseSource ? { snapshotMode: "maintenance", sourceQuiescenceAccepted: true } : {}), ...(dryRun ? { dryRun: true } : {}) });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The pull could not start.")); }
    finally { setStarting(false); }
  }
  return <div className="min-w-0 space-y-3">
    <p className="text-xs text-text-secondary">{action === "backup"
      ? "Saves a verified database snapshot on the Zoer server. Download or delete it below."
      : action === "export"
        ? "Downloads the selected resources to the Zoer server; then save the database (.sql) or an archive (.tar.gz) to this device from the list below."
        : "Downloads the selected resources to the Zoer server. Pause keeps your progress; Resume continues from the saved checkpoint. Nothing is imported or published."}</p>
    <DatabasePanel exportOptions={options} onExport={setOptions} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} sourceCaps={caps} lockDatabase={action === "backup"} defaultOpen={action === "backup"} />
    {action !== "backup" && <FilesPanel action={action} options={options} onChange={setOptions} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} sourceCaps={caps} />}
    {canPauseSource && <div className="space-y-2">
      <OptionToggle label="Pause source while exporting database" checked={pauseSource} onChange={value => setPause({ action, paused: value, writersStopped: false })} description="For large databases. WordPress requests pause until the database is saved or you cancel." />
      {pauseSource && <OptionToggle label="Background jobs and external database writers are stopped" checked={writersStopped} onChange={value => setPause({ action, paused: true, writersStopped: value })} description="Stop earlier requests, scheduled jobs and direct database edits first. An idle pause expires after one hour." />}
    </div>}
    <CheckboxField label="Dry run" description="Downloads into a scratch file set and stops before the download is marked ready. Nothing is kept for pushes or copies." checked={dryRun} onChange={onDryRun} />
    {gated.downgraded.map(label => <p key={label} className="text-xs text-status-warning">{label} need Zoer Connect 0.4.0 on this site and will not be applied.</p>)}
    {errors.map(message => <p key={message} className="text-xs text-status-error">{message}</p>)}
    {busy && <p className="text-xs text-status-warning">Another transfer is running on this site. Wait for it, or pause or cancel it below.</p>}
    <Btn variant="primary" className="w-full sm:w-auto" disabled={starting || busy || errors.length > 0} loading={starting} onClick={() => void start()}>
      {dryRun ? "Start dry run" : action === "backup" ? "Back up database" : action === "export" ? "Start export" : "Start pull"}
    </Btn>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
  </div>;
}

function ReplaceStart({ siteId, connection, diagnostics, diagnosticsLoading, draft, update, dryRun, onDryRun, busy }: {
  siteId: string; connection: ZoerConnectConnection; diagnostics: WordPressDiagnostics | null | undefined; diagnosticsLoading: boolean;
  draft: TransferDraft; update: DraftUpdate; dryRun: boolean; onDryRun: (value: boolean) => void; busy: boolean;
}) {
  const client = useQueryClient();
  const status = connection.status;
  const caps = status.capabilities;
  const shared = status.migrationMode === "shared-replacement";
  const target = connection.url;
  const [confirm, setConfirm] = useState("");
  const [writers, setWriters] = useState(false);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const items = tableItems(diagnostics).filter(item => item.value !== "users" && item.value !== "usermeta");
  const tables = draft.exportOptions.database.tables;
  const setTables = (value: "all" | string[]) => update(d => ({ ...d, exportOptions: { ...d.exportOptions, database: { ...d.exportOptions.database, tables: value } } }));
  const options = { ...draft.importOptions, review: true, fence: "activation" as const };
  const setOptions = (next: ImportOptions) => update(d => ({ ...d, importOptions: next }));
  const errors = importOptionsErrors(options, { requireCustom: true });
  const selectedTables = tables === "all" ? [] : tables.filter(table => table !== "users" && table !== "usermeta" && SELECTABLE_TABLE.test(table));
  const chosenTables = tables === "all" ? null : selectedTables;
  const ready = status.push && status.publish && !busy && !starting && !errors.length && (!chosenTables || chosenTables.length > 0) && destinationConfirmed(target, confirm) && writers;
  async function start() {
    setStarting(true); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.replace, {
        siteId, importId: newHexId(), confirmTarget: confirm.trim(), importOptions: replaceJobOptions(options, hasCapability(caps, "cachePurge")),
        ...(chosenTables ? { tables: chosenTables } : {}), ...(shared ? { replacementAccepted: true } : { wordpressOnlyWriters: true }), ...(dryRun ? { dryRun: true } : {}),
      }, { approval: true });
      setConfirm(""); setWriters(false);
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "Find & Replace could not be requested.")); }
    finally { setStarting(false); }
  }
  if (!hasCapability(caps, "siteReplace")) return <p className="text-sm text-status-warning">{REQUIRES_040}. Update the plugin in <a className="underline" href={`${target.replace(/\/+$/, "")}/wp-admin/plugins.php`} target="_blank" rel="noreferrer">WordPress → Plugins</a> to run Find &amp; Replace.</p>;
  return <div className="min-w-0 space-y-4">
    <p className="text-xs text-text-secondary">The plugin engine snapshots this site's database, applies your rules to a staged copy and stops for your review. Nothing changes on the live site until you approve.</p>
    <section className="min-w-0 space-y-2">
      <label className="block text-sm"><span className={fieldLabelClass}>Tables</span>
        <Select aria-label="Tables to search" className={selectClass("default", "w-full")} value={tables === "all" ? "all" : "selected"} onChange={event => setTables(event.target.value === "all" ? "all" : defaultReplaceTables(items.filter(i => !i.disabled).map(i => i.value)))}>
          <option value="all">All tables except users and user meta</option>
          <option value="selected" disabled={!items.length}>Only selected tables</option>
        </Select>
      </label>
      {tables !== "all" && <ItemPicker label="Tables" items={items} selected={selectedTables} onChange={setTables} emptyText={diagnosticsLoading ? "Loading tables…" : "No table inventory reported."} query={query} onQuery={setQuery} />}
      {tables !== "all" && unselectableTablesHint(items) && <p className="text-xs text-text-secondary">{unselectableTablesHint(items)}</p>}
    </section>
    <ReplacePanel options={options} onChange={setOptions} caps={caps} destinationUrl={target} replaceOnly defaultOpen />
    <OptionToggle label="Also replace in post GUIDs" checked={options.replaceGuids} onChange={value => setOptions({ ...options, replaceGuids: value })} />
    <SafetyPanel options={options} onChange={setOptions} caps={caps} lockFence />
    {errors.map(message => <p key={message} className="text-xs text-status-error">{message}</p>)}
    <CheckboxField label="Dry run" description="Plans the replacement against this site and stops. Nothing is staged or activated." checked={dryRun} onChange={onDryRun} />
    <ConfirmDestination target={target} value={confirm} onChange={setConfirm} shared={shared} writers={writers} onWriters={setWriters} disabled={starting} />
    {busy && <p className="text-xs text-status-warning">Another transfer is running on this site. Finish, roll back or cancel it below before starting another.</p>}
    <Btn variant="primary" className="w-full sm:w-auto" disabled={!ready} loading={starting} onClick={() => void start()}>{dryRun ? "Request dry run" : "Request replacement preview"}</Btn>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
  </div>;
}

/**
 * The transfer workspace of a site on the plugin engine. Same action picker and option panels as
 * the legacy `TransferWorkspace`; transfers run as this plugin's resumable actions.
 */
export default function PluginTransferWorkspace({ siteId, siteName, connection, diagnostics, diagnosticsLoading, onLocalCopy }: {
  siteId: string; siteName: string; connection: ZoerConnectConnection; diagnostics: WordPressDiagnostics | null | undefined; diagnosticsLoading: boolean;
  onLocalCopy?: (pull: PullRecord) => void;
}) {
  const client = useQueryClient();
  const availability = actionAvailability(connection);
  const [draft, setDraft] = useState(() => initialDraft(initialAction(availability)));
  const update: DraftUpdate = fn => setDraft(fn);
  const [dryRuns, setDryRuns] = useState(DRY_RUN_DEFAULTS);
  const action = draft.action;
  const dryRunFor = (key: TransferAction) => ({ dryRun: dryRuns[key], onDryRun: (value: boolean) => setDryRuns(current => ({ ...current, [key]: value })) });
  const runs = useRecentRuns(SITE_RUN_ACTIONS);
  const siteRuns = runsOfSite(runs.data ?? [], siteId);
  const active = siteRuns.filter(run => !isTerminalStatus(run.status));
  const busy = active.length > 0;
  const finished = useRef(new Set<string>());
  useEffect(() => {
    const done = siteRuns.filter(run => run.actionId === ENGINE_ACTIONS.pull && run.status === "succeeded" && !finished.current.has(run.runId));
    if (!done.length) return;
    for (const run of done) finished.current.add(run.runId);
    void client.invalidateQueries({ queryKey: engineKeys.catalog("pull") });
  }, [siteRuns, client]);

  return <div className="min-w-0 space-y-4">
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium">What do you want to do?</legend>
      <div role="radiogroup" aria-label="Transfer action" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TRANSFER_ACTIONS.map(value => {
          const reason = availability[value];
          const selected = action === value;
          return <label key={value} className={`relative flex min-h-11 min-w-0 cursor-pointer flex-col gap-1 rounded-lg border p-2.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-input-focus ${selected ? "border-accent bg-surface-hover" : "border-border-default hover:bg-surface-hover"} ${reason ? "opacity-60" : ""} ${value === "export" ? "col-span-2 sm:col-span-1" : ""}`}>
            <input type="radio" name={`zoer-plugin-transfer-action-${siteId}`} className="sr-only" checked={selected} onChange={() => setDraft(d => switchAction(d, value))} aria-describedby={`zoer-plugin-action-${value}`} />
            <span className="flex items-center gap-1.5 font-medium text-text-primary">{ICONS[value]}{ACTION_LABELS[value].title}</span>
            <span id={`zoer-plugin-action-${value}`} className="text-[12px] leading-4 text-text-muted">{reason ?? (value === "push" ? "Replace this site's content with a verified download of another site." : ACTION_LABELS[value].description)}</span>
          </label>;
        })}
      </div>
    </fieldset>
    {availability[action] ? <p role="status" className="text-sm text-status-warning">{availability[action]}.</p> : <>
      {(action === "pull" || action === "backup" || action === "export") && <PullStart siteId={siteId} connection={connection} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} draft={draft} update={update} busy={busy} {...dryRunFor(action)} />}
      {action === "push" && <PluginPushFlow siteId={siteId} connection={connection} destination={diagnostics} draft={draft} update={update} busy={busy} {...dryRunFor("push")} />}
      {action === "replace" && <ReplaceStart siteId={siteId} connection={connection} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} draft={draft} update={update} busy={busy} {...dryRunFor("replace")} />}
    </>}

    <PluginSiteRuns siteId={siteId} />
    <PluginPulls siteId={siteId} siteName={siteName} onLocalCopy={onLocalCopy} />
    <PluginTransferHistory siteId={siteId} disclosure />
  </div>;
}
