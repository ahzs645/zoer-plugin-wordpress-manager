/**
 * One-click Push to live: one press starts three runs on the Zoer server that wait for each other
 * (plugin/worker/lib/push.js): the local export, the comparison with the live site (waits for the
 * export) and the approved push (waits for the comparison, sends what differs and finishes by
 * itself). This file finds such a push among recent runs and maps the three runs onto the stages
 * the dialog shows. Pure; no host calls.
 */
import { endedBadly, ENGINE_ACTIONS, isTerminalStatus, runInput, type RecentRun, type ResumableProgress, type ResumableSummary } from "./runState";

export interface OneClickRuns { push: RecentRun; exportRun: RecentRun | null; previewRun: RecentRun | null }

/** A push started by one click names the export it waits for. */
export const isOneClickPush = (run: Pick<RecentRun, "actionId" | "input">) => run.actionId === ENGINE_ACTIONS.push && typeof runInput(run).exportPullId === "string";

/** The newest one-click push from `sourceId` (to `destinationId` when given), with the export and comparison started with it. */
/** The newest one-click push from `sourceId`; to `destination` (one site ID, or every ID of one website) when given. */
export function findOneClickPush(runs: readonly RecentRun[], sourceId: string, destination?: string | readonly string[]): OneClickRuns | null {
  const destinations = destination === undefined ? null : typeof destination === "string" ? [destination] : destination;
  const push = runs.filter(run => isOneClickPush(run) && runInput(run).sourceSiteId === sourceId && (!destinations || destinations.includes(String(runInput(run).siteId))))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!push) return null;
  const input = runInput(push);
  return {
    push,
    exportRun: runs.find(run => run.actionId === ENGINE_ACTIONS.localExport && runInput(run).pullId === input.exportPullId) ?? null,
    previewRun: typeof input.previewId === "string" ? runs.find(run => run.actionId === ENGINE_ACTIONS.preview && runInput(run).previewId === input.previewId) ?? null : null,
  };
}

/** The push's runs still running: cancelling the push cancels them too. */
export function activeRunsOf(runs: OneClickRuns) {
  return [runs.push, runs.exportRun, runs.previewRun].filter((run): run is RecentRun => !!run && !isTerminalStatus(run.status));
}

/**
 * An export or comparison that ended badly while the push still waits: the push would only learn
 * it from the export's record (or give up after half an hour), so the dialog cancels it.
 */
export function abandonedPush(runs: OneClickRuns) {
  if (isTerminalStatus(runs.push.status)) return false;
  return [runs.exportRun, runs.previewRun].some(run => !!run && isTerminalStatus(run.status) && (run.status !== "succeeded" || endedBadly(run)));
}

export type StageId = "approve" | "export" | "compare" | "upload" | "apply";
export type StageState = "done" | "active" | "waiting" | "pending" | "failed" | "skipped";
export interface PushStage { id: StageId; label: string; state: StageState; detail?: string; progress?: ResumableProgress | null }

/** Push phases before and during the upload, and while the live site applies the import. */
const UPLOAD_PHASES = ["creating", "submitting", "checking code", "uploading"];
const APPLY_PHASES = ["importing", "review_required", "verification_required", "finishing", "rolling_back", "complete", "unchanged"];

type RunLike = { status: string; resumable?: ResumableSummary; error?: string | null };
const runError = (run: RunLike | null) => run?.error || run?.resumable?.lastError?.message || run?.resumable?.progress?.message || undefined;

/**
 * The five stages of a one-click push from its three runs. `push` carries the push run's latest
 * status, resumable summary and output (the run detail), `input` its request.
 */
export function oneClickStages({ push, input, exportRun, previewRun, host }: {
  push: RunLike & { output?: unknown }; input: Record<string, unknown>; exportRun: RunLike | null; previewRun: RunLike | null; /** The live site's host name. */ host: string;
}): PushStage[] {
  const output = (push.output && typeof push.output === "object" ? push.output : {}) as { status?: string; summary?: string };
  const compare = typeof input.previewId === "string";
  const dryRun = input.dryRun === true;
  const phase = push.resumable?.progress?.phase ?? "";
  const pushEnded = isTerminalStatus(push.status);
  const pushFailed = pushEnded && (push.status !== "succeeded" || output.status === "failed");
  const runDone = (run: RunLike | null) => !!run && run.status === "succeeded" && !endedBadly(run);
  const runFailed = (run: RunLike | null) => !!run && isTerminalStatus(run.status) && !runDone(run);
  const runActive = (run: RunLike | null) => !!run && !isTerminalStatus(run.status);
  const finished = push.status === "succeeded" && ["complete", "unchanged", "dry-run"].includes(output.status ?? "");
  const unchanged = finished && output.status === "unchanged";
  const applying = APPLY_PHASES.includes(phase) || finished;

  const stages: PushStage[] = [
    { id: "approve", label: "Approve in Zoer", state: push.status === "waiting_for_approval" ? "waiting" : "done", detail: push.status === "waiting_for_approval" ? "Zoer asks once. Everything after this runs by itself." : undefined },
    { id: "export", label: "Export the local site", state: runDone(exportRun) ? "done" : runFailed(exportRun) ? "failed" : runActive(exportRun) ? "active" : "pending", progress: exportRun?.resumable?.progress ?? null, detail: runFailed(exportRun) ? runError(exportRun) : undefined },
    compare
      ? { id: "compare", label: `Compare with ${host}`, state: runDone(previewRun) ? "done" : runFailed(previewRun) ? "failed" : runActive(previewRun) && runDone(exportRun) ? "active" : "pending", progress: previewRun?.resumable?.progress ?? null, detail: runFailed(previewRun) ? runError(previewRun) : undefined }
      : { id: "compare", label: `Compare with ${host}`, state: "skipped", detail: "This Zoer Connect version can't compare files, so everything in the export is sent." },
    { id: "upload", label: dryRun ? "Plan the push (test run)" : "Upload the changes", state: unchanged ? "skipped" : finished || applying ? "done" : "pending", progress: UPLOAD_PHASES.includes(phase) ? push.resumable?.progress ?? null : null,
      detail: unchanged ? `${host} already has these changes.` : undefined },
    { id: "apply", label: `Update ${host}`, state: unchanged || dryRun ? "skipped" : finished ? "done" : "pending", progress: APPLY_PHASES.includes(phase) && !finished ? push.resumable?.progress ?? null : null,
      detail: dryRun && finished ? "Test run: nothing was changed." : unchanged ? "Nothing to send." : undefined },
  ];
  // A push that ended badly fails at the first stage it had not finished; a running one is under
  // way (or waiting for the user) at the first stage still to come.
  const open = stages.find(stage => !["done", "skipped"].includes(stage.state));
  if (open && pushFailed && !stages.some(stage => stage.state === "failed")) { open.state = "failed"; open.detail = push.status === "cancelled" ? "Cancelled." : open.detail; }
  else if (open && open.state === "pending" && !pushEnded && !stages.some(stage => stage.state === "active" || stage.state === "waiting")) open.state = push.resumable?.state === "needs-user" ? "waiting" : "active";
  return stages;
}

function ago(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export interface PushSummary { text: string; tone: "running" | "warning" | "success" | "error" | "neutral" }

/**
 * One line about the newest one-click push for a site's Local and live card: the stage under
 * way, what it needs, or how it ended. Recent runs carry no output, so the end reads the last
 * progress phase the worker reported (complete, unchanged, failed).
 */
export function pushSummary(runs: OneClickRuns, host: string, now = Date.now()): PushSummary {
  const { push } = runs;
  const input = runInput(push);
  const test = input.dryRun === true;
  const what = test ? "Test run" : "Push";
  if (push.status === "waiting_for_approval") return { text: `${what} to ${host} is waiting for your approval`, tone: "warning" };
  if (!isTerminalStatus(push.status)) {
    if (push.resumable?.state === "needs-user") return { text: `${what} to ${host} needs you`, tone: "warning" };
    const stage = oneClickStages({ push, input, exportRun: runs.exportRun, previewRun: runs.previewRun, host }).find(s => s.state === "active" || s.state === "waiting");
    return { text: `${what} to ${host}: ${stage ? stage.label.charAt(0).toLowerCase() + stage.label.slice(1) : "running"}…`, tone: "running" };
  }
  const when = ago(now - Date.parse(push.finishedAt ?? push.createdAt));
  const phase = push.resumable?.progress?.phase;
  if (push.status === "cancelled") return { text: `Last ${what.toLowerCase()} was cancelled ${when}`, tone: "neutral" };
  if (push.status !== "succeeded" || phase === "failed" || [runs.exportRun, runs.previewRun].some(run => run && isTerminalStatus(run.status) && run.status !== "succeeded")) return { text: `Last ${what.toLowerCase()} to ${host} failed ${when}`, tone: "error" };
  if (phase === "unchanged") return { text: `${host} was already up to date (${when})`, tone: "success" };
  if (test) return { text: `Test run finished ${when}; nothing was changed`, tone: "neutral" };
  if (phase === "rolled_back") return { text: `Last push was rolled back ${when}`, tone: "neutral" };
  return { text: `Pushed to ${host} ${when}`, tone: "success" };
}
