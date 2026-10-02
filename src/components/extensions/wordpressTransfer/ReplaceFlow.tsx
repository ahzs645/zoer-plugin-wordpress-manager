import { useRef, useState } from "react";
import type { ImportOptions, WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { useWordPressPushes } from "../../../lib/queries/wordpress-transfer";
import { defaultReplaceTables, hasCapability, importOptionsErrors, newRequestId, replaceJobOptions, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import ConfirmDestination, { destinationConfirmed } from "./ConfirmDestination";
import { SELECTABLE_TABLE, tableItems, unselectableTablesHint } from "./DatabasePanel";
import PushJobs from "./PushJobs";
import ReplacePanel from "./ReplacePanel";
import SafetyPanel from "./SafetyPanel";
import { ItemPicker, OptionToggle } from "./TransferPanel";
import type { DraftUpdate, TransferDraft } from "./draft";

export default function ReplaceFlow({ siteId, connection, diagnostics, diagnosticsLoading, draft, update }: {
  siteId: string; connection: ZoerConnectConnection; diagnostics: WordPressDiagnostics | null | undefined; diagnosticsLoading: boolean; draft: TransferDraft; update: DraftUpdate;
}) {
  const status = connection.status;
  const caps = status.capabilities;
  const supported = hasCapability(caps, "siteReplace");
  const shared = status.migrationMode === "shared-replacement";
  const target = connection.url;
  const pushes = useWordPressPushes(siteId);
  const running = pushes.jobs.some(job => !["complete", "rolled_back", "cancelled"].includes(job.status));
  const [confirm, setConfirm] = useState("");
  const [writers, setWriters] = useState(false);
  const [query, setQuery] = useState("");
  const requestId = useRef(newRequestId());
  // The plugin never rewrites users/usermeta in a replace-only job.
  const items = tableItems(diagnostics).filter(item => item.value !== "users" && item.value !== "usermeta");
  const tables = draft.exportOptions.database.tables;
  const setTables = (value: "all" | string[]) => update(d => ({ ...d, exportOptions: { ...d.exportOptions, database: { ...d.exportOptions.database, tables: value } } }));
  const options = { ...draft.importOptions, review: true, fence: "activation" as const };
  const setOptions = (next: ImportOptions) => update(d => ({ ...d, importOptions: next }));
  const errors = importOptionsErrors(options, { requireCustom: true });
  // A selection carried over from Pull/Push may name tables this job refuses.
  const selectedTables = tables === "all" ? [] : tables.filter(table => table !== "users" && table !== "usermeta" && SELECTABLE_TABLE.test(table));
  const chosenTables = tables === "all" ? null : selectedTables;
  const ready = supported && status.push && status.publish && !running && !errors.length && (!chosenTables || chosenTables.length > 0) && destinationConfirmed(target, confirm) && writers && pushes.pending.length === 0;

  async function start() {
    try {
      await pushes.command({ action: "start", kind: "replace", requestId: requestId.current, body: {
        confirmTarget: confirm.trim(),
        ...(shared ? { replacementAccepted: writers } : { wordpressOnlyWriters: writers }),
        options: replaceJobOptions(options, hasCapability(caps, "cachePurge")),
        ...(chosenTables ? { tables: chosenTables } : {}),
        ...(draft.profileId ? { profileId: draft.profileId } : {}),
      } });
      requestId.current = newRequestId(); setConfirm(""); setWriters(false);
    } catch { /* shown by the job list */ }
  }

  if (!supported) return <p className="text-sm text-status-warning">{REQUIRES_040}. Update the plugin in <a className="underline" href={`${target.replace(/\/+$/, "")}/wp-admin/plugins.php`} target="_blank" rel="noreferrer">WordPress → Plugins</a> to run Find & Replace.</p>;
  return <div className="min-w-0 space-y-4">
    <p className="text-xs text-text-secondary">Zoer snapshots this site's database, applies your rules to a staged copy (serialized data stays valid), and stops for you to review counts and samples. Nothing changes on the live site until you apply.</p>
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
    {errors.map(error => <p key={error} className="text-xs text-status-error">{error}</p>)}
    <ConfirmDestination target={target} value={confirm} onChange={setConfirm} shared={shared} writers={writers} onWriters={setWriters} disabled={pushes.pending.length > 0} />
    {running && <p className="text-xs text-status-warning">Finish, roll back or cancel the current job below before starting another.</p>}
    <Btn variant="primary" disabled={!ready} loading={pushes.pending.some(c => c.action === "start")} onClick={() => void start()}>Preview replacements</Btn>
    <section className="min-w-0 space-y-2"><h4 className="text-sm font-semibold text-text-heading">Find & Replace jobs</h4><PushJobs siteId={siteId} caps={caps} kind="replace" /></section>
  </div>;
}
