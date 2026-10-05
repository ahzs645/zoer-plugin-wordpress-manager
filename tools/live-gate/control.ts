#!/usr/bin/env bun
/**
 * `transfer.push.control` on a test site's import: approve (activate the reviewed import), finish,
 * rollback or cleanup. Requests the control, approves only the approval of this run whose reviewed
 * input is exactly this site, import and control, and waits for the end (one approval drives a
 * rollback or cleanup to its end across slices).
 *
 *   bun tools/live-gate/control.ts <importId> <approve|finish|rollback|cleanup> [--site ddev-zoer-connect-040-destination]
 */
import { parseArgs } from "node:util";
import { approvalForRun, getRun, openApprovals, resolveApproval, start, TERMINAL } from "./zoer";

const CONTROLS = ["approve", "finish", "rollback", "cleanup"];

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { site: { type: "string", default: "ddev-zoer-connect-040-destination" } }, allowPositionals: true });
  const [importId, control] = positionals;
  if (!importId || !control || !CONTROLS.includes(control)) { console.error(`Usage: control.ts <importId> <${CONTROLS.join("|")}> [--site <siteId>]`); process.exit(2); }
  const input = { siteId: values.site!, importId, control };
  const t0 = Date.now();
  const started = await start("transfer.push.control", input, { approval: true });
  if (!started.runId) { console.log(JSON.stringify(started, null, 1)); process.exit(1); }
  const id = started.runId;
  console.error(`run ${id}`);
  const approval = await approvalForRun(id);
  const reviewed = approval.payload?.structuredReview?.input ?? {};
  if (reviewed.siteId !== input.siteId || reviewed.importId !== importId || reviewed.control !== control) {
    console.error(`Unexpected approval, declining it: ${JSON.stringify(reviewed)}`);
    await resolveApproval(approval.id, "declined", "live gate: reviewed input did not match the request");
    process.exit(1);
  }
  await resolveApproval(approval.id, "approved", `live gate: ${control} on test site ${input.siteId}`);
  let run: any;
  for (;;) {
    run = await getRun(id);
    if (TERMINAL.includes(run.status) || run.resumable?.state === "needs-user") break;
    if (Date.now() - t0 > 60 * 60_000) break;
    await Bun.sleep(1000);
  }
  const stillOpen = (await openApprovals()).filter(a => a.payload?.workflowRunId === id).length;
  console.log(JSON.stringify({ control, run: id, approval: approval.id, openApprovalsForRun: stillOpen, wallSeconds: Math.round((Date.now() - t0) / 1000), slices: run.resumable?.slices, status: run.status, state: run.resumable?.state, error: run.error, output: run.output }, null, 1));
}
