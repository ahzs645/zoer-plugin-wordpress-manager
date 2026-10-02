import { useRef, useState } from "react";
import { DatabaseBackup, Download, Trash2 } from "lucide-react";
import { useWordPressPulls, type WordPressPullJob } from "../../../lib/queries/wordpress-pulls";
import { downloadPullPart, useZoerConnection } from "../../../lib/queries/wordpress-transfer";
import { applyExportCapabilities, defaultExportOptions, newRequestId, pullContents, pullOptionsPayload } from "../../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";
import { formatTransferBytes, pullProgress, pullStatus } from "../wordpressPullProgress";

/** Database-only and complete pulls kept on the Zoer server for a connected site. */
export default function SiteBackups({ siteId, siteName }: { siteId: string; siteName: string }) {
  const dialogs = useDialogs();
  const conn = useZoerConnection(siteId);
  const pulls = useWordPressPulls(siteId);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const request = useRef(newRequestId());
  const status = conn.connection?.status;
  const canPull = !!status?.pull && !!status.stagingReady && pulls.serverRunner;
  const active = pulls.jobs.some(job => job.running || job.pendingAction);
  const backups = pulls.jobs.filter(job => job.status !== "cancelled");
  async function backUp() {
    const { options } = applyExportCapabilities(defaultExportOptions("backup"), status?.capabilities);
    try { await pulls.command({ action: "start", options: pullOptionsPayload(options), requestId: request.current, transferAction: "backup" }); request.current = newRequestId(); } catch { /* commandError */ }
  }
  async function download(job: WordPressPullJob, part: "database" | "archive") {
    setDownloading(`${job.id}:${part}`); setError("");
    try { await downloadPullPart(siteId, job.id, part, `${siteName}-${job.createdAt.slice(0, 10)}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloading(null); }
  }
  async function remove(job: WordPressPullJob) {
    if (!await dialogs.confirm({ title: job.status === "ready" ? "Delete this backup?" : "Cancel this backup?", description: "Removes the files from the Zoer server. The website is unchanged.", confirmLabel: job.status === "ready" ? "Delete backup" : "Cancel backup", cancelLabel: "Keep", tone: "danger" })) return;
    await pulls.command({ id: job.id, action: "cancel" }).catch(() => {});
  }
  return <section className="min-w-0 space-y-3 rounded-md border border-border-default p-3" aria-label="Zoer server backups">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><h4 className="text-[13px] font-semibold text-text-heading">Backups on the Zoer server</h4>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-text-secondary">Database snapshots and complete pulls of this site. Download the database (.sql) or an archive (.tar.gz), or delete them.</p></div>
      <Btn className="w-full shrink-0 sm:w-auto" size="sm" variant="primary" icon={<DatabaseBackup className="h-3.5 w-3.5" />} disabled={!canPull || active || pulls.pending.length > 0} loading={pulls.pending.some(c => c.action === "start")} onClick={() => void backUp()}>Back up database now</Btn>
    </div>
    {status && !canPull && <p className="text-xs text-text-secondary">Enable Pull and private storage in WordPress → Tools → Zoer Connect to create backups.</p>}
    {pulls.isLoading && <p className="text-sm text-text-secondary">Loading backups…</p>}
    {pulls.data && !backups.length && <p className="text-sm text-text-secondary">No backups yet.</p>}
    <ul className="space-y-2">{backups.map(job => {
      const contents = pullContents(job.options);
      const progress = pullProgress(job);
      return <li key={job.id} className="min-w-0 space-y-2 rounded-md border border-border-muted bg-surface-primary/50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-text-primary">{contents.label}</p>
            <p className="text-[12px] text-text-secondary">{new Date(job.createdAt).toLocaleString()}{progress.total ? ` · ${formatTransferBytes(progress.total)}` : ""}{job.status !== "ready" ? ` · ${pullStatus(job)}` : ""}</p>
          </div>
          <Btn size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={pulls.pending.length > 0 || !!job.pendingAction} onClick={() => void remove(job)}>{job.status === "ready" ? "Delete" : "Cancel"}</Btn>
        </div>
        {job.status === "ready" && <div className="flex flex-wrap gap-2">
          {contents.database && <Btn size="sm" icon={<Download className="h-4 w-4" />} loading={downloading === `${job.id}:database`} disabled={downloading !== null} onClick={() => void download(job, "database")}>Database (.sql)</Btn>}
          <Btn size="sm" icon={<Download className="h-4 w-4" />} loading={downloading === `${job.id}:archive`} disabled={downloading !== null} onClick={() => void download(job, "archive")}>Archive (.tar.gz)</Btn>
        </div>}
      </li>;
    })}</ul>
    {(error || pulls.commandError) && <p role="alert" className="text-sm text-status-error">{error || pulls.commandError?.message}</p>}
  </section>;
}
