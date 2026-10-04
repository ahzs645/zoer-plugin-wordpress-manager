import { hostRequest } from "./bridge";

/**
 * This plugin's manifest actions and the Zoer shared services it uses from the native page
 * (Zoer docs/plugin-shared-services.md, WordPress P2):
 *
 * - `action` plans and starts a `read`/`local_write` action and returns the queued run;
 *   `action.request` plans any action (here `site.remove`, `destructive` + `approval: always`) and
 *   the host shows its approval card; `run` reads one run with its output.
 * - `connections.*` (S7a): host-confirmed Hostinger sign-in; tokens never reach this page.
 * - `endpoints.*` (S7b): host-confirmed Zoer Connect sites; keys pass once to the host.
 */

export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "outcome_unknown"] as const;

export interface PluginRun<T = unknown> {
  id: string;
  actionId?: string;
  status: string;
  error?: string | null;
  statusReason?: string | null;
  output?: T | null;
}

export class ActionFailedError extends Error {
  constructor(message: string, readonly run: PluginRun) { super(message); this.name = "ActionFailedError"; }
}

export const isTerminalRun = (run: { status: string }) => (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function waitForRun<T>(runId: string, options: { timeoutMs?: number; onUpdate?: (run: PluginRun<T>) => void; pause?: (ms: number) => Promise<void> } = {}): Promise<PluginRun<T>> {
  const started = Date.now();
  const pause = options.pause ?? sleep;
  let interval = 400;
  for (;;) {
    const { run } = await hostRequest<{ run: PluginRun<T> }>("run", { id: runId });
    options.onUpdate?.(run);
    if (isTerminalRun(run)) return run;
    if (Date.now() - started > (options.timeoutMs ?? 15 * 60_000)) throw new Error("The action is still running. Check back later.");
    await pause(interval);
    interval = Math.min(3_000, Math.round(interval * 1.5));
  }
}

function finished<T>(run: PluginRun<T>): T {
  if (run.status === "succeeded") return (run.output ?? {}) as T;
  if (run.status === "cancelled") throw new ActionFailedError(run.error || "The action was cancelled or not approved.", run);
  throw new ActionFailedError(run.error || "The action failed.", run);
}

/** Starts a `read`/`local_write` action and waits for its output. */
export async function runAction<T>(actionId: string, input: Record<string, unknown> = {}, options: Parameters<typeof waitForRun<T>>[1] = {}): Promise<T> {
  const started = await hostRequest<{ run: { id: string } }>("action", { actionId, input });
  return finished(await waitForRun<T>(started.run.id, options));
}

/** Asks the host to review an approval-gated action, then waits for the decision and the result. */
export async function requestAction<T>(actionId: string, input: Record<string, unknown> = {}, options: Parameters<typeof waitForRun<T>>[1] = {}): Promise<T> {
  const { runId } = await hostRequest<{ runId: string }>("action.request", { actionId, input });
  return finished(await waitForRun<T>(runId, options));
}

// ---------------------------------------------------------------------------
// S7a connections and S7b endpoints
// ---------------------------------------------------------------------------

export interface HostConnectionAccount { id: string; label: string; status: string }
export interface HostConnection { alias: string; connected: boolean; accounts?: HostConnectionAccount[] }

export const hostConnections = {
  list: () => hostRequest<{ connections: HostConnection[] }>("connections.list"),
  /** Host confirmation, then the host's sign-in dialog. */
  connect: (alias: string) => hostRequest<{ started: boolean; connected?: boolean; connectionId?: string }>("connections.connect", { alias }),
};

export interface HostEndpoint { id: string; alias: string; origin: string; label: string; generation: string; testedAt: string | null; createdAt: string }

export const hostEndpoints = {
  list: (alias = "site") => hostRequest<{ endpoints: HostEndpoint[] }>("endpoints.list", { alias }),
  /** Host confirmation; the host probes `status` with the key before storing anything. */
  add: (input: { origin: string; key: string; label?: string }) => hostRequest<{ endpoint: HostEndpoint }>("endpoints.add", { alias: "site", ...input }),
  /** Host-confirmed removal of the endpoint and its key. */
  remove: (id: string) => hostRequest<{ removed: boolean }>("endpoints.remove", { id }),
};
