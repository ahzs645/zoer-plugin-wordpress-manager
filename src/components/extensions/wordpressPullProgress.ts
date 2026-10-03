import type { WordPressPullJob } from "../../lib/queries/wordpress-pulls";

export function pullProgress(job: WordPressPullJob) {
  const bytes = job.downloadedBytes ?? job.files.slice(0, job.index).reduce((sum, file) => sum + file.bytes, 0) + job.offset;
  const total = job.totalBytes ?? job.files.reduce((sum, file) => sum + file.bytes, 0);
  // During scanning the manifest is incomplete, so its partial sum is not a total.
  const knownTotal = job.status !== "preparing" && !(job.status === "paused" && job.pausedFrom !== "downloading");
  return { bytes, total: knownTotal ? total : null, percent: knownTotal && total > 0 ? Math.min(100, Math.floor(bytes / total * 100)) : null };
}
export function formatTransferBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const unit = Math.min(3, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** unit).toFixed(2)} ${["B", "KB", "MB", "GB"][unit]}`;
}
export function pullStatus(job: WordPressPullJob) {
  if (job.pendingAction) return job.pendingAction === "pause" ? "Pausing after current batch…" : "Cancelling after current batch…";
  if (job.status === "ready") return "Download complete · Verified";
  if (job.status === "cancelled") return "Cancelled · Download removed";
  if (job.lastError) return "Transfer interrupted";
  if (job.status === "paused") return "Paused";
  if (!job.running) return "Resume needed";
  return job.status === "preparing" ? "Preparing source export" : "Downloading to Zoer";
}

export function pullPreparation(job: WordPressPullJob) {
  const c = job.preparation?.checkpoint;
  if (c?.fileBytes !== undefined) return `Preparing file: ${formatTransferBytes(c.fileOffset ?? 0)} / ${formatTransferBytes(c.fileBytes)}`;
  if (c?.tables !== undefined) return `${c.table ?? 0} / ${c.tables} tables completed · ${(c.rows ?? 0).toLocaleString()} rows saved · ${formatTransferBytes(c.bytes ?? 0)}`;
  return `${(job.preparation?.files ?? 0).toLocaleString()} files found on source · Export preparation`;
}
