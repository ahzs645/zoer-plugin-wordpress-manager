import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, Eraser, Loader2, Pause, Play, ShieldCheck, Undo2, X } from "lucide-react";
import { Btn, StatusBadge, useDialogs } from "@zoer/plugin-ui/controls";
import { cancelRun, controlImport, engineKeys, pauseRun, resumeRun, useEngineRun, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { completedPushUrl } from "../publishGuidance";
import { formatTransferBytes } from "../wordpressPullProgress";
import { formatDuration } from "../wordpressTransfer/transferLabels";
import { describeRun, ENGINE_ACTIONS, engineErrorMessage, importStateFromControls, runInput, type RecentRun, type RunButton } from "./runState";

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

/** The bounded list of files a push left out (`skipped: { count, reason, files }`), or null. */
export function skippedFiles(value: unknown): { count: number; reason: string; files: { path: string; reason: string }[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Output;
  const files = (Array.isArray(raw.files) ? raw.files : []).flatMap(file => file && typeof file === "object" && typeof (file as Output).path === "string" ? [{ path: String((file as Output).path).slice(0, 300), reason: typeof (file as Output).reason === "string" ? String((file as Output).reason).slice(0, 80) : "" }] : []).slice(0, 50);
  const count = num(raw.count) ?? files.length;
  return count ? { count, reason: text(raw.reason) ?? "not accepted by Zoer Connect", files } : null;
}

/** One stage of a local copy or restore: the worker's progress phases (plugin/worker/lib/copy.js PROGRESS_PHASES). */
export interface RunStage { label: string; phases: string[] }

/** `copy.local` stages; a refresh takes a recovery backup, an existing pull skips the download. */
export function localCopyStages(input: Record<string, unknown>): RunStage[] {
  return [
    ...(input.pullSetId ? [] : [{ label: "Pull the source", phases: ["pulling"] }]),
    { label: "Check the download", phases: ["checking"] },
    { label: input.replaceSiteId ? "Start the local copy" : "Create the local site", phases: ["creating site"] },
    ...(input.replaceSiteId ? [{ label: "Recovery backup", phases: ["recovery backup"] }] : []),
    { label: "Stage verified files", phases: ["preparing", "staging files"] },
    { label: copiesUsers(input) ? "Import database and users" : "Import database", phases: ["importing database"] },
    { label: "Place files", phases: ["placing files"] },
    { label: "Verify the local site", phases: ["verifying", "archiving dry-run site", "finishing"] },
  ];
}

const copiesUsers = (input: Record<string, unknown>) => input.users === "source" || input.users === "exact";

/** `backup.restore-local` stages. */
export function restoreStages(input: Record<string, unknown>): RunStage[] {
  return [
    { label: "Check the backup", phases: ["checking"] },
    { label: "Create the local site", phases: ["creating site"] },
    { label: "Stage verified files", phases: ["preparing", "staging files"] },
    { label: "Convert the backup", phases: ["preparing backup"] },
    { label: copiesUsers(input) ? "Import database and users" : "Import database", phases: ["importing database"] },
    { label: "Place files", phases: ["placing files"] },
    { label: "Verify the local site", phases: ["verifying", "archiving dry-run site", "finishing"] },
  ];
}

/** Index of the stage `phase` belongs to (a nested pull reports "pulling: …"), or -1. */
export function stageIndex(stages: RunStage[], phase: string | null | undefined) {
  const base = (phase ?? "").split(":")[0]!.trim();
  return stages.findIndex(stage => stage.phases.includes(base));
}

/** WP Migrate-style checklist of the run's stages: done, current, still to come. */
export function StageList({ stages, current, succeeded }: { stages: RunStage[]; current: number; succeeded: boolean }) {
  return <ol className="min-w-0 space-y-1 text-xs" aria-label="Stages">
    {stages.map((stage, index) => {
      const done = succeeded || (current >= 0 && index < current);
      const active = !succeeded && index === current;
      return <li key={stage.label} className={`flex min-h-6 items-center gap-1.5 ${done ? "text-text-secondary" : active ? "font-medium text-text-primary" : "text-text-muted"}`} aria-current={active ? "step" : undefined}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden="true" /> : active ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 break-words">{stage.label}</span>{done && <span className="sr-only"> (done)</span>}
      </li>;
    })}
  </ol>;
}

/** The local importer's summary (copy.js databaseSummary) as short facts. */
export function databaseFacts(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const db = value as Output;
  const users = db.users && typeof db.users === "object" ? db.users as Output : {};
  const facts = [num(db.tables) !== null ? `${num(db.tables)!.toLocaleString()} tables` : null, num(db.rows) !== null ? `${num(db.rows)!.toLocaleString()} rows` : null,
    num(db.replacements) ? `${num(db.replacements)!.toLocaleString()} URL replacements` : null];
  if (users.mode === "source") facts.push(`${(num(users.copied) ?? 0).toLocaleString()} users and ${(num(users.meta) ?? 0).toLocaleString()} user meta rows copied`);
  else if (users.mode === "exact") facts.push(`${(num(users.copied) ?? 0).toLocaleString()} users and ${(num(users.meta) ?? 0).toLocaleString()} user meta rows copied exactly, no extra administrator`);
  else if (users.mode === "local") facts.push("local accounts kept");
  // Collations the local server lacks (MySQL 8 `_0900_` ones on MariaDB) and what the import used instead.
  for (const c of Array.isArray(db.collations) ? db.collations as Output[] : []) {
    const from = text(c?.from), to = text(c?.to), tables = num(c?.tables);
    if (from && to) facts.push(`collation ${from} → ${to}${tables !== null ? ` in ${tables.toLocaleString()} ${tables === 1 ? "table" : "tables"}` : ""}`);
  }
  return facts.filter((fact): fact is string => !!fact);
}

/** Dry-run plans and results the transfer workers return. */
function RunOutput({ output }: { output: Output }) {
  const plan = output.plan && typeof output.plan === "object" ? output.plan as Output : null;
  const components = Array.isArray(plan?.components) ? plan.components as Output[] : [];
  const warnings = [...(Array.isArray(output.warnings) ? output.warnings : []), ...(Array.isArray(plan?.warnings) ? plan.warnings : [])].filter((w): w is string => typeof w === "string");
  const stats = output.stats && typeof output.stats === "object" ? output.stats as Output : null;
  const transfer = output.transfer && typeof output.transfer === "object" ? output.transfer as Output : null;
  const targetUrl = text(output.targetUrl), targetId = text(output.targetId);
  const skipped = skippedFiles(output.skipped) ?? skippedFiles(plan?.skipped);
  const database = databaseFacts(output.database);
  const users = output.database && typeof output.database === "object" && (output.database as Output).users && typeof (output.database as Output).users === "object" ? (output.database as Output).users as Output : null;
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
    {database.length > 0 && <p className="break-words tabular-nums text-text-secondary"><span className="text-text-primary">Database:</span> {database.join(" · ")}</p>}
    {users?.loginChanged === true && <p className="text-text-secondary">The source already has an account with the local administrator's login, so the local administrator was added as zoer-local-admin.</p>}
    {plan?.users === "source" && <p className="text-text-secondary">Users and user metadata will be copied from the backup, with the local administrator kept.</p>}
    {plan?.users === "exact" && <p className="text-text-secondary">The backup's users and user metadata will replace the local accounts exactly, with no extra administrator.</p>}
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
    {skipped && skipped.files.length > 0 && <details data-zoer-disclosure className="min-w-0">
      <summary className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Skipped files ({skipped.count.toLocaleString()}, {skipped.reason})</summary>
      <ul className="mt-1 min-w-0 space-y-0.5" aria-label="Skipped files">
        {skipped.files.map(file => <li key={file.path} className="break-all"><span className="text-text-primary">{file.path}</span> <span className="text-text-secondary">· {file.reason}</span></li>)}
        {skipped.count > skipped.files.length && <li className="text-text-secondary">and {(skipped.count - skipped.files.length).toLocaleString()} more</li>}
      </ul>
    </details>}
    {(targetUrl || targetId) && <div className="flex flex-wrap gap-x-4 gap-y-1">
      {targetUrl && <a className="inline-flex min-h-11 items-center underline sm:min-h-0" href={targetUrl} target="_blank" rel="noreferrer">Open local website</a>}
      {targetId && <a className="inline-flex min-h-11 items-center underline sm:min-h-0" href={`#/wordpress?site=${encodeURIComponent(targetId)}`}>View local site</a>}
    </div>}
  </div>;
}

/**
 * One transfer run: live phase and progress from `run.resumable`, Pause/Resume/Cancel through
 * `run.pause`/`run.resume`/`cancel`, and the import decisions (Approve, Finish, Roll back, Clean up)
 * through `transfer.push.control` followed by `run.resume` so the push continues.
 */
export default function PluginRunCard({ recent, title, kind = "other", siteId, stages }: { recent: RecentRun; title: string; kind?: "push" | "replace" | "other"; siteId?: string; stages?: RunStage[] }) {
  const dialogs = useDialogs();
  const client = useQueryClient();
  const detail = useEngineRun<Output>(recent.runId);
  const run = detail.data ?? { id: recent.runId, status: recent.status, resumable: recent.resumable, error: recent.error, statusReason: null, output: null };
  const input = runInput(recent);
  const importId = typeof input.importId === "string" ? input.importId : typeof (run.output as Output | null)?.importId === "string" ? (run.output as Output).importId as string : null;
  // A finished push's import may have been rolled back or cleaned up later by the import controls.
  const controls = useRecentRuns([ENGINE_ACTIONS.control], { enabled: kind === "push" || kind === "replace" });
  const later = importStateFromControls(controls.data ?? [], importId);
  const view = describeRun(run, kind, later);
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
  // The completed run validated this exact address against its endpoint; do not link an old run to a later connection URL.
  const publishedUrl = view.terminal ? completedPushUrl({ kind, status: output?.status, dryRun: input.dryRun, rolledBack: later.rolledBack === true, url: input.confirmTarget }) : null;
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

    {stages && !(view.terminal && run.status !== "succeeded") && !(run.status === "succeeded" && output?.status === "dry-run" && output?.plan) && <StageList stages={stages} current={stageIndex(stages, run.resumable?.progress?.phase)} succeeded={run.status === "succeeded"} />}
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
    {view.needsUser === "verify" && <p className="text-xs text-text-secondary">The new content is active and WordPress is paused for visitors. Public browsing is blocked while paused, so an ordinary preview cannot verify the site yet. Review the transfer result, then Finish to reopen and check the website, or Roll back. Backups remain available after Finish.</p>}
    {output && view.terminal && <RunOutput output={output} />}
    {publishedUrl && <div className="space-y-1 text-sm"><a className="inline-flex min-h-11 items-center underline" href={publishedUrl} target="_blank" rel="noopener noreferrer">Open published website</a><p className="text-xs text-text-secondary">Check the home page, important pages and sign-in on the reopened destination. A completed transfer does not verify website behaviour.</p></div>}
    {view.terminal && output?.status === "complete" && output.cleanedUp !== true && !later.rolledBack && !later.cleanedUp && (kind === "push" || kind === "replace") && <p className="text-xs text-text-secondary">Backups are kept on the destination so you can roll back. Clean them up when you are satisfied.</p>}

    {view.buttons.length > 0 && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {view.buttons.map(button => <Btn key={button} size="sm" className="w-full sm:w-auto" variant={BUTTONS[button].variant} icon={BUTTONS[button].icon} disabled={pending !== null} loading={pending === button} onClick={() => void act(button)}>{BUTTONS[button].label}</Btn>)}
    </div>}
    {notice && <p role="status" className="break-words text-sm text-status-success">{notice}</p>}
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {detail.error && <p className="text-xs text-text-secondary">Could not refresh this run: {detail.error instanceof Error ? detail.error.message : "unknown error"}.</p>}
  </article>;
}
