import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PushSource, WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import { useWordPressPulls } from "../../../lib/queries/wordpress-pulls";
import { useWordPressDiagnostics, useWordPressPushes, useZoerConnection } from "../../../lib/queries/wordpress-transfer";
import { applyExportCapabilities, applyImportCapabilities, exportOptionsErrors, exportOptionsForAction, hasCapability, importOptionsErrors, newRequestId, pullHasTableSubset, pullIncludesDownloadOnly, pushButtonLabel, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import WordPressPull from "../WordPressPull";
import WordPressPushSelection, { type PushSelection } from "../WordPressPushSelection";
import ConfirmDestination, { destinationConfirmed } from "./ConfirmDestination";
import DatabasePanel from "./DatabasePanel";
import FilesPanel from "./FilesPanel";
import PushJobs from "./PushJobs";
import ReplacePanel from "./ReplacePanel";
import SafetyPanel from "./SafetyPanel";
import { connectionWarnings } from "./transferLabels";
import type { DraftUpdate, TransferDraft } from "./draft";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <section className="min-w-0 space-y-3"><h4 className="text-sm font-semibold text-text-heading">{n}. {title}</h4>{children}</section>;
}

export default function PushFlow({ siteId, connection, destination, draft, update }: {
  siteId: string; connection: ZoerConnectConnection; destination: WordPressDiagnostics | null | undefined; draft: TransferDraft; update: DraftUpdate;
}) {
  const status = connection.status;
  const caps = status.capabilities;
  const target = connection.url;
  const shared = status.migrationMode === "shared-replacement";
  const enabled = status.push && status.publish;
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const local = draft.sourceKind === "local-export";
  const choices = local ? sites.filter(s => s.provider === "ddev" && s.status === "running" && s.id !== siteId) : sites.filter(s => s.provider === "zoer-connect" && s.id !== siteId);
  const sourceSiteId = choices.some(s => s.id === draft.sourceSiteId) ? draft.sourceSiteId : "";
  const [selectedId, setSelectedId] = useState("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [selection, setSelection] = useState<PushSelection | null>(null);
  const [confirm, setConfirm] = useState("");
  const [writers, setWriters] = useState(false);
  const requestId = useRef(newRequestId());
  const renew = () => { requestId.current = newRequestId(); };

  const sourceConnection = useZoerConnection(sourceSiteId, !local && !!sourceSiteId);
  const sourceCaps = sourceConnection.connection?.status.capabilities;
  const sourceDiagnostics = useWordPressDiagnostics(sourceSiteId, { local, enabled: !!sourceSiteId });
  const sourcePulls = useWordPressPulls(sourceSiteId || "none", local, !!sourceSiteId);
  const chosen = sourcePulls.jobs.find(job => job.id === selectedId && job.status === "ready") ?? null;
  const source: PushSource | null = chosen ? (local ? { kind: "local-export", sourceSiteId, exportId: chosen.id } : { kind: "pull", sourceSiteId, pullId: chosen.id }) : null;
  const pushes = useWordPressPushes(siteId);
  const running = pushes.jobs.some(job => !["complete", "rolled_back", "cancelled"].includes(job.status));

  const exportDraft = exportOptionsForAction("push", draft.exportOptions);
  const exportGate = applyExportCapabilities(exportDraft, sourceCaps, local);
  const importGate = applyImportCapabilities(draft.importOptions, caps);
  const importErrors = importOptionsErrors(draft.importOptions);
  const sourceInfo = useMemo(() => ({
    url: chosen?.source?.url || sourceDiagnostics.data?.wordpress?.home || null,
    prefix: chosen?.source?.prefix || sourceDiagnostics.data?.wordpress?.prefix || null,
    path: chosen?.source?.abspath || sourceDiagnostics.data?.wordpress?.abspath || null,
  }), [chosen, sourceDiagnostics.data]);
  const warnings = connectionWarnings(destination, { sourcePrefix: sourceInfo.prefix }).filter(w => w.code === "prefix_mismatch" || w.code === "mixed_case_tables");
  const selectedCount = selection?.selectedPaths.length ?? 0;
  const partialUnsupported = !!chosen && pullHasTableSubset(chosen.options) && !hasCapability(caps, "databaseFilters") && !hasCapability(caps, "createTables");
  const downloadOnly = !!chosen && pullIncludesDownloadOnly(chosen.options);
  const ready = enabled && !!source && !partialUnsupported && !downloadOnly && !running && destinationConfirmed(target, confirm) && writers && !importErrors.length && (scope === "all" || selectedCount > 0) && pushes.pending.length === 0;

  async function start() {
    if (!source) return;
    const legacy = source.kind === "local-export" ? { sourceSiteId: source.sourceSiteId, exportId: source.exportId } : {};
    try {
      await pushes.command({ action: "start", kind: "push", requestId: requestId.current, body: {
        source, ...legacy,
        ...(scope === "selected" && selection ? { selection, ...selection } : {}),
        confirmTarget: confirm.trim(),
        ...(shared ? { replacementAccepted: writers } : { wordpressOnlyWriters: writers }),
        options: importGate.options,
        ...(draft.profileId ? { profileId: draft.profileId } : {}),
      } });
      renew(); setConfirm(""); setWriters(false);
    } catch { /* shown below */ }
  }

  if (!enabled) return <p className="text-sm text-text-secondary">Push requires an import-capable Zoer Connect with Push permission enabled in WordPress → Tools → Zoer Connect.</p>;
  return <div className="min-w-0 space-y-5">
    <Step n={1} title="Choose the source">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Source type</span>
          <Select aria-label="Push source type" className={selectClass("default", "w-full")} value={draft.sourceKind} onChange={event => { update(d => ({ ...d, sourceKind: event.target.value as TransferDraft["sourceKind"], sourceSiteId: "" })); setSelectedId(""); setSelection(null); renew(); }}
            optionDetails={{ "local-export": { description: "Export a running DDEV site on the Zoer server" }, pull: { description: "Use a verified pull from another connected website" } }}>
            <option value="local-export">Local DDEV site</option>
            <option value="pull">Another connected site</option>
          </Select>
        </label>
        <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>{local ? "Local site" : "Connected site"}</span>
          <Select searchable aria-label="Push source site" className={selectClass("default", "w-full")} value={sourceSiteId} onChange={event => { update(d => ({ ...d, sourceSiteId: event.target.value })); setSelectedId(""); setSelection(null); renew(); }}>
            <option value="">Choose source</option>
            {choices.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </Select>
        </label>
      </div>
      {!choices.length && <p className="text-xs text-text-secondary">{local ? "No running local DDEV sites. Start one in WordPress Manager first." : "Connect another WordPress site with Zoer Connect to push between websites."}</p>}
      {sourceSiteId && <>
        <DatabasePanel exportOptions={exportDraft} onExport={options => update(d => ({ ...d, exportOptions: options }))} diagnostics={sourceDiagnostics.data} diagnosticsLoading={sourceDiagnostics.isLoading} sourceCaps={sourceCaps} localSource={local} />
        <FilesPanel action="push" options={exportDraft} onChange={options => update(d => ({ ...d, exportOptions: options }))} diagnostics={sourceDiagnostics.data} diagnosticsLoading={sourceDiagnostics.isLoading} sourceCaps={sourceCaps} localSource={local} />
        <WordPressPull key={`${draft.sourceKind}:${sourceSiteId}`} siteId={sourceSiteId} local={local} enabled={local || !!(sourceConnection.connection?.status.pull && sourceConnection.connection.status.stagingReady)}
          options={exportGate.options} errors={exportOptionsErrors(exportGate.options)} notices={exportGate.downgraded.map(label => `${label} need Zoer Connect 0.4.0 on the source and will not be applied.`)}
          startLabel={local ? "Prepare export" : "Pull from source"} readyLabel="Push this" onReady={id => { setSelectedId(id); setSelection(null); renew(); }} />
        {partialUnsupported && <p className="text-xs text-status-warning">This {local ? "export" : "download"} contains only some tables. {REQUIRES_040} to import a partial database.</p>}
        {downloadOnly && <p className="text-xs text-status-error">This download includes must-use plugins or WordPress core, which cannot be pushed. Start a new pull from here (they are excluded automatically).</p>}
        {chosen ? <p role="status" className="text-sm text-status-success">Selected verified {local ? "export" : "pull"} from {new Date(chosen.createdAt).toLocaleString()}.</p>
          : <p className="text-xs text-text-secondary">Choose “Push this” on a verified {local ? "export" : "download"}.</p>}
      </>}
    </Step>

    {source && <Step n={2} title="What to push">
      <label className="block text-sm"><span className={fieldLabelClass}>Push scope</span>
        <Select aria-label="Push scope" className={selectClass("default", "w-full")} value={scope} onChange={event => { setScope(event.target.value as "selected" | "all"); setSelection(null); renew(); }}>
          <option value="selected">Compare and select files</option>
          <option value="all">All items in this {local ? "export" : "download"}</option>
        </Select>
      </label>
      {scope === "selected" && <WordPressPushSelection key={`${siteId}:${selectedId}`} endpoint={`/wordpress-manager/connect/${encodeURIComponent(siteId)}/pushes`} source={source} disabled={pushes.pending.length > 0} onChange={value => { setSelection(value); renew(); }} />}
    </Step>}

    {source && <Step n={3} title="Options">
      {warnings.map(w => <p key={w.code} className="text-xs text-status-warning">{w.message}</p>)}
      <DatabasePanel importOptions={draft.importOptions} onImport={options => update(d => ({ ...d, importOptions: options }))} destinationCaps={caps} />
      <ReplacePanel options={draft.importOptions} onChange={options => update(d => ({ ...d, importOptions: options }))} caps={caps} sourceUrl={sourceInfo.url} destinationUrl={target} sourcePath={sourceInfo.path} destinationPath={destination?.wordpress?.abspath} />
      <SafetyPanel options={draft.importOptions} onChange={options => update(d => ({ ...d, importOptions: options }))} caps={caps} />
      {importGate.downgraded.length > 0 && <p className="text-xs text-status-warning">{REQUIRES_040} for: {importGate.downgraded.join(", ")}. These run with the previous behaviour.</p>}
      {importErrors.map(error => <p key={error} className="text-xs text-status-error">{error}</p>)}
    </Step>}

    {source && <Step n={4} title="Confirm">
      <p className="text-xs text-text-secondary">Push does not update WordPress core, the destination's user accounts or its Zoer Connect key. After publishing, check the destination's <a className="underline" href={`${target}/wp-admin/plugins.php`} target="_blank" rel="noreferrer">plugins</a> and <a className="underline" href={`${target}/wp-admin/update-core.php`} target="_blank" rel="noreferrer">WordPress updates</a>.</p>
      <ConfirmDestination target={target} value={confirm} onChange={setConfirm} shared={shared} writers={writers} onWriters={setWriters} disabled={pushes.pending.length > 0} />
      {running && <p className="text-xs text-status-warning">Finish, roll back or cancel the current job below before starting another.</p>}
      <Btn variant="primary" disabled={!ready} loading={pushes.pending.some(c => c.action === "start")} onClick={() => void start()}>{pushButtonLabel(scope, selectedCount)}</Btn>
    </Step>}

    <section className="min-w-0 space-y-2"><h4 className="text-sm font-semibold text-text-heading">Push jobs</h4><PushJobs siteId={siteId} caps={caps} kind="push" /></section>
    {!caps?.importPauseResume && <p className="text-xs text-text-secondary">{REQUIRES_040} to pause and resume imports safely.</p>}
  </div>;
}
