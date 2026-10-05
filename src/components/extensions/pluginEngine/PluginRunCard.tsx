import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eraser, Loader2, Pause, Play, ShieldCheck, Undo2, X } from "lucide-react";
import { Btn, StatusBadge, useDialogs } from "@zoer/plugin-ui/controls";
import { cancelRun, controlImport, engineKeys, pauseRun, resumeRun, useEngineRun } from "../../../lib/queries/plugin-engine";
import { formatTransferBytes } from "../wordpressPullProgress";
import { formatDuration } from "../wordpressTransfer/transferLabels";
import { describeRun, engineErrorMessage, runInput, type RecentRun, type RunButton } from "./runState";

type Output = Record<string, unknown>;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown) => typeof value === "string" && value ? value : null;

const CONFIRM: Partial<Record<RunButton, (kind: string) => { title: string; description: string; confirmLabel: string; cancelLabel: string }>> = {
  cancel: kind => kind === "push" || kind === "replace"
    ? { title: "Cancel and roll back?", description: "Stops after the current step and rolls the destination import back. The live site keeps its current content.", confirmLabel: "Cancel and roll back", cancelLabel: "Keep going" }
    : { title: "Cancel this transfer?", description: "Stops after the current step. Partial files kept on the Zoer server are removed.", confirmLabel: "Cancel transfer", cancelLabel: "Keep going" },
  rollback: () => ({ title: "Roll back this import?", description: "Restores the tables and files the import replaced, if the site has not changed since. Content created afterwards is lost.", confirmLabel: "Roll back", cancelLabel: "Keep changes" }),
  cleanup: () => ({ title: "Clean up backups?", description: "Deletes the backup tables, staged artifacts and file backups on the destination. Rollback is no longer possible afterwards.", confirmLabel: "Clean up backups", cancelLabel: "Keep backups" }),
};

const BUTTONS: Record<RunButton, { label: string; icon: React.ReactNode; variant: "primary" | "secondary" | "ghost" | "danger" }> = {
  pause: { label: "Pause", icon: <Pause className="h-4 w-4" />, variant: "secondary" },
  resume: { label: "Resume", icon: <Play className="h-4 w-4" />, variant: "primary" },
  reapprove: { label: "Review and approve again", icon: <ShieldCheck className="h-4 w-4" />, variant: "primary" },
  cancel: { label: "Cancel", icon: <X className="h-4 w-4" />, variant: "ghost" },
  approve: { label: "Approve and activate", icon: <CheckCircle2 className="h-4 w-4" />, variant: "primary" },
  finish: { label: "Finish and reopen site", icon: <CheckCircle2 className="h-4 w-4" />, variant: "primary" },
  rollback: { label: "Roll back", icon: <Undo2 className="h-4 w-4" />, variant: "ghost" },
  cleanup: { label: "Clean up backups", icon: <Eraser className="h-4 w-4" />, variant: "ghost" },
};

/** Dry-run plans and results the transfer workers return. */
function RunOutput({ output }: { output: Output }) {
  const plan = output.plan && typeof output.plan === "object" ? output.plan as Output : null;
  const components = Array.isArray(plan?.components) ? plan.components as Output[] : [];
  const warnings = [...(Array.isArray(output.warnings) ? output.warnings : []), ...(Array.isArray(plan?.warnings) ? plan.warnings : [])].filter((w): w is string => typeof w === "string");
  const stats = output.stats && typeof output.stats === "object" ? output.stats as Output : null;
  const transfer = output.transfer && typeof output.transfer === "object" ? output.transfer as Output : null;
  const targetUrl = text(output.targetUrl), targetId = text(output.targetId);
  const facts = [
    num(output.fileCount) !== null && `${num(output.fileCount)!.toLocaleString()} files`,
    num(output.totalBytes) ? formatTransferBytes(num(output.totalBytes)!) : null,
    num(output.skippedCount) ? `${num(output.skippedCount)!.toLocaleString()} skipped` : null,
    stats && num(stats.replacements) ? `${num(stats.replacements)!.toLocaleString()} replacements` : null,
    transfer && num(transfer.requests) ? `${num(transfer.requests)!.toLocaleString()} upload requests (${text(transfer.transport) ?? "batch"})` : null,
  ].filter(Boolean) as string[];
  return <div className="min-w-0 space-y-2 text-xs">
    {text(output.summary) && <p className="break-words text-sm text-text-primary">{text(output.summary)}</p>}
    {facts.length > 0 && <p className="tabular-nums text-text-secondary">{facts.join(" · ")}</p>}
    {plan && !components.length && <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-border-muted p-2 sm:grid-cols-2" aria-label="Dry-run plan">
      {text(plan.target) && <div className="min-w-0"><dt className="text-text-secondary">Destination</dt><dd className="break-all">{text(plan.target)}</dd></div>}
      {num(plan.files) !== null && <div><dt className="text-text-secondary">Files</dt><dd className="tabular-nums">{num(plan.files)!.toLocaleString()}</dd></div>}
      {typeof plan.database === "boolean" && <div><dt className="text-text-secondary">Database</dt><dd>{plan.database ? "Replaced" : "Not included"}</dd></div>}
      {num(plan.bytes) !== null && <div><dt className="text-text-secondary">Size</dt><dd className="tabular-nums">{formatTransferBytes(num(plan.bytes)!)}</dd></div>}
      {typeof plan.batchUpload === "boolean" && <div><dt className="text-text-secondary">Upload</dt><dd>{plan.batchUpload ? "Batched" : "One file per request"}</dd></div>}
    </dl>}
    {components.length > 0 && <ul className="min-w-0 divide-y divide-border-muted rounded-md border border-border-muted" aria-label="Dry-run restore plan">
      {components.map((component, index) => <li key={index} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
        <span className="min-w-0 break-all"><span className="font-medium capitalize">{text(component.component) ?? "component"}</span> · {text(component.name)}</span>
        <span className="shrink-0 tabular-nums text-text-secondary">{num(component.files) !== null ? `${num(component.files)!.toLocaleString()} files · ` : ""}{formatTransferBytes(num(component.expandedBytes) ?? num(component.bytes) ?? 0)}</span>
      </li>)}
    </ul>}
    {warnings.map(warning => <p key={warning} className="break-words text-status-warning">{warning}</p>)}
    {(targetUrl || targetId) && <div className="flex flex-wrap gap-x-4 gap-y-1">
      {targetUrl && <a className="inline-flex min-h-11 items-center underline sm:min-h-0" href={targetUrl} target="_blank" rel="noreferrer">Open local website</a>}
      {targetId && <a className="inline-flex min-h-11 items-center underline sm:min-h-0" href={`#/wordpress?site=${encodeURIComponent(targetId)}`}>View local site</a>}
    </div>}
  </div>;
}

/**
 * One plugin-engine run: live phase and progress from `run.resumable`, Pause/Resume/Cancel through
 * `run.pause`/`run.resume`/`cancel`, and the import decisions (Approve, Finish, Roll back, Clean up)
 * through `transfer.push.control` followed by `run.resume` so the push continues.
 */
export default function PluginRunCard({ recent, title, kind = "other", siteId }: { recent: RecentRun; title: string; kind?: "push" | "replace" | "other"; siteId?: string }) {
  const dialogs = useDialogs();
  const client = useQueryClient();
  const detail = useEngineRun<Output>(recent.runId);
  const run = detail.data ?? { id: recent.runId, status: recent.status, resumable: recent.resumable, error: recent.error, statusReason: null, output: null };
  const view = describeRun(run, kind);
  const input = runInput(recent);
  const importId = typeof input.importId === "string" ? input.importId : typeof (run.output as Output | null)?.importId === "string" ? (run.output as Output).importId as string : null;
  const target = typeof input.siteId === "string" ? input.siteId : siteId;
  const [pending, setPending] = useState<RunButton | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const started = Date.parse(recent.createdAt);
  const ended = Date.parse(recent.finishedAt ?? run.completedAt ?? "");

  async function act(button: RunButton) {
    const confirm = CONFIRM[button]?.(kind);
    if (confirm && !await dialogs.confirm({ ...confirm, tone: "danger" })) return;
    setPending(button); setError(""); setNotice("");
    try {
      if (button === "pause") await pauseRun(run.id);
      else if (button === "resume") await resumeRun(run.id);
      else if (button === "reapprove") await resumeRun(run.id, true);
      else if (button === "cancel") await cancelRun(run.id);
      else {
        if (!importId || !target) throw new Error("This run does not name its import. Open it from the site's transfers.");
        const result = await controlImport({ siteId: target, importId, control: button });
        if (typeof result.summary === "string") setNotice(result.summary);
        // The push run waits as needs-user; resume it so it reads the new import phase.
        if (!view.terminal && button !== "cleanup") await resumeRun(run.id);
      }
    } catch (caught) { setError(engineErrorMessage(caught)); }
    finally {
      setPending(null);
      await Promise.all([client.invalidateQueries({ queryKey: engineKeys.run(run.id) }), client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] })]);
    }
  }

  const icon = view.working ? <Loader2 className="animate-spin" aria-hidden="true" /> : view.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : view.tone === "error" || view.tone === "warning" ? <AlertTriangle aria-hidden="true" /> : undefined;
  const output = run.output && typeof run.output === "object" ? run.output as Output : null;
  return <article className="min-w-0 space-y-2 rounded-lg border border-border-muted bg-surface-primary/40 p-3" aria-label={`${title} started ${Number.isFinite(started) ? new Date(started).toLocaleString() : ""}`}>
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          <span className="break-words">{title}</span>
          {input.dryRun === true && <span className="rounded border border-border-muted px-1.5 py-0.5 text-[12px] font-normal text-text-secondary">Dry run</span>}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-text-secondary">{Number.isFinite(started) ? `Started ${new Date(started).toLocaleString()}` : ""}{Number.isFinite(started) && Number.isFinite(ended) ? ` · ${formatDuration(ended - started)}` : ""}</p>
      </div>
      <span role="status"><StatusBadge tone={view.tone} icon={icon}>{pending ? `${view.label} · updating…` : view.label}</StatusBadge></span>
    </div>

    {!view.terminal && view.progress && <div className="min-w-0 space-y-1">
      <p className="text-xs text-text-secondary">Stage: <span className="text-text-primary">{view.progress.label}</span></p>
      {view.progress.percent !== null && <progress aria-label={`${title} progress`} className="h-2 w-full accent-indigo-500" value={view.progress.percent} max={100} />}
      {(view.progress.detail || view.progress.percent !== null) && <div className="flex flex-wrap justify-between gap-x-3 text-xs tabular-nums text-text-secondary">
        <span>{view.progress.detail}</span>{view.progress.percent !== null && <span>{view.progress.percent}%</span>}
      </div>}
      {view.progress.message && <p className="break-words text-xs text-text-secondary">{view.progress.message}</p>}
    </div>}
    {!view.terminal && run.resumable?.nextStepAt && run.resumable.state === "waiting" && <p className="text-xs text-text-secondary">Next attempt {new Date(run.resumable.nextStepAt).toLocaleTimeString()}.</p>}

    {view.reason && <p className={`break-words text-sm ${view.tone === "error" ? "text-status-error" : view.needsUser ? "text-text-primary" : "text-text-secondary"}`} role={view.tone === "error" ? "alert" : undefined}>{view.reason}</p>}
    {view.needsUser === "review" && <p className="text-xs text-text-secondary">Everything is staged and the site is still online. Approve to activate the changes, or roll back to discard them. Each decision asks for Zoer's approval.</p>}
    {view.needsUser === "verify" && <p className="text-xs text-text-secondary">The new content is active and WordPress is paused for visitors. Check the site, then finish to reopen it, or roll back.</p>}
    {output && view.terminal && <RunOutput output={output} />}
    {view.terminal && output?.status === "complete" && output.cleanedUp !== true && (kind === "push" || kind === "replace") && <p className="text-xs text-text-secondary">Backups are kept on the destination so you can roll back. Clean them up when you are satisfied.</p>}

    {view.buttons.length > 0 && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {view.buttons.map(button => <Btn key={button} size="sm" className="w-full sm:w-auto" variant={BUTTONS[button].variant} icon={BUTTONS[button].icon} disabled={pending !== null} loading={pending === button} onClick={() => void act(button)}>{BUTTONS[button].label}</Btn>)}
    </div>}
    {notice && <p role="status" className="break-words text-sm text-status-success">{notice}</p>}
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {detail.error && <p className="text-xs text-text-secondary">Could not refresh this run: {detail.error instanceof Error ? detail.error.message : "unknown error"}.</p>}
  </article>;
}
