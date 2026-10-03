import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resourceQueries } from "../../lib/queries/resources";
import { CheckCircle2, Download, Pause, Play, Loader2, Trash2 } from "lucide-react";
import { downloadPullPart, useZoerConnection } from "../../lib/queries/wordpress-transfer";
import PushJobs from "./wordpressTransfer/PushJobs";
import { pullContents, pullIncludesDownloadOnly } from "../../lib/wordpress-transfer/options";
import { useWordPressPulls, type WordPressPullJob } from "../../lib/queries/wordpress-pulls";
import { formatTransferBytes, pullProgress, pullStatus, pullPreparation } from "./wordpressPullProgress";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { ActionMenu as ActionMenu } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";
import { Modal as Modal } from "@zoer/plugin-ui/controls";
import WordPressLocalCopy from "./WordPressLocalCopy";

export function WordPressPullJobs({ siteId, local = false, enabled = true, compact = false, onReady, readyLabel }: {
  siteId: string; local?: boolean; enabled?: boolean; compact?: boolean; onReady?: (id: string) => void; readyLabel?: string;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");
  async function download(job: WordPressPullJob, part: "database" | "archive") {
    setDownloading(`${job.id}:${part}`); setDownloadError("");
    try { await downloadPullPart(siteId, job.id, part, `${job.source?.url?.replace(/^https?:\/\//, "") || "wordpress"}-${job.createdAt.slice(0, 10)}`); }
    catch (error) { setDownloadError(error instanceof Error ? error.message : "Download failed."); }
    finally { setDownloading(null); }
  }
  const pulls = useWordPressPulls(siteId, local);
  const connectors = useQuery({ ...resourceQueries.connectors(), enabled: !local, refetchInterval: 10000 });
  const ddev = connectors.data?.find(c => c.id === "ddev");
  const dialogs = useDialogs();
  const busy = pulls.pending.length > 0;
  async function control(job: WordPressPullJob, action: "run" | "pause" | "cancel") {
    if (action === "cancel" && !await dialogs.confirm({ title: job.status === "ready" ? "Delete verified download?" : "Cancel this pull?",
      description: "This removes the downloaded files from Zoer and requests cleanup of the temporary source export. To download them again, start a new pull. Source content is preserved. Cancelling also resumes a source paused for this export.",
      cancelLabel: "Keep download", confirmLabel: job.status === "ready" ? "Delete download" : "Cancel pull", tone: "danger" })) return;
    await pulls.command({ id: job.id, action }).catch(() => {});
  }
  function row(job: WordPressPullJob) {
    const pending = pulls.pending.find(c => c.action !== "start" && c.id === job.id);
    const pendingAction = pending?.action === "pause" || pending?.action === "cancel" ? pending.action : job.pendingAction;
    const progress = pullProgress(job);
    const terminal = job.status === "ready" || job.status === "cancelled";
    const status = pending?.action === "run" ? "Resuming…" : pullStatus({ ...job, pendingAction });
    return <article key={job.id} className="min-w-0 space-y-2 rounded-lg border border-border-muted bg-surface-primary/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-2 text-sm font-medium ${job.status === "ready" ? "text-status-success" : "text-text-primary"}`} role="status">
            {job.status === "ready" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : job.running || pending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : null}{status}
          </p>
          <p className="mt-1 text-xs text-text-secondary">Started {new Date(job.createdAt).toLocaleString()}{job.options ? ` · ${pullContents(job.options).label}` : ""}</p>
        </div>
        {job.status !== "cancelled" && <div className="shrink-0"><ActionMenu label={`Actions for pull started ${new Date(job.createdAt).toLocaleString()}`} items={[{ label: job.status === "ready" ? "Delete download…" : "Cancel pull…", icon: <Trash2 className="h-4 w-4" />, tone: "danger", disabled: busy || !!job.pendingAction, onClick: () => void control(job, "cancel") }]} /></div>}
      </div>
      {job.status !== "cancelled" && <>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums text-text-secondary">
          <span>{formatTransferBytes(progress.bytes)}{progress.total !== null ? ` / ${formatTransferBytes(progress.total)}` : " transferred · Total size available after scanning"}</span>
          {progress.percent !== null && <span>{progress.percent}%</span>}
        </div>
        {progress.total !== null && progress.total > 0 && <progress aria-label="Bytes downloaded to Zoer" className="h-2 w-full accent-indigo-500" value={progress.bytes} max={progress.total} />}
        <p className="text-xs text-text-secondary">{job.status === "preparing" || progress.total === null
          ? pullPreparation(job)
          : `${job.index.toLocaleString()} / ${(job.fileCount ?? job.files.length).toLocaleString()} files downloaded`}</p>
      </>}
      {job.preparation?.sourcePaused && !terminal && <p className="text-xs text-status-warning">The source is paused for its database export. Cancel resumes the source; pausing this transfer keeps the source paused until the one-hour idle expiry.</p>}
      {job.lastError && <p role="alert" className="break-words text-sm text-status-error">{job.lastError}</p>}
      {!terminal && !job.running && !job.lastError && job.status !== "paused" && <p className="text-xs text-text-secondary">This transfer has no active server worker. Resume from its saved progress.</p>}
      {pendingAction && <p className="text-xs text-text-secondary">Waiting for the current batch to finish safely.</p>}
      {job.status === "ready" && <p className="text-xs text-text-secondary">Saved on the Zoer server. {local || ddev?.active ? "Ready to use." : (ddev?.unavailableReason || "Checking local WordPress availability…")}{!local && job.options !== undefined && !pullContents(job.options).database ? " Local copies need a download that includes the database." : ""}{!local && pullIncludesDownloadOnly(job.options) ? " MU plugins and WordPress core in this download are not pushed or copied." : ""}</p>}
      {job.remoteCleanupPending && <p className="text-xs text-status-warning">Download removed. Source export cleanup is still pending.</p>}
      <div className="flex flex-wrap gap-2">
        {job.status === "ready" && onReady && <Btn size="sm" disabled={!local && !readyLabel && (!ddev?.active || (job.options !== undefined && !pullContents(job.options).database))} onClick={() => onReady(job.id)}>{readyLabel ?? (local ? "Use this export" : "Make a local copy")}</Btn>}
        {job.status === "ready" && !local && pullContents(job.options).database !== false && <Btn size="sm" icon={<Download className="h-4 w-4" />} loading={downloading === `${job.id}:database`} disabled={downloading !== null} onClick={() => void download(job, "database")}>Database (.sql)</Btn>}
        {job.status === "ready" && !local && <Btn size="sm" icon={<Download className="h-4 w-4" />} loading={downloading === `${job.id}:archive`} disabled={downloading !== null} onClick={() => void download(job, "archive")}>Archive (.tar.gz)</Btn>}
        {!terminal && <Btn size="sm" disabled={busy || !!job.pendingAction || (!job.running && (!enabled || !pulls.serverRunner))} icon={job.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => void control(job, job.running ? "pause" : "run")}>{job.running ? "Pause" : job.lastError ? "Retry pull" : "Resume pull"}</Btn>}
        {job.status === "cancelled" && job.remoteCleanupPending && <Btn size="sm" disabled={busy} onClick={() => void control(job, "cancel")}>Retry source cleanup</Btn>}
      </div>
    </article>;
  }
  const visible = compact ? pulls.jobs.filter((job, i) => i === 0 || job.running || job.pendingAction) : pulls.jobs.filter(job => job.status !== "cancelled");
  const history = pulls.jobs.filter(job => !visible.includes(job));
  return <div className="min-w-0 space-y-3">
    {pulls.serverRunner && <p className="text-xs text-text-secondary">Pulls run on the Zoer server. You can close the dialog or leave this page.</p>}
    {pulls.data && !pulls.jobs.length && <p className="text-sm text-text-secondary">No transfers yet.</p>}
    {pulls.isLoading && <p className="text-sm text-text-secondary">Loading transfers…</p>}
    {pulls.error && <p role="alert" className="text-sm text-status-error">Could not refresh transfers: {pulls.error.message} <Btn size="sm" onClick={() => void pulls.refetch()}>Retry</Btn></p>}
    {pulls.data && !pulls.serverRunner && <p className="text-xs text-status-warning">Deploy the matching backend update to enable server-run pulls. Existing downloads are preserved.</p>}
    {visible.map(row)}
    {history.length > 0 && <details data-zoer-disclosure><summary className="text-sm text-text-secondary">Previous transfers ({history.length})</summary><div className="mt-3 space-y-3">{history.map(row)}</div></details>}
    {pulls.commandError && <p role="alert" className="text-sm text-status-error">{pulls.commandError.message}</p>}
    {downloadError && <p role="alert" className="text-sm text-status-error">{downloadError}</p>}
  </div>;
}

export default function WordPressTransferSummary({ siteId }: { siteId: string }) {
  const [copyPull, setCopyPull] = useState<string | null>(null);
  const caps = useZoerConnection(siteId).connection?.status.capabilities;
  return <section className="mb-4 min-w-0 space-y-3 rounded-lg border border-border-default p-3">
    <div><h4 className="text-sm font-medium">Site transfers</h4><p className="mt-1 text-xs text-text-secondary">Downloads, pushes and saved progress for this site.</p></div>
    <PushJobs siteId={siteId} caps={caps} compact />
    <WordPressPullJobs siteId={siteId} compact onReady={setCopyPull} />
    {copyPull && <Modal title="Make a local copy" onClose={() => setCopyPull(null)}><WordPressLocalCopy siteId={siteId} pullId={copyPull} /></Modal>}
  </section>;
}
