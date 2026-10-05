// S1 resumable slices for plain-JS workers (the same rules as @zoer/plugin-sdk/resumable).
//
// Every slice receives the last checkpoint and returns one envelope. The state machines in this
// package mutate their checkpoint object only after a remote or host operation has committed, so
// whatever the object holds when a slice stops (pause, transient failure, deadline) is safe to
// replay. Large state lives in file sets and catalog records; the checkpoint keeps pointers.

/** Host and worker error codes that make a slice retry later instead of failing the run. */
export const TRANSIENT_CODES = new Set([
  "transfer_transient", "crawl_rate_limited", "crawl_wait",
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
  "ENETDOWN", "EHOSTDOWN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);
export const PAUSED = "ZOER_PAUSED";
/** Kept free before the slice deadline to write the checkpoint. */
export const SLICE_RESERVE_MS = 8_000;
/**
 * Consecutive retries Zoer allows a slice before it fails the run (`resumable.retry.maxConsecutive`;
 * the manifest declares no `retry`, so Zoer's default applies). The slice whose retry would be one
 * more records the failure first.
 */
export const MAX_CONSECUTIVE_RETRIES = 8;
/** `run.progress` calls closer together are dropped here (the host keeps at most one per second). */
const PROGRESS_INTERVAL_MS = 1_000;

/** A user-facing failure. `transient` retries the slice; `needsUser` parks the run with `message` as the reason. */
export class TransferError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TransferError";
    this.code = options.code ?? (options.transient ? "transfer_transient" : "transfer_failed");
    if (options.transient) this.transient = true;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.needsUser) this.needsUser = true;
    if (options.status !== undefined) this.status = options.status;
    if (options.details) this.details = options.details;
  }
}

export const fail = (message, options) => { throw new TransferError(message, options); };

/**
 * Between remote calls of a long slice: once Zoer asked the run to pause (or cancel), stop with
 * `{ paused: true, checkpoint }` instead of starting more external work. Call it only where the
 * checkpoint is consistent (every committed remote answer already applied).
 */
export function stopIfPaused(ctx) {
  if (ctx.pauseRequested?.()) throw new TransferError("Paused by Zoer.", { code: PAUSED });
}

/** Host refusals of a runtime call itself: Zoer's checks, the operation's input schema, grants. */
const PERMANENT_RUNTIME_CODES = new Set(["capability_denied", "resource_unbound", "invalid_request", "runtime_permission", "not_implemented", "endpoint_route_denied"]);
/**
 * Zoer passes a runtime driver's plain errors on with a generic code and the driver's message.
 * For the DDEV bridge those are its refusals (HTTP 400: validation, missing or expired jobs),
 * except transport failures: no answer, 5xx and 429, which the host engine retried too.
 */
const BRIDGE_TRANSIENT = /DDEV bridge request failed \((?:5\d\d|429)\)|DDEV bridge did not respond|fetch failed|Unable to connect|ECONN(?:RESET|REFUSED|ABORTED)|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|timed out|timeout/i;

/**
 * A `runtime.invoke` refusal as a TransferError that keeps the host's message and code, retried
 * only when it is a transport failure. Validation and schema refusals fail at once.
 */
export function runtimeError(error, fallback = "The DDEV bridge could not complete this operation.") {
  const message = typeof error?.message === "string" && error.message.trim() ? error.message.trim() : fallback;
  const code = typeof error?.code === "string" && CODE.test(error.code) ? error.code : undefined;
  const transient = !PERMANENT_RUNTIME_CODES.has(code) && (TRANSIENT_CODES.has(code) || BRIDGE_TRANSIENT.test(message));
  return new TransferError(message, { code: code ?? (transient ? "transfer_transient" : "transfer_failed"), transient });
}

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;

export function isTransient(error) {
  return !!error && (error.transient === true || TRANSIENT_CODES.has(error.code));
}

const bounded = (text, max = 500) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max) || "The transfer failed.";

/**
 * Runs one slice. `spec.start(input, ctx)` builds the first checkpoint, `spec.step(state, input,
 * ctx)` returns an envelope (use `ctx.continue/done/needsUser`), `spec.cancel(state, input, ctx)`
 * runs once after the user cancels (manifest `cleanup: true`). `spec.changed` names the reason
 * shown when the site's endpoint key changed (`endpoint_changed`). `spec.failed(state, input,
 * ctx, error)` runs (best effort) when this slice ends the run as failed: a permanent error, or a
 * transient one on the last retry Zoer allows. `state` is null when `start` failed.
 */
export async function runResumable(request, host, spec, clock = Date.now) {
  const context = request.resumable;
  if (!context) throw new TransferError("This action needs a Zoer release with resumable actions.", { code: "resumable_unsupported" });
  const input = request.input ?? {};
  const deadlineAt = Date.parse(context.deadlineAt);
  let progressAt = -Infinity;
  const ctx = {
    request, host, input, resumable: context,
    now: clock,
    deadlineAt,
    /** Milliseconds left before the slice must return (never negative). */
    timeLeft: () => Math.max(0, (Number.isFinite(deadlineAt) ? deadlineAt : clock() + 60_000) - clock() - SLICE_RESERVE_MS),
    continue: (state, progress, waitMs) => ({ resumable: "continue", checkpoint: state, ...(progress ? { progress: cleanProgress(progress) } : {}), ...(waitMs !== undefined ? { waitMs: Math.max(0, Math.min(3_600_000, Math.round(waitMs))) } : {}) }),
    done: (output, progress) => ({ resumable: "done", output, ...(progress ? { progress: cleanProgress(progress) } : {}) }),
    needsUser: (state, reason, progress) => ({ resumable: "needs-user", checkpoint: state, reason: bounded(reason), ...(progress ? { progress: cleanProgress(progress) } : {}) }),
    /** Best-effort progress inside a long slice (`run.progress`, at most one per second is sent). */
    async progress(progress) {
      const at = clock();
      if (at - progressAt < PROGRESS_INTERVAL_MS) return;
      progressAt = at;
      try { await host.call("run.progress", { progress: cleanProgress(progress) }); } catch { /* progress is advisory */ }
    },
    /**
     * Zoer's cooperative pause notice (user pause, cancel or deploy drain), carried on host
     * responses; null while none arrived. Long slices check it between remote calls.
     */
    pauseRequested: () => host.pauseRequested ?? null,
  };
  if (context.cancelling) {
    if (spec.cancel) await spec.cancel(context.checkpoint ?? null, input, ctx);
    return ctx.done({ cancelled: true });
  }
  let state = context.checkpoint ?? null;
  const recordFailure = async (error) => {
    if (!spec.failed) return;
    try { await spec.failed(state, input, ctx, error); } catch { /* the run's own error stays the one reported */ }
  };
  try {
    if (state === null) state = await spec.start(input, ctx);
    return await spec.step(state, input, ctx);
  } catch (error) {
    if (error?.code === PAUSED) return { paused: true, checkpoint: state };
    if (error?.code === "endpoint_changed" && state) return ctx.needsUser(state, spec.changed ?? "This connection changed. Restore the original connection to continue.");
    if (error?.needsUser && state) return ctx.needsUser(state, error.message);
    if (isTransient(error)) {
      if ((Number(context.attempt) || 0) + 1 > MAX_CONSECUTIVE_RETRIES) await recordFailure(error);
      return {
        resumable: "retry",
        ...(state !== null ? { checkpoint: state } : {}),
        // The cause's own code (a host or bridge code) stays visible in the run's last error.
        error: { code: typeof error.code === "string" && CODE.test(error.code) ? error.code : "transfer_transient", message: bounded(error.message) },
        ...(Number.isFinite(error.retryAfterMs) ? { retryAfterMs: Math.max(0, Math.min(300_000, Math.round(error.retryAfterMs))) } : {}),
      };
    }
    await recordFailure(error);
    throw error;
  }
}

export function cleanProgress(progress) {
  const out = { phase: String(progress.phase || "working").slice(0, 60) };
  for (const key of ["done", "total"]) if (Number.isSafeInteger(progress[key]) && progress[key] >= 0) out[key] = progress[key];
  if (["bytes", "files", "items", "rows", "steps"].includes(progress.unit)) out.unit = progress.unit;
  if (progress.message) out.message = String(progress.message).slice(0, 200);
  return out;
}

/** Runner response for an error that escaped a slice (or a non-resumable action). */
export function failure(error) {
  const code = typeof error?.code === "string" && CODE.test(error.code) ? error.code : "transfer_failed";
  return { ok: false, error: { code, message: bounded(error?.message), ...(isTransient(error) ? { retryable: true } : {}) } };
}
