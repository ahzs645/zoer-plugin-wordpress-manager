/**
 * Plugin-engine runs (Zoer docs/plugin-resumable-actions.md): maps a run and its `resumable`
 * summary to the label, tone, progress and buttons the run card shows. Pure; no host calls.
 */
import { formatTransferBytes } from "../wordpressPullProgress";
import { phaseLabel } from "../wordpressTransfer/transferLabels";

export type ResumableState = "running" | "waiting" | "paused" | "paused-for-update" | "resume-needed" | "needs-user";
export type ResumableUnit = "bytes" | "files" | "items" | "rows" | "steps";
export interface ResumableProgress { phase: string; done?: number; total?: number; unit?: ResumableUnit; message?: string }
export interface ResumableSummary {
  state: ResumableState;
  slices: number;
  progress: ResumableProgress | null;
  nextStepAt: string | null;
  lastError: { code: string; message: string } | null;
  consecutiveFailures: number;
  lockKey: string | null;
}
export interface EngineRun<T = unknown> {
  id: string;
  actionId?: string;
  status: string;
  error?: string | null;
  statusReason?: string | null;
  output?: T | null;
  resumable?: ResumableSummary;
  createdAt?: string;
  completedAt?: string | null;
}
/** One entry of `runs.recent`. */
export interface RecentRun {
  runId: string;
  actionId: string;
  presetId?: string;
  status: string;
  resumable?: ResumableSummary;
  createdAt: string;
  finishedAt?: string;
  input: unknown;
  error?: string;
}

export const ENGINE_ACTIONS = {
  pull: "transfer.pull",
  localExport: "transfer.local-export",
  preview: "transfer.preview",
  push: "transfer.push",
  replace: "transfer.replace",
  control: "transfer.push.control",
  copy: "copy.local",
  restore: "backup.restore-local",
} as const;
export type EngineActionId = typeof ENGINE_ACTIONS[keyof typeof ENGINE_ACTIONS];

export const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "outcome_unknown"];
export const isTerminalStatus = (status: string) => TERMINAL_STATUSES.includes(status);

export type RunButton = "pause" | "resume" | "reapprove" | "cancel" | "approve" | "finish" | "rollback" | "cleanup";
export type NeedsUserKind = "review" | "verify" | "reapprove" | "connection" | "upload" | "other";
export type RunTone = "success" | "running" | "warning" | "error" | "info" | "neutral";

/** Which decision a `needs-user` run is waiting for, from its reason. */
export function needsUserKind(reason: string | null | undefined): NeedsUserKind {
  const text = (reason ?? "").trim();
  if (text.startsWith("Review the import before it is activated")) return "review";
  if (text.startsWith("Verify the destination site")) return "verify";
  if (/Review and approve to continue/i.test(text)) return "reapprove";
  if (/connection changed/i.test(text)) return "connection";
  if (text.startsWith("Upload paused after repeated failures")) return "upload";
  return "other";
}

const UNIT_NOUN: Record<ResumableUnit, string> = { bytes: "", files: "files", items: "items", rows: "rows", steps: "steps" };

export interface ProgressView { label: string; percent: number | null; detail: string | null; message: string | null }

export function progressView(progress: ResumableProgress | null | undefined): ProgressView | null {
  if (!progress?.phase) return null;
  const pulling = /^pulling:\s*(.*)$/i.exec(progress.phase);
  const label = pulling ? `Pulling · ${phaseLabel(pulling[1].trim() || "working")}` : phaseLabel(progress.phase.replace(/\s+/g, "_"));
  const done = typeof progress.done === "number" && progress.done >= 0 ? progress.done : null;
  const total = typeof progress.total === "number" && progress.total > 0 ? progress.total : null;
  const percent = done !== null && total !== null ? Math.min(100, Math.floor(done / total * 100)) : null;
  const unit = progress.unit;
  const amount = (value: number) => unit === "bytes" ? formatTransferBytes(value) : value.toLocaleString();
  const noun = unit && UNIT_NOUN[unit] ? ` ${UNIT_NOUN[unit]}` : "";
  const detail = done === null ? null : total !== null ? `${amount(done)} / ${amount(total)}${noun}` : `${amount(done)}${noun}`;
  return { label, percent, detail, message: progress.message?.trim() || null };
}

export interface RunView {
  label: string;
  tone: RunTone;
  terminal: boolean;
  /** Work is happening now (a spinner is appropriate). */
  working: boolean;
  needsUser: NeedsUserKind | null;
  /** Why the run waits or failed, for display. */
  reason: string | null;
  progress: ProgressView | null;
  buttons: RunButton[];
  dryRun: boolean;
}

type PushOutput = { status?: string; cleanedUp?: boolean; summary?: string };

/** Label, tone, progress and the buttons that apply to one run. `kind` picks push/replace-only controls. */
export function describeRun(run: Pick<EngineRun<unknown>, "status" | "error" | "statusReason" | "output" | "resumable">, kind: "push" | "replace" | "other" = "other"): RunView {
  const output = (run.output && typeof run.output === "object" ? run.output : {}) as PushOutput;
  const dryRun = output.status === "dry-run";
  const progress = progressView(run.resumable?.progress);
  const remote = kind === "push" || kind === "replace";
  const base = { progress, dryRun, needsUser: null as NeedsUserKind | null };
  if (run.status === "succeeded") {
    if (output.status === "rolled_back") return { ...base, label: "Rolled back · nothing was activated", tone: "neutral", terminal: true, working: false, reason: output.summary ?? null, buttons: [] };
    const cleanup = remote && output.status === "complete" && output.cleanedUp !== true;
    return { ...base, label: dryRun ? "Dry run complete · nothing was changed" : "Complete", tone: "success", terminal: true, working: false, reason: null, buttons: cleanup ? ["rollback", "cleanup"] : [] };
  }
  if (run.status === "failed") return { ...base, label: "Failed", tone: "error", terminal: true, working: false, reason: run.error || run.resumable?.lastError?.message || "The transfer failed.", buttons: [] };
  if (run.status === "cancelled") return { ...base, label: "Cancelled", tone: "neutral", terminal: true, working: false, reason: run.error || null, buttons: [] };
  if (run.status === "outcome_unknown") return { ...base, label: "Outcome unknown", tone: "warning", terminal: true, working: false, reason: run.error || "Zoer could not confirm whether the last step finished. Check the destination site before starting again.", buttons: [] };
  if (run.status === "waiting_for_approval") return { ...base, label: "Waiting for your approval", tone: "warning", terminal: false, working: false, reason: "Approve or decline the request in Zoer's approval dialog.", buttons: ["cancel"] };
  const resumable = run.resumable;
  if (!resumable) return { ...base, label: run.status === "running" || run.status === "claimed" ? "Running" : "Queued", tone: "running", terminal: false, working: true, reason: run.statusReason ?? null, buttons: ["cancel"] };
  const lastError = resumable.lastError?.message ?? null;
  switch (resumable.state) {
    case "running": return { ...base, label: "Running", tone: "running", terminal: false, working: true, reason: null, buttons: ["pause", "cancel"] };
    case "waiting": return { ...base, label: lastError ? `Retrying${resumable.consecutiveFailures > 1 ? ` (attempt ${resumable.consecutiveFailures + 1})` : ""}` : "Waiting", tone: lastError ? "warning" : "running", terminal: false, working: true, reason: lastError ?? run.statusReason ?? null, buttons: ["pause", "cancel"] };
    case "paused": return { ...base, label: "Paused", tone: "neutral", terminal: false, working: false, reason: null, buttons: ["resume", "cancel"] };
    case "paused-for-update": return { ...base, label: "Paused for a Zoer update", tone: "info", terminal: false, working: false, reason: "Continues automatically after the update.", buttons: ["cancel"] };
    case "resume-needed": return { ...base, label: "Resume needed", tone: "warning", terminal: false, working: false, reason: run.statusReason || "Zoer restarted during this step. Resume to continue from the last saved point.", buttons: ["resume", "cancel"] };
    case "needs-user": {
      const reason = run.statusReason ?? lastError ?? null;
      const need = needsUserKind(reason);
      if (need === "review" && remote) return { ...base, needsUser: need, label: kind === "replace" ? "Review the replacements" : "Review the import", tone: "warning", terminal: false, working: false, reason, buttons: ["approve", "rollback"] };
      if (need === "verify" && remote) return { ...base, needsUser: need, label: "Verify the destination", tone: "warning", terminal: false, working: false, reason, buttons: ["finish", "rollback"] };
      if (need === "reapprove") return { ...base, needsUser: need, label: "Approval needed to continue", tone: "warning", terminal: false, working: false, reason, buttons: ["reapprove", "cancel"] };
      return { ...base, needsUser: need, label: need === "connection" ? "Connection changed" : need === "upload" ? "Upload paused" : "Needs your attention", tone: "warning", terminal: false, working: false, reason, buttons: ["resume", "cancel"] };
    }
    default: return { ...base, label: "Running", tone: "running", terminal: false, working: true, reason: null, buttons: ["cancel"] };
  }
}

/** `resumable_busy` reaches the bridge as its message only. */
export function isBusyError(message: string) {
  return /resumable_busy|already working on the same item/i.test(message);
}

/** User-facing text for a failed start or control. */
export function engineErrorMessage(error: unknown, fallback = "The request failed.") {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (isBusyError(message)) return "Another transfer is running on this site. Wait for it to finish, or pause or cancel it first.";
  return message || fallback;
}

/** 32 lowercase hex characters (pullId, importId, previewId, copyId, restoreId). */
export function newHexId() {
  return crypto.randomUUID().replaceAll("-", "");
}

const ID_FIELDS = ["pullId", "importId", "previewId", "copyId", "restoreId"] as const;

/** The transfer ID a run input carries (falls back to the run ID). */
export function runTransferId(run: Pick<RecentRun, "runId" | "input">) {
  const input = (run.input && typeof run.input === "object" ? run.input : {}) as Record<string, unknown>;
  for (const field of ID_FIELDS) if (typeof input[field] === "string" && input[field]) return input[field] as string;
  return run.runId;
}

export function runInput(run: Pick<RecentRun, "input">): Record<string, unknown> {
  return run.input && typeof run.input === "object" ? run.input as Record<string, unknown> : {};
}
