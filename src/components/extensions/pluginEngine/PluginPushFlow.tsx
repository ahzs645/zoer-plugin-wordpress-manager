import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, CheckboxField, Select, fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import type { WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { engineKeys, listCatalog, startEngineAction, useCatalogKind, useEngineRun, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import { useWordPressDiagnostics } from "../../../lib/queries/wordpress-transfer";
import { applyExportCapabilities, applyImportCapabilities, exportOptionsErrors, exportOptionsForAction, hasCapability, importOptionsErrors, pullContents, pullHasTableSubset, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";
import { formatTransferBytes } from "../wordpressPullProgress";
import ConfirmDestination, { destinationConfirmed } from "../wordpressTransfer/ConfirmDestination";
import DatabasePanel from "../wordpressTransfer/DatabasePanel";
import FilesPanel from "../wordpressTransfer/FilesPanel";
import ReplacePanel from "../wordpressTransfer/ReplacePanel";
import SafetyPanel from "../wordpressTransfer/SafetyPanel";
import { connectionWarnings } from "../wordpressTransfer/transferLabels";
import type { DraftUpdate, TransferDraft } from "../wordpressTransfer/draft";
import { guidedPushSources, pushReviewMessage } from "../publishGuidance";
import PluginRunCard from "./PluginRunCard";
import PluginPulls from "./PluginPulls";
import PreviewSelection from "./PreviewSelection";
import { defaultSelection, MAX_SELECTED_PATHS, parsePullRecord, previewExpired, previewFiles, pushSources, type PullRecord } from "./records";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";
import { codeExportIssue, codeExportOptions, codePathReason } from "../../../../plugin/worker/lib/code-publish.js";
import { formatWhen } from "../../../lib/formatWhen";

const PREVIEW_TTL_MS = 60 * 60_000;
const EXPORT_ACTIONS = [ENGINE_ACTIONS.localExport] as const;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <section className="min-w-0 space-y-3"><h4 className="text-sm font-semibold text-text-heading">{n}. {title}</h4>{children}</section>;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}

/** `transfer.local-export` of a running local DDEV site. */
function LocalExportSource({ destinationSiteId, draft, update, guidedSourceId, codeOnly, hasExport = false }: { guidedSourceId?: string; destinationSiteId: string; draft: TransferDraft; update: DraftUpdate; codeOnly: boolean; /** A verified export of the guided source exists already. */ hasExport?: boolean }) {
  const client = useQueryClient();
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const choices = sites.filter(site => ["ddev", "kubernetes"].includes(site.provider) && site.id !== destinationSiteId && (!guidedSourceId || site.id === guidedSourceId));
  const [siteId, setSiteId] = useState(guidedSourceId ?? "");
  const site = choices.find(item => item.id === siteId) ?? null;
  const diagnostics = useWordPressDiagnostics(siteId, { local: true, enabled: site?.status === "running" });
  const runs = useRecentRuns(EXPORT_ACTIONS);
  const siteRuns = (runs.data ?? []).filter(run => runInput(run).siteId === siteId).slice(0, 3);
  const active = siteRuns.some(run => !isTerminalStatus(run.status));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const rawOptions = exportOptionsForAction("push", draft.exportOptions);
  const options = codeOnly ? codeExportOptions(rawOptions) : rawOptions;
  const gate = applyExportCapabilities(options, undefined, true);
  const errors = exportOptionsErrors(gate.options);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const done = siteRuns.filter(run => run.status === "succeeded" && !seen.current.has(run.runId));
    if (!done.length) return;
    for (const run of done) seen.current.add(run.runId);
    void client.invalidateQueries({ queryKey: engineKeys.catalog("pull") });
  }, [siteRuns, client]);
  async function start() {
    setStarting(true); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.localExport, { siteId, pullId: newHexId(), exportOptions: gate.options });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The export could not start.")); }
    finally { setStarting(false); }
  }
  const body = <>
      {!guidedSourceId && <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Local site</span>
        <Select searchable aria-label="Local site to export" className={selectClass("default", "w-full")} value={siteId} disabled={!!guidedSourceId} onChange={event => { setSiteId(event.target.value); setError(""); }}>
          <option value="">Choose local site</option>
          {choices.map(item => <option key={item.id} value={item.id} disabled={item.status !== "running"}>{item.name}{item.status === "running" ? "" : " (start it first)"}</option>)}
        </Select>
      </label>}
      {guidedSourceId && !site && <p role="alert" className="text-status-warning">This local site is no longer available.</p>}
      {site && site.status !== "running" && <p role="status" className="text-sm text-status-warning">Start {site.name} to export it.</p>}
      {!choices.length && <p className="text-xs text-text-secondary">No local DDEV sites. Create or start one in WordPress Manager first.</p>}
      {site && <>
        {diagnostics.error && <div role="alert" className="space-y-2 text-xs text-status-error">
          <p>Could not read the local theme/plugin inventory: {engineErrorMessage(diagnostics.error)}</p>
          <Btn size="sm" disabled={diagnostics.isFetching} onClick={() => void diagnostics.refetch()}>Retry local inventory</Btn>
        </div>}
        {!codeOnly && <DatabasePanel exportOptions={options} onExport={next => update(d => ({ ...d, exportOptions: next }))} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} localSource />}
        <FilesPanel action="push" options={options} onChange={next => update(d => ({ ...d, exportOptions: codeOnly ? codeExportOptions(next) : next }))} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} localSource codeOnly={codeOnly} defaultOpen={codeOnly} />
        {errors.map(message => <p key={message} className="text-xs text-status-error">{message}</p>)}
        <Btn variant={guidedSourceId && hasExport ? undefined : "primary"} className="w-full sm:w-auto" disabled={starting || active || errors.length > 0 || site.status !== "running"} loading={starting} onClick={() => void start()}>{guidedSourceId ? (hasExport ? "Export again" : `Export ${site.name}`) : "Prepare local export"}</Btn>
        {active && <p className="text-xs text-text-secondary">Exporting… this usually takes a minute or two.</p>}
      </>}
      {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
      {(guidedSourceId ? siteRuns.filter(run => !isTerminalStatus(run.status) || run.status === "failed").slice(0, 1) : siteRuns).map(run => <PluginRunCard key={run.runId} recent={run} title="Local export" />)}
      {site && !guidedSourceId && <PluginPulls siteId={siteId} siteName={site.name} />}
  </>;
  if (guidedSourceId) return <div className="min-w-0 space-y-3">{body}</div>;
  return <details className="min-w-0 rounded-lg border border-border-default">
    <summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2"><span className="text-sm font-medium">Export a local DDEV site</span><span className="text-xs text-text-secondary">Prepare a verified export of a local site, then choose it above.</span></summary>
    <div className="min-w-0 space-y-3 border-t border-border-muted p-3">{body}</div>
  </details>;
}

/**
 * Plugin-engine Push: a verified pull or local export of another site → `transfer.preview`
 * (optional) → `transfer.push` through Zoer's approval, with the same destination confirmation and
 * replacement policy as Zoer's earlier host-side Push. Dry run is on by default.
 */
export default function PluginPushFlow({ siteId, connection, destination, draft, update, guidedSourceId, dryRun, onDryRun, busy }: {
  siteId: string; connection: ZoerConnectConnection; destination: WordPressDiagnostics | null | undefined; draft: TransferDraft; update: DraftUpdate;
  guidedSourceId?: string; dryRun: boolean; onDryRun: (value: boolean) => void; /** Another transfer of this site is active. */ busy: boolean;
}) {
  const client = useQueryClient();
  const status = connection.status;
  const caps = status.capabilities;
  const target = connection.url;
  const shared = status.migrationMode === "shared-replacement";
  const enabled = status.push && status.publish;
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const siteName = (id: string) => sites.find(site => site.id === id)?.name ?? id;
  const records = useCatalogKind("pull");
  const sources = guidedPushSources(pushSources((records.data ?? []).map(parsePullRecord).filter((pull): pull is PullRecord => !!pull), siteId), guidedSourceId);
  const [setId, setSetId] = useState("");
  const chosen = sources.find(pull => pull.setId === setId) ?? null;
  // Selective push needs Zoer Connect's file comparison on the destination.
  const canCompare = caps?.selectivePush === true;
  const [compare, setCompare] = useState(canCompare);
  const [preview, setPreview] = useState<{ previewId: string; runId: string; setId: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState("");
  const [writers, setWriters] = useState(false);
  const [starting, setStarting] = useState<"preview" | "push" | null>(null);
  const [error, setError] = useState("");
  const [codeOnly, setCodeOnly] = useState(!!guidedSourceId);
  const now = useNow(30_000);

  const previewRun = useEngineRun<{ complete?: boolean; total?: number }>(preview?.runId);
  const previewDone = previewRun.data?.status === "succeeded";
  const pages = useQuery({ queryKey: engineKeys.preview(preview?.previewId ?? ""), enabled: !!preview && previewDone, staleTime: Infinity, retry: false,
    queryFn: async () => previewFiles((await listCatalog("preview-page", { after: `preview-page:${preview!.previewId}:`, prefix: `preview-page:${preview!.previewId}:`, max: 100_000 })).records, preview!.previewId) });
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (!preview || !pages.data || initialized.current === preview.previewId) return;
    initialized.current = preview.previewId;
    setSelected(new Set(defaultSelection(pages.data.filter(file => !codeOnly || !codePathReason(file.path, chosen?.options?.profile)))));
  }, [preview, pages.data, codeOnly, chosen]);
  const previewCreated = Date.parse(previewRun.data?.createdAt ?? "");
  const expired = !!preview && Number.isFinite(previewCreated) && previewExpired({ expiresAt: new Date(previewCreated + PREVIEW_TTL_MS).toISOString() }, now);
  const previewReady = !!preview && preview.setId === setId && previewDone && !!pages.data && !expired;

  const requestedOptions = codeOnly ? { ...draft.importOptions, review: true, fence: "activation" as const, keepActivePlugins: true, keepActiveTheme: true,
    createTables: false, replaceGuids: false, replacements: { automatic: false, variants: false, paths: false, custom: [] } } : draft.importOptions;
  const importGate = applyImportCapabilities(requestedOptions, caps);
  const importErrors = importOptionsErrors(requestedOptions);
  const codeIssue = codeOnly && chosen ? codeExportIssue(chosen.options) : null;
  const codeCapabilities = !codeOnly || (canCompare && caps?.reviewPause === true && caps?.lateFence === true);
  const comparedFiles = pages.data?.map(file => {
    const reason = codeOnly ? codePathReason(file.path, chosen?.options?.profile) : null;
    return reason ? { ...file, state: "blocked" as const, reason } : file;
  });
  const sourceUrl = chosen?.source?.url || chosen?.origin || null;
  const warnings = connectionWarnings(destination, { sourcePrefix: chosen?.source?.prefix ?? null }).filter(w => w.code === "prefix_mismatch" || w.code === "mixed_case_tables");
  const partialUnsupported = !!chosen && pullHasTableSubset(chosen.options) && !hasCapability(caps, "databaseFilters") && !hasCapability(caps, "createTables");
  const comparing = (codeOnly || compare) && canCompare;
  const selectionOk = !comparing || (previewReady && selected.size > 0 && selected.size <= MAX_SELECTED_PATHS);
  const ready = enabled && !!chosen && !busy && !partialUnsupported && !codeIssue && codeCapabilities && selectionOk && destinationConfirmed(target, confirm) && writers && !importErrors.length && starting === null;

  function choose(next: string) { setSetId(next); setPreview(null); setSelected(new Set()); setError(""); }
  async function startPreview() {
    if (!chosen?.setId) return;
    setStarting("preview"); setError("");
    try {
      const previewId = newHexId();
      const runId = await startEngineAction(ENGINE_ACTIONS.preview, { siteId, setId: chosen.setId, previewId });
      initialized.current = null; setSelected(new Set());
      setPreview({ previewId, runId, setId: chosen.setId });
    } catch (caught) { setError(engineErrorMessage(caught, "The comparison could not start.")); }
    finally { setStarting(null); }
  }
  async function startPush() {
    if (!chosen?.setId || !ready) return;
    setStarting("push"); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.push, {
        siteId, setId: chosen.setId, importId: newHexId(), confirmTarget: confirm.trim(), importOptions: importGate.options, ...(codeOnly ? { codeOnly: true } : {}),
        ...(comparing && preview ? { previewId: preview.previewId, selectedPaths: [...selected] } : {}),
        ...(shared ? { replacementAccepted: true } : { wordpressOnlyWriters: true }),
        sourceSiteId: chosen.siteId, ...(dryRun ? { dryRun: true } : {}),
      }, { approval: true });
      setConfirm(""); setWriters(false);
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The push could not be requested.")); }
    finally { setStarting(null); }
  }

  if (!enabled) return <p className="text-sm text-text-secondary">Turn on Push and finish “Destination import setup” in WordPress → Tools → Zoer Connect on this site.</p>;
  const compareBlock = <div className="min-w-0 space-y-3 rounded-lg border border-border-default p-3">
        <Btn className="w-full sm:w-auto" disabled={starting !== null || busy || (!!preview && !previewRun.data) || (!!previewRun.data && !isTerminalStatus(previewRun.data.status))} loading={starting === "preview"} onClick={() => void startPreview()}>{preview ? "Compare again" : guidedSourceId ? "Compare with live site" : "Compare with this site"}</Btn>
        {preview && previewRun.data && !previewDone && <PluginRunCard recent={{ runId: preview.runId, actionId: ENGINE_ACTIONS.preview, status: previewRun.data.status, createdAt: previewRun.data.createdAt ?? new Date().toISOString(), input: { siteId, previewId: preview.previewId } }} title="Comparison" />}
        {previewDone && pages.isLoading && <p className="text-xs text-text-secondary">Loading the comparison…</p>}
        {pages.error && <p role="alert" className="text-sm text-status-error">Could not load the comparison: {engineErrorMessage(pages.error)}</p>}
        {expired && <p role="alert" className="text-sm text-status-warning">This comparison expired. Compare again before pushing a selection.</p>}
        {previewReady && comparedFiles && <PreviewSelection files={comparedFiles} selected={selected} onChange={setSelected} disabled={starting !== null} />}
  </div>;
  const optionsBlock = chosen && <>
      {warnings.map(w => <p key={w.code} className="text-xs text-status-warning">{w.message}</p>)}
      <DatabasePanel importOptions={draft.importOptions} onImport={options => update(d => ({ ...d, importOptions: options }))} destinationCaps={caps} />
      <ReplacePanel options={draft.importOptions} onChange={options => update(d => ({ ...d, importOptions: options }))} caps={caps} sourceUrl={sourceUrl} destinationUrl={target} sourcePath={chosen?.source?.abspath} destinationPath={destination?.wordpress?.abspath} />
      <SafetyPanel options={draft.importOptions} onChange={options => update(d => ({ ...d, importOptions: options }))} caps={caps} />
      {importGate.downgraded.length > 0 && <p className="text-xs text-status-warning">{REQUIRES_040} for: {importGate.downgraded.join(", ")}. These run with the previous behaviour.</p>}
      {importErrors.map(message => <p key={message} className="text-xs text-status-error">{message}</p>)}
  </>;
  const confirmBlock = <>
      <CheckboxField label="Dry run first" description={guidedSourceId ? "Check the push without changing the live site." : "Plans the import against the destination and stops. Nothing is uploaded or activated."} checked={dryRun} onChange={onDryRun} />
      {guidedSourceId
        ? <p className="text-xs text-text-secondary">You approve the push, then review the staged result. The live site switches only when you choose Finish, and Roll back stays available until then.</p>
        : <p className="text-xs text-text-secondary">Push does not update WordPress core, the destination's user accounts or its Zoer Connect key. Zoer asks for approval before the push starts. {pushReviewMessage(importGate.options.review, importGate.options.fence)} Every real push pauses after activation until you choose Finish or Roll back.</p>}
      <ConfirmDestination target={target} value={confirm} onChange={setConfirm} shared={shared} writers={writers} onWriters={setWriters} disabled={starting !== null} />
      {busy && <p className="text-xs text-status-warning">Another transfer is running on this site. Finish, roll back or cancel it below before starting another.</p>}
      {comparing && !previewReady && <p className="text-xs text-text-secondary">{guidedSourceId ? "Compare with the live site first (step 2)." : codeOnly ? "Compare with this site first. Code updates require a reviewed file selection." : "Compare with this site first, or turn off “Compare first” to push everything in the download."}</p>}
      <Btn variant="primary" className="w-full sm:w-auto" disabled={!ready} loading={starting === "push"} onClick={() => void startPush()}>
        {dryRun ? "Request dry run" : guidedSourceId && comparing ? `Push ${selected.size.toLocaleString()} item${selected.size === 1 ? "" : "s"} to live` : comparing ? `Request push of ${selected.size.toLocaleString()} item${selected.size === 1 ? "" : "s"}` : "Request push of everything"}
      </Btn>
  </>;
  return <div className="min-w-0 space-y-5">
    <label className="block text-sm"><span className={fieldLabelClass}>Publish mode</span>
      <Select aria-label="Publish mode" className={selectClass("default", "w-full")} value={codeOnly ? "code" : "custom"} onChange={event => { setCodeOnly(event.target.value === "code"); choose(""); }} disabled={starting !== null}>
        <option value="code">Code updates — keep live data</option>
        <option value="custom">Custom transfer</option>
      </Select>
    </label>
    {codeOnly && <div className="space-y-2 text-xs text-text-secondary">
      <p>Choose only the themes and plugins to update. The destination keeps its database, uploads, login settings, must-use plugins and server configuration. Unselected plugins keep their current code.</p>
      <p>Saved pages, block templates and styles are database content and stay unchanged. Updated code can run its own migrations; test sign-in and important pages before finishing.</p>
      {!codeCapabilities && <p role="alert" className="text-status-warning">Update Zoer Connect on the destination to support file comparison, staged review and late activation.</p>}
    </div>}
    <Step n={1} title="Choose the source">
      {guidedSourceId && <p className="text-sm text-text-secondary">Local source: <strong>{siteName(guidedSourceId)}</strong>. Prepare a fresh export below, then choose it from this source’s verified exports.</p>}
      <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Verified download or local export</span>
        <Select searchable aria-label="Push source" className={selectClass("default", "w-full")} value={chosen ? setId : ""} onChange={event => choose(event.target.value)}>
          <option value="">Choose source</option>
          {sources.map(pull => <option key={pull.pullId} value={pull.setId!}>{siteName(pull.siteId)} · {pull.kind === "local-export" ? "Local export" : pullContents(pull.options).label} · {formatWhen(pull.createdAt)} · {formatTransferBytes(pull.totalBytes)}</option>)}
        </Select>
      </label>
      {records.isLoading && <p className="text-xs text-text-secondary">Loading downloads…</p>}
      {records.data && !sources.length && <p className="text-xs text-text-secondary">{guidedSourceId ? "No verified exports of this local source yet. Prepare one below." : "No verified downloads of other sites yet. Pull another connected site, or export a local site below."}</p>}
      <LocalExportSource destinationSiteId={siteId} guidedSourceId={guidedSourceId} draft={draft} update={update} codeOnly={codeOnly} />
      {codeIssue && <p role="alert" className="text-xs text-status-warning">{codeIssue}</p>}
      {partialUnsupported && <p className="text-xs text-status-warning">This download contains only some tables. {REQUIRES_040} to import a partial database.</p>}
    </Step>

    {chosen && <Step n={2} title="What to push">
      <CheckboxField label="Compare first and choose files" description={canCompare ? "Compares the download with this site. New and changed files start selected; files absent from the download are kept. Comparisons expire after one hour." : "Update Zoer Connect on this site to compare files before pushing. Without it, Push sends everything in the download."} checked={(codeOnly || compare) && canCompare} disabled={!canCompare || codeOnly} onChange={value => { setCompare(value); setError(""); }} />
      {comparing && compareBlock}
    </Step>}

    {chosen && !codeOnly && <Step n={3} title="Options">
      {optionsBlock}
    </Step>}

    {chosen && <Step n={codeOnly ? 3 : 4} title="Confirm">
      {confirmBlock}
    </Step>}
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
  </div>;
}
