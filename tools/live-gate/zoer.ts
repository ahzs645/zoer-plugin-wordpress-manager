#!/usr/bin/env bun
/**
 * Live Zoer API helper for WordPress Manager: plan, start, wait, pause/resume/cancel, approvals.
 * Every write goes through `guard.ts`. Usage: `bun tools/live-gate/zoer.ts help`.
 *
 * Environment: ZOER_URL (required, the Zoer origin), ZOER_TOKEN (optional bearer token),
 * LIVE_GATE_ALLOW_SITE (optional, exact site IDs the user allowed for writes).
 */
import { resolve } from "node:path";
import { assertActionAllowed, assertApprovalAllowed, assertNotForbidden, GuardError, zoerOrigin } from "./guard";

export const PLUGIN_ID = "wordpress-manager";
export const TERMINAL = ["succeeded", "failed", "cancelled", "outcome_unknown"];
export const PARKED = ["needs-user", "paused", "resume-needed"];

export const apiBase = () => `${zoerOrigin()}/api`;
const ext = () => `/extensions/${PLUGIN_ID}`;

export type ApiResult = { status: number; json: any };

/** One call to Zoer's `/api`. `path` starts with `/` (relative to `/api`). */
export async function api(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult> {
  const token = process.env.ZOER_TOKEN?.trim();
  const res = await fetch(`${apiBase()}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

/** Like `api`, but throws on a non-2xx answer. */
export async function apiOk(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const r = await api(path, init);
  if (r.status < 200 || r.status >= 300) throw new Error(`${init.method ?? (init.body === undefined ? "GET" : "POST")} ${path}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
  return r.json;
}

// ---------------------------------------------------------------------------------------------
// Manifest (effects and approval policy come from this checkout's plugin/manifest.json)

type ManifestAction = { id: string; effect: string; approval: string };
let manifestActions: Map<string, ManifestAction> | null = null;

export async function manifestAction(actionId: string): Promise<ManifestAction> {
  if (!manifestActions) {
    const manifest = await Bun.file(resolve(import.meta.dir, "../../plugin/manifest.json")).json();
    manifestActions = new Map((manifest.integration?.actions ?? []).map((a: ManifestAction) => [a.id, a]));
  }
  const action = manifestActions.get(actionId);
  if (!action) throw new GuardError(`Unknown action ${actionId} (not in plugin/manifest.json).`);
  return action;
}

// ---------------------------------------------------------------------------------------------
// Actions and runs

export const plan = (actionId: string, input: Record<string, unknown>) =>
  api(`${ext()}/actions/${actionId}/plan`, { body: { input } });

export type Started = { stage: "plan" | "plan-blockers" | "run"; status?: number; json?: any; blockers?: unknown[]; runId?: string };

/**
 * Guard → plan → run (or request-approval for `approval: always` actions). Returns the run ID when
 * the run was created. Approval-gated runs wait for `approve` (this tool) or the Zoer UI.
 */
export async function start(actionId: string, input: Record<string, unknown>, options: { approval?: boolean; key?: string } = {}): Promise<Started> {
  const action = await manifestAction(actionId);
  assertActionAllowed(action.effect, input);
  const p = await plan(actionId, input);
  if (p.status !== 200) return { stage: "plan", ...p };
  const blockers = p.json.plan?.blockers;
  if (blockers?.length) return { stage: "plan-blockers", blockers };
  const approval = options.approval ?? action.approval === "always";
  const r = await api(`${ext()}/actions/${actionId}/${approval ? "request-approval" : "run"}`, {
    body: { input, fingerprintSha256: p.json.plan.fingerprintSha256, idempotencyKey: options.key ?? `live-gate-${actionId}-${Date.now()}` },
  });
  return { stage: "run", ...r, runId: r.json?.run?.id ?? r.json?.runId };
}

export const getRun = async (id: string) => (await apiOk(`${ext()}/workspace/runs/${encodeURIComponent(id)}`)).run;
export const workflow = (id: string) => apiOk(`/workflows/${encodeURIComponent(id)}`);
export const pause = (id: string) => api(`${ext()}/workspace/runs/${encodeURIComponent(id)}/pause`, { body: {} });
export const resume = (id: string, reapprove = false) => api(`${ext()}/workspace/runs/${encodeURIComponent(id)}/resume`, { body: reapprove ? { reapprove } : {} });
export const cancel = (id: string) => api(`${ext()}/workspace/runs/${encodeURIComponent(id)}/cancel`, { body: {} });
export const catalog = (kind: string, limit = 200) => apiOk(`${ext()}/workspace/catalog/list`, { body: { kind, limit } });
export const filesets = () => apiOk(`${ext()}/workspace/filesets`);

/** The first workflow step (resumable actions have one): checkpoint, slices, state. */
export async function step(id: string): Promise<any> {
  return (await workflow(id)).steps?.[0] ?? null;
}

export function brief(run: any) {
  return {
    id: run?.id, action: run?.actionId, status: run?.status, statusReason: run?.statusReason ?? undefined, error: run?.error ?? undefined,
    resumable: run?.resumable && { state: run.resumable.state, slices: run.resumable.slices, progress: run.resumable.progress, lastError: run.resumable.lastError },
    output: run?.output ?? undefined,
  };
}

export const isStopped = (run: any) => TERMINAL.includes(run?.status) || PARKED.includes(run?.resumable?.state) || run?.status === "waiting_for_approval";

/** Polls a run until `until` (default: terminal, parked or waiting for approval) or the timeout. */
export async function waitRun(id: string, options: { until?: (run: any) => boolean; timeoutMs?: number; quiet?: boolean; intervalMs?: number } = {}) {
  const until = options.until ?? isStopped;
  const t0 = Date.now();
  let last = "";
  for (;;) {
    const run = await getRun(id);
    const line = JSON.stringify({ s: run?.status, st: run?.resumable?.state, p: run?.resumable?.progress, why: run?.statusReason });
    if (!options.quiet && line !== last) { console.error(new Date().toISOString().slice(11, 19), line); last = line; }
    if (run && until(run)) return run;
    if (Date.now() - t0 > (options.timeoutMs ?? 30 * 60_000)) return run;
    await Bun.sleep(options.intervalMs ?? 3000);
  }
}

// ---------------------------------------------------------------------------------------------
// Approvals

export const openApprovals = async (): Promise<any[]> => (await apiOk(`/runtime/approvals?status=open`)).requests ?? [];

/** Waits for the open approval that belongs to a run. */
export async function approvalForRun(runId: string, timeoutMs = 60_000): Promise<any> {
  const t0 = Date.now();
  for (;;) {
    const found = (await openApprovals()).find(a => a.payload?.workflowRunId === runId);
    if (found) return found;
    if (Date.now() - t0 > timeoutMs) throw new Error(`No open approval appeared for run ${runId}.`);
    await Bun.sleep(1000);
  }
}

/** Resolves one open approval after the guard checked its reviewed input. */
export async function resolveApproval(approvalId: string, status: "approved" | "declined", reason: string) {
  const approval = (await openApprovals()).find(a => a.id === approvalId);
  if (!approval) throw new Error(`Approval ${approvalId} is not open.`);
  if (status === "approved") assertApprovalAllowed(approval);
  return apiOk(`/runtime/approvals/${encodeURIComponent(approvalId)}/resolve`, { body: { status, reason } });
}

// ---------------------------------------------------------------------------------------------
// Read-only WP-CLI (`wpcli.read`, the bridge's read-only allowlist)

export async function wpRead(siteId: string, args: string[], timeoutMs = 180_000): Promise<string> {
  assertNotForbidden(siteId);
  const started = await start("wpcli.read", { siteId, args });
  if (!started.runId) throw new Error(`wpcli.read did not start: ${JSON.stringify(started).slice(0, 400)}`);
  const run = await waitRun(started.runId, { quiet: true, timeoutMs, intervalMs: 1000 });
  if (run.status !== "succeeded") throw new Error(`wpcli.read ${run.status}: ${run.error ?? ""}`);
  return run.output?.summary ?? "";
}

// ---------------------------------------------------------------------------------------------
// CLI

const HELP = `bun tools/live-gate/zoer.ts <command>
  check                              GET the installed plugin (read-only; checks ZOER_URL and auth)
  get <path>                         GET /api<path> (read-only)
  plan <action> '<json input>'       plan only
  start <action> '<json input>'      guard, plan, run (approval-gated actions: request approval)
  run <runId> | raw <runId>          run summary | full run
  wf <runId>                         workflow (steps, checkpoints, events)
  wait <runId> [seconds=1800]        poll until done, parked or waiting for approval
  pause|cancel <runId>               pause / cancel a run
  resume <runId> [reapprove]         resume a parked run
  approvals                          open approvals (leave none open when you finish)
  approve <approvalId> [reason]      approve after the guard checked the reviewed site(s)
  decline <approvalId> [reason]      decline
  catalog <kind>                     catalog records (pull, history, local-copy, site-link, ...)
  filesets                           file sets
  wp <siteId> <wp-cli args...>       read-only WP-CLI through wpcli.read`;

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const out = (x: unknown) => console.log(JSON.stringify(x, null, 2));
  const need = (value: string | undefined, name: string) => { if (!value) throw new Error(`Missing ${name}.\n${HELP}`); return value; };
  try {
    switch (cmd) {
      case "check": {
        const r = await api(`/extensions/${PLUGIN_ID}`);
        const e = r.json?.extension ?? r.json;
        out({ http: r.status, id: e?.id, version: e?.version ?? e?.manifest?.version, enabled: e?.enabled, status: e?.status, keys: r.status === 200 ? Object.keys(r.json ?? {}) : r.json });
        if (r.status !== 200) process.exit(1);
        break;
      }
      case "get": out((await api(need(args[0], "path"))).json); break;
      case "plan": out((await plan(need(args[0], "action"), JSON.parse(need(args[1], "input")))).json); break;
      case "start": out(await start(need(args[0], "action"), JSON.parse(need(args[1], "input")))); break;
      case "run": out(brief(await getRun(need(args[0], "runId")))); break;
      case "raw": out(await getRun(need(args[0], "runId"))); break;
      case "wf": out(await workflow(need(args[0], "runId"))); break;
      case "wait": out(brief(await waitRun(need(args[0], "runId"), { timeoutMs: Number(args[1] ?? 1800) * 1000 }))); break;
      case "pause": out((await pause(need(args[0], "runId"))).json); break;
      case "cancel": out((await cancel(need(args[0], "runId"))).json); break;
      case "resume": out((await resume(need(args[0], "runId"), args[1] === "reapprove")).json); break;
      case "approvals": out((await openApprovals()).map(a => ({ id: a.id, run: a.payload?.workflowRunId, action: a.payload?.actionId ?? a.payload?.structuredReview?.actionId, input: a.payload?.structuredReview?.input, createdAt: a.createdAt }))); break;
      case "approve": out(await resolveApproval(need(args[0], "approvalId"), "approved", args[1] ?? "live gate: test site")); break;
      case "decline": out(await resolveApproval(need(args[0], "approvalId"), "declined", args[1] ?? "live gate: declined")); break;
      case "catalog": out(await catalog(need(args[0], "kind"))); break;
      case "filesets": out(await filesets()); break;
      case "wp": console.log(await wpRead(need(args[0], "siteId"), args.slice(1))); break;
      default: console.log(HELP); if (cmd && cmd !== "help") process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof GuardError ? 3 : 1);
  }
}
