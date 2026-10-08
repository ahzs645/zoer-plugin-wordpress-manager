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
import PreviewSelection from "./PreviewSelection";
import { defaultSelection, MAX_SELECTED_PATHS, parsePullRecord, previewExpired, previewFiles, pushSources, type PullRecord } from "./records";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";

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
function LocalExportSource({ destinationSiteId, draft, update, guidedSourceId }: { guidedSourceId?: string; destinationSiteId: string; draft: TransferDraft; update: DraftUpdate }) {
  const client = useQueryClient();
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const choices = sites.filter(site => site.provider === "ddev" && site.id !== destinationSiteId && (!guidedSourceId || site.id === guidedSourceId));
  const [siteId, setSiteId] = useState(guidedSourceId ?? "");
  const site = choices.find(item => item.id === siteId) ?? null;
  const diagnostics = useWordPressDiagnostics(siteId, { local: true, enabled: site?.status === "running" });
  const runs = useRecentRuns(EXPORT_ACTIONS);
  const siteRuns = (runs.data ?? []).filter(run => runInput(run).siteId === siteId).slice(0, 3);
  const active = siteRuns.some(run => !isTerminalStatus(run.status));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const options = exportOptionsForAction("push", draft.exportOptions);
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
  return <details open={guidedSourceId ? true : undefined} data-zoer-disclosure className="min-w-0 rounded-lg border border-border-default">
    <summary className="flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2"><span className="text-sm font-medium">Export a local DDEV site</span><span className="text-xs text-text-secondary">Prepare a verified export of a local site, then choose it above.</span></summary>
    <div className="min-w-0 space-y-3 border-t border-border-muted p-3">
      <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Local site</span>
        <Select searchable aria-label="Local site to export" className={selectClass("default", "w-full")} value={siteId} disabled={!!guidedSourceId} onChange={event => { setSiteId(event.target.value); setError(""); }}>
          <option value="">Choose local site</option>
          {choices.map(item => <option key={item.id} value={item.id} disabled={item.status !== "running"}>{item.name}{item.status === "running" ? "" : " (start it first)"}</option>)}
        </Select>
      </label>
      {guidedSourceId && !site && <p role="alert" className="text-status-warning">The selected local source is no longer available. Close this dialog and choose a current local site.</p>}
      {!choices.length && <p className="text-xs text-text-secondary">No local DDEV sites. Create or start one in WordPress Manager first.</p>}
      {site && <>
        <DatabasePanel exportOptions={options} onExport={next => update(d => ({ ...d, exportOptions: next }))} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} localSource />
        <FilesPanel action="push" options={options} onChange={next => update(d => ({ ...d, exportOptions: next }))} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} localSource />
        {errors.map(message => <p key={message} className="text-xs text-status-error">{message}</p>)}
        <Btn variant="primary" className="w-full sm:w-auto" disabled={starting || active || errors.length > 0 || site.status !== "running"} loading={starting} onClick={() => void start()}>Prepare local export</Btn>
        {active && <p className="text-xs text-text-secondary">An export of this site is running.</p>}
      </>}
      {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
      {siteRuns.map(run => <PluginRunCard key={run.runId} recent={run} title="Local export" />)}
    </div>
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
  const now = useNow(30_000);

  const previewRun = useEngineRun<{ complete?: boolean; total?: number }>(preview?.runId);
  const previewDone = previewRun.data?.status === "succeeded";
  const pages = useQuery({ queryKey: engineKeys.preview(preview?.previewId ?? ""), enabled: !!preview && previewDone, staleTime: Infinity, retry: false,
    queryFn: async () => previewFiles((await listCatalog("preview-page", { after: `preview-page:${preview!.previewId}:`, prefix: `preview-page:${preview!.previewId}:`, max: 100_000 })).records, preview!.previewId) });
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (!preview || !pages.data || initialized.current === preview.previewId) return;
    initialized.current = preview.previewId;
    setSelected(new Set(defaultSelection(pages.data)));
  }, [preview, pages.data]);
  const previewCreated = Date.parse(previewRun.data?.createdAt ?? "");
  const expired = !!preview && Number.isFinite(previewCreated) && previewExpired({ expiresAt: new Date(previewCreated + PREVIEW_TTL_MS).toISOString() }, now);
  const previewReady = !!preview && preview.setId === setId && previewDone && !!pages.data && !expired;

  const importGate = applyImportCapabilities(draft.importOptions, caps);
  const importErrors = importOptionsErrors(draft.importOptions);
  const sourceUrl = chosen?.source?.url || chosen?.origin || null;
  const warnings = connectionWarnings(destination, { sourcePrefix: chosen?.source?.prefix ?? null }).filter(w => w.code === "prefix_mismatch" || w.code === "mixed_case_tables");
  const partialUnsupported = !!chosen && pullHasTableSubset(chosen.options) && !hasCapability(caps, "databaseFilters") && !hasCapability(caps, "createTables");
  const comparing = compare && canCompare;
  const selectionOk = !comparing || (previewReady && selected.size > 0 && selected.size <= MAX_SELECTED_PATHS);
  const ready = enabled && !!chosen && !busy && !partialUnsupported && selectionOk && destinationConfirmed(target, confirm) && writers && !importErrors.length && starting === null;

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
        siteId, setId: chosen.setId, importId: newHexId(), confirmTarget: confirm.trim(), importOptions: importGate.options,
        ...(comparing && preview ? { previewId: preview.previewId, selectedPaths: [...selected] } : {}),
        ...(shared ? { replacementAccepted: true } : { wordpressOnlyWriters: true }),
        sourceSiteId: chosen.siteId, ...(dryRun ? { dryRun: true } : {}),
      }, { approval: true });
      setConfirm(""); setWriters(false);
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The push could not be requested.")); }
    finally { setStarting(null); }
  }

  if (!enabled) return <p className="text-sm text-text-secondary">Push requires an import-capable Zoer Connect with Push permission enabled in WordPress → Tools → Zoer Connect.</p>;
  return <div className="min-w-0 space-y-5">
    <Step n={1} title="Choose the source">
      {guidedSourceId && <p className="text-sm text-text-secondary">Local source: <strong>{siteName(guidedSourceId)}</strong>. Prepare a fresh export below, then choose it from this source’s verified exports.</p>}
      <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Verified download or local export</span>
        <Select searchable aria-label="Push source" className={selectClass("default", "w-full")} value={chosen ? setId : ""} onChange={event => choose(event.target.value)}>
          <option value="">Choose source</option>
          {sources.map(pull => <option key={pull.pullId} value={pull.setId!}>{siteName(pull.siteId)} · {pull.kind === "local-export" ? "Local export" : pullContents(pull.options).label} · {new Date(pull.createdAt).toLocaleString()} · {formatTransferBytes(pull.totalBytes)}</option>)}
        </Select>
      </label>
      {records.isLoading && <p className="text-xs text-text-secondary">Loading downloads…</p>}
      {records.data && !sources.length && <p className="text-xs text-text-secondary">{guidedSourceId ? "No verified exports of this local source yet. Prepare one below." : "No verified downloads of other sites yet. Pull another connected site, or export a local site below."}</p>}
      <LocalExportSource destinationSiteId={siteId} guidedSourceId={guidedSourceId} draft={draft} update={update} />
      {partialUnsupported && <p className="text-xs text-status-warning">This download contains only some tables. {REQUIRES_040} to import a partial database.</p>}
    </Step>

    {chosen && <Step n={2} title="What to push">
      <CheckboxField label="Compare first and choose files" description={canCompare ? "Compares the download with this site. New and changed files start selected; files absent from the download are kept. Comparisons expire after one hour." : "Update Zoer Connect on this site to compare files before pushing. Without it, Push sends everything in the download."} checked={compare && canCompare} disabled={!canCompare} onChange={value => { setCompare(value); setError(""); }} />
      {comparing && <div className="min-w-0 space-y-3 rounded-lg border border-border-default p-3">
        <Btn className="w-full sm:w-auto" disabled={starting !== null || busy || (!!preview && !previewRun.data) || (!!previewRun.data && !isTerminalStatus(previewRun.data.status))} loading={starting === "preview"} onClick={() => void startPreview()}>{preview ? "Compare again" : "Compare with this site"}</Btn>
        {preview && previewRun.data && !previewDone && <PluginRunCard recent={{ runId: preview.runId, actionId: ENGINE_ACTIONS.preview, status: previewRun.data.status, createdAt: previewRun.data.createdAt ?? new Date().toISOString(), input: { siteId, previewId: preview.previewId } }} title="Comparison" />}
        {previewDone && pages.isLoading && <p className="text-xs text-text-secondary">Loading the comparison…</p>}
        {pages.error && <p role="alert" className="text-sm text-status-error">Could not load the comparison: {engineErrorMessage(pages.error)}</p>}
        {expired && <p role="alert" className="text-sm text-status-warning">This comparison expired. Compare again before pushing a selection.</p>}
        {previewReady && pages.data && <PreviewSelection files={pages.data} selected={selected} onChange={setSelected} disabled={starting !== null} />}
      </div>}
    </Step>}

    {chosen && <Step n={3} title="Options">
      {warnings.map(w => <p key={w.code} className="text-xs text-status-warning">{w.message}</p>)}
      <DatabasePanel importOptions={draft.importOptions} onImport={options => update(d => ({ ...d, importOptions: options }))} destinationCaps={caps} />
      <ReplacePanel options={draft.importOptions} onChange={options => update(d => ({ ...d, importOptions: options }))} caps={caps} sourceUrl={sourceUrl} destinationUrl={target} sourcePath={chosen.source?.abspath} destinationPath={destination?.wordpress?.abspath} />
      <SafetyPanel options={draft.importOptions} onChange={options => update(d => ({ ...d, importOptions: options }))} caps={caps} />
      {importGate.downgraded.length > 0 && <p className="text-xs text-status-warning">{REQUIRES_040} for: {importGate.downgraded.join(", ")}. These run with the previous behaviour.</p>}
      {importErrors.map(message => <p key={message} className="text-xs text-status-error">{message}</p>)}
    </Step>}

    {chosen && <Step n={4} title="Confirm">
      <CheckboxField label="Dry run" description="Plans the import against the destination and stops. Nothing is uploaded or activated." checked={dryRun} onChange={onDryRun} />
      <p className="text-xs text-text-secondary">Push does not update WordPress core, the destination's user accounts or its Zoer Connect key. Zoer asks for approval before the push starts. {pushReviewMessage(importGate.options.review, importGate.options.fence)} Every real push pauses after activation until you choose Finish or Roll back.</p>
      <ConfirmDestination target={target} value={confirm} onChange={setConfirm} shared={shared} writers={writers} onWriters={setWriters} disabled={starting !== null} />
      {busy && <p className="text-xs text-status-warning">Another transfer is running on this site. Finish, roll back or cancel it below before starting another.</p>}
      {comparing && !previewReady && <p className="text-xs text-text-secondary">Compare with this site first, or turn off “Compare first” to push everything in the download.</p>}
      <Btn variant="primary" className="w-full sm:w-auto" disabled={!ready} loading={starting === "push"} onClick={() => void startPush()}>
        {dryRun ? "Request dry run" : comparing ? `Request push of ${selected.size.toLocaleString()} item${selected.size === 1 ? "" : "s"}` : "Request push of everything"}
      </Btn>
    </Step>}
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
  </div>;
}
