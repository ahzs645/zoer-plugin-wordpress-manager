#!/usr/bin/env bun
/**
 * Gated `transfer.push` of a ready file set into a test site. Requests the push, approves only the
 * approval of this run whose reviewed input matches the destination, the confirmed address and the
 * dry-run flag, then follows the run until it stops (review → `needs-user`, or finished).
 *
 *   bun tools/live-gate/push.ts --set fs_<32 hex> --confirm-target https://<destination address> \
 *     [--site ddev-zoer-connect-040-destination] [--source ddev-zoer-connect-040-source] [--dry] \
 *     [--pause-on-upload [--pause-seconds 10]] [--options '<importOptions JSON merged over the defaults>']
 *
 * `--confirm-target` is the destination's Zoer Connect address exactly as the push dialog asks for
 * it (no trailing slash). `--pause-on-upload` pauses once at the first upload progress, waits `--pause-seconds`, and
 * resumes, logging how long the run took to park (the "pause mid-upload" test).
 * The import ID is chosen here (like the push dialog) and printed, so the controls never depend on the
 * run checkpoint: after a real push, `control.ts <importId> rollback` (or approve), then `cleanup`.
 * See docs/live-testing.md.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { approvalForRun, getRun, pause, resolveApproval, resume, start, step, TERMINAL } from "./zoer";

export const DEFAULT_IMPORT_OPTIONS = {
  replacements: { automatic: true, variants: true, paths: true, custom: [] },
  replaceGuids: true, keepActivePlugins: null, keepActiveTheme: null, authorMapping: "match",
  createTables: true, fence: "activation", review: true, purgeCaches: true,
};

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      set: { type: "string" }, site: { type: "string", default: "ddev-zoer-connect-040-destination" },
      source: { type: "string", default: "ddev-zoer-connect-040-source" }, "confirm-target": { type: "string" },
      dry: { type: "boolean", default: false }, "pause-on-upload": { type: "boolean", default: false }, "pause-seconds": { type: "string", default: "10" }, options: { type: "string" },
      "timeout-min": { type: "string", default: "30" },
    },
  });
  if (!values.set || !values["confirm-target"]) { console.error("Usage: push.ts --set fs_<id> --confirm-target <https address> [--site] [--source] [--dry] [--pause-on-upload [--pause-seconds 10]] [--options json]"); process.exit(2); }
  const pauseFor = values["pause-on-upload"] ? Number(values["pause-seconds"]) || 10 : null;
  const input: Record<string, unknown> = {
    siteId: values.site, setId: values.set, importId: randomBytes(16).toString("hex"), confirmTarget: values["confirm-target"], sourceSiteId: values.source,
    importOptions: { ...DEFAULT_IMPORT_OPTIONS, ...(values.options ? JSON.parse(values.options) : {}) },
    wordpressOnlyWriters: true, ...(values.dry ? { dryRun: true } : {}),
  };
  const t0 = Date.now();
  const at = () => ((Date.now() - t0) / 1000).toFixed(1);
  const log: any[] = [];
  const started = await start("transfer.push", input, { approval: true });
  if (!started.runId) { console.log(JSON.stringify(started, null, 1)); process.exit(1); }
  const id = started.runId;
  console.error(`run ${id} · import ${input.importId}`);
  const approval = await approvalForRun(id);
  const reviewed = approval.payload?.structuredReview?.input ?? {};
  if (reviewed.siteId !== input.siteId || reviewed.confirmTarget !== input.confirmTarget || (reviewed.dryRun === true) !== values.dry || reviewed.setId !== input.setId || reviewed.importId !== input.importId) {
    console.error(`Unexpected approval, declining it: ${JSON.stringify(reviewed)}`);
    await resolveApproval(approval.id, "declined", "live gate: reviewed input did not match the request");
    process.exit(1);
  }
  await resolveApproval(approval.id, "approved", `live gate: push to test site ${input.siteId}${values.dry ? " (dry run)" : ""}`);
  log.push({ at: at(), event: "approved", approval: approval.id });
  let paused = false; let pausedAt = 0;
  for (;;) {
    const run = await getRun(id);
    const state = run.resumable?.state; const phase = run.resumable?.progress?.phase;
    if (pauseFor !== null && !paused && phase === "uploading") {
      paused = true; pausedAt = Date.now();
      const p = await pause(id);
      log.push({ at: at(), event: "pause requested while uploading", http: p.status, progress: run.resumable?.progress, error: p.json?.error });
    }
    if (state === "paused") {
      const s = await step(id);
      log.push({ at: at(), event: "paused", parkedAfterSeconds: ((Date.now() - pausedAt) / 1000).toFixed(1), phase: s?.checkpoint?.phase, uploadedRaw: s?.checkpoint?.uploadedRaw, total: s?.checkpoint?.totalBytes });
      await Bun.sleep((pauseFor ?? 10) * 1000);
      const r = await resume(id);
      log.push({ at: at(), event: "resumed", http: r.status, state: r.json?.run?.resumable?.state, error: r.json?.error });
    }
    if (state === "needs-user" || TERMINAL.includes(run.status)) {
      const s = await step(id);
      log.push({ at: at(), event: "stopped", status: run.status, state, reason: run.statusReason, error: run.error, importId: input.importId, phase: s?.checkpoint?.phase, remotePhase: s?.checkpoint?.remotePhase, slices: run.resumable?.slices, output: run.output });
      break;
    }
    if (Date.now() - t0 > Number(values["timeout-min"]) * 60_000) { log.push({ at: at(), event: "timeout (run continues)", status: run.status, state }); break; }
    await Bun.sleep(1000);
  }
  console.log(JSON.stringify({ run: id, importId: input.importId, log }, null, 1));
}
