import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Eraser, Loader2, Pause, Play, RotateCcw, Trash2, Undo2 } from "lucide-react";
import type { PushCommand, WordPressPushJob, ZoerConnectCapabilities } from "../../../lib/api/types/wordpress-transfer";
import { isActivePush, useWordPressPushes, type PushControl } from "../../../lib/queries/wordpress-transfer";
import { hasCapability } from "../../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { ActionMenu as ActionMenu, type ActionMenuItem } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";
import { formatTransferBytes } from "../wordpressPullProgress";
import ImportReview from "./ImportReview";
import { completionSummary, failureSummary, formatDuration, isTerminalPush, jobElapsed, phaseLabel, pushProgress, pushStatusLabel, uploadTransferSummary } from "./transferLabels";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  return now;
}

const CONFIRM: Partial<Record<PushCommand, (job: WordPressPushJob) => { title: string; description: string; confirmLabel: string; cancelLabel: string }>> = {
  rollback: job => job.status === "complete"
    ? { title: "Roll back this push?", description: "Restores the tables and files Zoer replaced, if the site has not changed since. Content created after the push is lost.", confirmLabel: "Roll back", cancelLabel: "Keep changes" }
    : { title: job.status === "review" ? "Cancel these changes?" : "Cancel and roll back?", description: "Stops the import and discards staged tables. The live site keeps its current content.", confirmLabel: job.status === "review" ? "Discard changes" : "Cancel and roll back", cancelLabel: "Keep going" },
  cleanup: () => ({ title: "Clean up backups?", description: "Deletes the backup tables, staged artifacts and file backups on the destination. Rollback is no longer possible afterwards.", confirmLabel: "Clean up backups", cancelLabel: "Keep backups" }),
  delete: () => ({ title: "Delete this record?", description: "Removes the job from Zoer's list. The WordPress site is unchanged.", confirmLabel: "Delete record", cancelLabel: "Keep record" }),
};

export function PushJobCard({ job, caps, pending, onCommand }: { job: WordPressPushJob; caps?: ZoerConnectCapabilities; pending: PushCommand | null; onCommand: (command: PushControl) => Promise<unknown> }) {
  const dialogs = useDialogs();
  const active = isActivePush(job);
  const now = useNow(active || job.status === "paused");
  const progress = pushProgress(job);
  const terminal = isTerminalPush(job);
  const failed = job.status === "failed" || (!!job.lastError && !terminal && job.status !== "review" && job.status !== "verification");
  const busy = pending !== null;
  const noun = job.kind === "replace" ? "Find & replace" : "Push";
  async function run(action: PushCommand) {
    const confirm = CONFIRM[action]?.(job);
    if (confirm && !await dialogs.confirm({ ...confirm, tone: "danger" })) return;
    await onCommand({ id: job.id, action }).catch(() => { /* shown by the list */ });
  }
  const menu: ActionMenuItem[] = [
    ...(job.status === "complete" && !job.cleanedUp ? [{ label: "Roll back…", icon: <Undo2 className="h-4 w-4" />, tone: "danger" as const, disabled: busy, onClick: () => void run("rollback") }] : []),
    ...(terminal && !job.cleanedUp && hasCapability(caps, "importCleanup") ? [{ label: "Clean up backups…", icon: <Eraser className="h-4 w-4" />, disabled: busy, onClick: () => void run("cleanup") }] : []),
    ...(terminal ? [{ label: "Delete record…", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, disabled: busy, onClick: () => void run("delete") }] : []),
  ];
  const icon = pending || active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
    : job.status === "complete" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
    : failed ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> : null;
  const tone = job.status === "complete" ? "text-status-success" : failed ? "text-status-error" : job.status === "review" || job.status === "verification" ? "text-status-warning" : "text-text-primary";
  return <article className="min-w-0 space-y-2 rounded-lg border border-border-muted bg-surface-primary/40 p-3" aria-label={`${noun} started ${new Date(job.createdAt).toLocaleString()}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p role="status" className={`flex items-center gap-2 text-sm font-medium ${tone}`}>{icon}{pending ? `${pushStatusLabel(job)} · updating…` : pushStatusLabel(job)}</p>
        <p className="mt-1 break-words text-xs text-text-secondary">
          {job.source?.name ? `${job.source.name} → ` : job.kind === "replace" ? "This site's database · " : ""}{job.target ? <span className="break-all">{job.target}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">Started {new Date(job.startedAt || job.createdAt).toLocaleString()} · {formatDuration(jobElapsed(job, now))}{job.cleanedUp ? " · Backups cleaned up" : ""}</p>
      </div>
      <div className="shrink-0"><ActionMenu size="sm" label={`More actions for ${noun.toLowerCase()} started ${new Date(job.createdAt).toLocaleString()}`} items={menu} /></div>
    </div>

    {!terminal && job.status !== "review" && <div className="min-w-0 space-y-1">
      <p className="text-xs text-text-secondary">Stage: <span className="text-text-primary">{phaseLabel(job.phase)}</span></p>
      {progress.percent !== null && <progress aria-label={`${noun} progress`} className="h-2 w-full accent-indigo-500" value={progress.percent} max={100} />}
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs tabular-nums text-text-secondary">
        {progress.total ? <span>{formatTransferBytes(progress.bytes)} / {formatTransferBytes(progress.total)}</span> : progress.fileCount ? <span>{(progress.filesUploaded ?? 0).toLocaleString()} / {progress.fileCount.toLocaleString()} files</span> : <span />}
        {progress.tableCount ? <span>Table {Math.min(progress.tableIndex ?? 0, progress.tableCount).toLocaleString()} / {progress.tableCount.toLocaleString()}{progress.rowsRead ? ` · ${progress.rowsRead.toLocaleString()} rows` : ""}</span> : progress.rowsRead ? <span>{progress.rowsRead.toLocaleString()} rows</span> : null}
        {progress.percent !== null && <span>{progress.percent}%</span>}
      </div>
      {uploadTransferSummary(job) && <p className="text-xs tabular-nums text-text-secondary">{uploadTransferSummary(job)}</p>}
    </div>}

    {job.warnings?.map(warning => <p key={warning} className="text-xs text-status-warning">{warning}</p>)}
    {job.authors && <p className="text-xs text-text-secondary">Authors: {job.authors.matched.toLocaleString()} matched{job.authors.fallback ? `, ${job.authors.fallback.toLocaleString()} assigned to the administrator` : ""}.</p>}

    {failed && <div role="alert" className="min-w-0 space-y-1 rounded-md border border-status-error/40 bg-status-error/10 p-2 text-sm">
      <p className="font-medium text-status-error">{failureSummary(job)}</p>
      {job.lastError?.message && <p className="break-words text-text-primary">{job.lastError.message}</p>}
      <p className="text-xs text-text-secondary">The live site is protected by the recovery journal. Retry continues from the saved checkpoint, or cancel to roll back.</p>
    </div>}

    {job.status === "review" && <div className="min-w-0 space-y-3 rounded-md border border-status-warning/40 p-3">
      <p className="text-sm">Everything is staged and the site is still online. Check the changes, then apply them or cancel.</p>
      <ImportReview stats={job.review ?? job.stats} />
      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" disabled={busy} loading={pending === "approve"} onClick={() => void run("approve")}>Apply changes</Btn>
        <Btn variant="ghost" disabled={busy} loading={pending === "rollback"} onClick={() => void run("rollback")}>Cancel</Btn>
      </div>
    </div>}

    {job.status === "verification" && <p className="text-sm text-text-secondary">The new content is active and WordPress is paused for visitors. Check the site, then finish to reopen it, or roll back.</p>}
    {job.status === "complete" && <p className="text-sm text-status-success">{completionSummary(job)}</p>}
    {job.status === "complete" && job.stats && job.kind === "push" && (job.stats.replacements ?? 0) > 0 && <p className="text-xs text-text-secondary">{job.stats.replacements!.toLocaleString()} URL and path replacements.</p>}
    {job.status === "complete" && !job.cleanedUp && <p className="text-xs text-text-secondary">Backups are kept on the destination so you can roll back. Clean them up from More actions when you are satisfied.</p>}

    {!terminal && job.status !== "review" && <div className="flex flex-wrap gap-2">
      {active && <Btn size="sm" icon={<Pause className="h-4 w-4" />} disabled={busy} loading={pending === "pause"} onClick={() => void run("pause")}>Pause</Btn>}
      {job.status === "paused" && !failed && <Btn size="sm" variant="primary" icon={<Play className="h-4 w-4" />} disabled={busy} loading={pending === "resume"} onClick={() => void run("resume")}>Resume</Btn>}
      {failed && <Btn size="sm" variant="primary" icon={<RotateCcw className="h-4 w-4" />} disabled={busy} loading={pending === "run"} onClick={() => void run("run")}>Retry</Btn>}
      {!active && !failed && (job.status === "running" || job.status === "queued") && <Btn size="sm" variant="primary" icon={<Play className="h-4 w-4" />} disabled={busy} loading={pending === "run"} onClick={() => void run("run")}>Resume</Btn>}
      {job.status === "verification" && <Btn size="sm" variant="primary" disabled={busy} loading={pending === "finish"} onClick={() => void run("finish")}>Finish and reopen site</Btn>}
      <Btn size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} disabled={busy} loading={pending === "rollback"} onClick={() => void run("rollback")}>{job.status === "verification" ? "Roll back" : "Cancel (roll back)"}</Btn>
    </div>}
  </article>;
}

/** Push and Find & Replace jobs for a destination. `compact` shows only unfinished jobs and renders nothing otherwise. */
export default function PushJobs({ siteId, caps, compact = false, kind }: { siteId: string; caps?: ZoerConnectCapabilities; compact?: boolean; kind?: "push" | "replace" }) {
  const pushes = useWordPressPushes(siteId);
  const jobs = pushes.jobs.filter(job => !kind || job.kind === kind);
  const visible = compact ? jobs.filter(job => !isTerminalPush(job)) : jobs.slice(0, 5);
  const older = compact ? [] : jobs.slice(5);
  if (compact && !visible.length) return null;
  const pendingFor = (id: string) => {
    const command = pushes.pending.find(c => c.action !== "start" && "id" in c && c.id === id);
    return command && command.action !== "start" ? command.action as PushCommand : null;
  };
  const card = (job: WordPressPushJob) => <PushJobCard key={job.id} job={job} caps={caps} pending={pendingFor(job.id)} onCommand={pushes.command} />;
  return <div className="min-w-0 space-y-3">
    {visible.some(job => !isTerminalPush(job)) && <p className="text-xs text-text-secondary">{kind === "replace" ? "Find & Replace" : "Push"} runs on the Zoer server. You can close this dialog or leave the page.</p>}
    {pushes.error && <p role="alert" className="text-sm text-status-error">Could not refresh jobs: {pushes.error.message} <Btn size="sm" onClick={() => void pushes.refetch()}>Retry</Btn></p>}
    {visible.map(card)}
    {older.length > 0 && <details data-zoer-disclosure><summary className="text-sm text-text-secondary">Earlier jobs ({older.length})</summary><div className="mt-3 space-y-3">{older.map(card)}</div></details>}
    {pushes.commandError && <p role="alert" className="text-sm text-status-error">{pushes.commandError.message}</p>}
  </div>;
}
