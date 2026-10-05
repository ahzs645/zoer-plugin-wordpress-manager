import { expect, test } from "bun:test";
import { describeRun, engineErrorMessage, importStateFromControls, isBusyError, isTransferFence, recentTransferRuns, needsUserKind, newHexId, progressView, runsOfSite, runTransferId, type ResumableSummary } from "./runState";

const resumable = (patch: Partial<ResumableSummary> = {}): ResumableSummary => ({ state: "running", slices: 3, progress: null, nextStepAt: null, lastError: null, consecutiveFailures: 0, lockKey: "resumable:wordpress-manager:site-transfer:ep_1", ...patch });
const run = (status: string, patch: Record<string, unknown> = {}) => ({ status, error: null, statusReason: null, output: null, ...patch });

test("needs-user reasons map to the decision the run waits for", () => {
  expect(needsUserKind("Review the import before it is activated. 12 replacements in 3 tables. Approve or roll back in WordPress Manager.")).toBe("review");
  expect(needsUserKind("Verify the destination site, then finish or roll back the import in WordPress Manager.")).toBe("verify");
  expect(needsUserKind("The plugin changed. Review and approve to continue.")).toBe("reapprove");
  expect(needsUserKind("The plugin's settings, resources or readiness changed. Review and approve to continue.")).toBe("reapprove");
  expect(needsUserKind("This connection changed. Restore the original connection to continue.")).toBe("connection");
  expect(needsUserKind("Connection changed since the push started.")).toBe("connection");
  expect(needsUserKind("Upload paused after repeated failures with every transfer method. timeout")).toBe("upload");
  expect(needsUserKind("Local copy operation failed.")).toBe("other");
  expect(needsUserKind(null)).toBe("other");
});

test("push review and verification offer the import controls, not plain resume", () => {
  const review = describeRun(run("waiting_for_user", { statusReason: "Review the import before it is activated. Approve or roll back in WordPress Manager.", resumable: resumable({ state: "needs-user" }) }), "push");
  expect(review).toMatchObject({ needsUser: "review", tone: "warning", terminal: false, buttons: ["approve", "rollback"] });
  const replace = describeRun(run("waiting_for_user", { statusReason: "Review the import before it is activated.", resumable: resumable({ state: "needs-user" }) }), "replace");
  expect(replace.label).toBe("Review the replacements");
  const verify = describeRun(run("waiting_for_user", { statusReason: "Verify the destination site, then finish or roll back the import in WordPress Manager.", resumable: resumable({ state: "needs-user" }) }), "push");
  expect(verify.buttons).toEqual(["finish", "rollback"]);
  // Outside a push the same words never offer import controls.
  expect(describeRun(run("waiting_for_user", { statusReason: "Review the import before it is activated.", resumable: resumable({ state: "needs-user" }) })).buttons).toEqual(["resume", "cancel"]);
});

test("other needs-user reasons resume or re-approve", () => {
  expect(describeRun(run("waiting_for_user", { statusReason: "Upload paused after repeated failures with every transfer method.", resumable: resumable({ state: "needs-user" }) }), "push")).toMatchObject({ label: "Upload paused", buttons: ["resume", "cancel"] });
  expect(describeRun(run("waiting_for_user", { statusReason: "This connection changed. Cancel the old pull and start a new one.", resumable: resumable({ state: "needs-user" }) }))).toMatchObject({ label: "Connection changed", buttons: ["resume", "cancel"] });
  expect(describeRun(run("waiting_for_user", { statusReason: "The plugin changed. Review and approve to continue.", resumable: resumable({ state: "needs-user" }) }), "push").buttons).toEqual(["reapprove", "cancel"]);
});

test("resumable states map to labels and buttons", () => {
  expect(describeRun(run("running", { resumable: resumable() }))).toMatchObject({ label: "Running", tone: "running", working: true, buttons: ["pause", "cancel"] });
  expect(describeRun(run("retry_scheduled", { resumable: resumable({ state: "waiting", lastError: { code: "transfer_transient", message: "Timed out" }, consecutiveFailures: 2 }) }))).toMatchObject({ label: "Retrying (attempt 3)", tone: "warning", reason: "Timed out", buttons: ["pause", "cancel"] });
  expect(describeRun(run("retry_scheduled", { resumable: resumable({ state: "waiting" }) })).label).toBe("Waiting");
  expect(describeRun(run("waiting_for_user", { resumable: resumable({ state: "paused" }) }))).toMatchObject({ label: "Paused", working: false, buttons: ["resume", "cancel"] });
  expect(describeRun(run("waiting_for_event", { resumable: resumable({ state: "paused-for-update" }) }))).toMatchObject({ tone: "info", buttons: ["cancel"] });
  expect(describeRun(run("waiting_for_user", { resumable: resumable({ state: "resume-needed" }) }))).toMatchObject({ label: "Resume needed", buttons: ["resume", "cancel"] });
  expect(describeRun(run("waiting_for_approval"))).toMatchObject({ label: "Waiting for your approval", buttons: ["cancel"] });
  expect(describeRun(run("pending"))).toMatchObject({ label: "Queued", buttons: ["cancel"] });
});

test("terminal runs: dry runs, rollbacks, cleanup and failures", () => {
  expect(describeRun(run("succeeded", { output: { status: "dry-run", summary: "Dry run: 3 artifacts" } }), "push")).toMatchObject({ dryRun: true, label: "Dry run complete · nothing was changed", buttons: [] });
  expect(describeRun(run("succeeded", { output: { status: "complete", cleanedUp: false } }), "push").buttons).toEqual(["rollback", "cleanup"]);
  expect(describeRun(run("succeeded", { output: { status: "complete", cleanedUp: true } }), "push").buttons).toEqual([]);
  expect(describeRun(run("succeeded", { output: { status: "complete" } })).buttons).toEqual([]);
  expect(describeRun(run("succeeded", { output: { status: "rolled_back", summary: "Import rolled back on https://x" } }), "push")).toMatchObject({ tone: "neutral", reason: "Import rolled back on https://x" });
  expect(describeRun(run("failed", { error: "Confirm the exact destination address." }))).toMatchObject({ tone: "error", terminal: true, reason: "Confirm the exact destination address." });
  expect(describeRun(run("cancelled")).label).toBe("Cancelled");
  expect(describeRun(run("outcome_unknown"), "push")).toMatchObject({ tone: "warning", terminal: true });
});

test("progress views format bytes, files and the copy's pulling phase", () => {
  expect(progressView({ phase: "uploading", done: 5_000_000, total: 10_000_000, unit: "bytes" })).toEqual({ label: "Uploading files", percent: 50, detail: "5.00 MB / 10.00 MB", message: null });
  expect(progressView({ phase: "comparing", done: 40, total: 120, unit: "files" })).toMatchObject({ label: "Comparing", percent: 33, detail: "40 / 120 files" });
  expect(progressView({ phase: "pulling: downloading", done: 1, unit: "bytes" })).toMatchObject({ label: "Pulling · Downloading", percent: null, detail: "1 B" });
  expect(progressView({ phase: "creating site", message: "Waiting for the local DDEV site to start." })).toMatchObject({ label: "Creating site", detail: null, message: "Waiting for the local DDEV site to start." });
  expect(progressView({ phase: "rolling_back" })?.label).toBe("Rolling back");
  expect(progressView({ phase: "importing", done: 12, total: 10, unit: "steps" })?.percent).toBe(100);
  expect(progressView(null)).toBeNull();
});

test("a held site lock reads as another transfer on this site", () => {
  const busy = new Error("Another run of this plugin is already working on the same item. Wait for it to finish or stop it first.");
  expect(isBusyError(busy.message)).toBe(true);
  expect(isBusyError("resumable_busy")).toBe(true);
  expect(engineErrorMessage(busy)).toMatch(/^Another transfer is running on this site/);
  expect(engineErrorMessage(new Error("This site uses the legacy transfer engine."))).toBe("This site uses the legacy transfer engine.");
  expect(engineErrorMessage(null, "Fallback")).toBe("Fallback");
});

test("request IDs are 32 hex and runs expose their transfer ID", () => {
  expect(newHexId()).toMatch(/^[a-f0-9]{32}$/);
  expect(newHexId()).not.toBe(newHexId());
  expect(runTransferId({ runId: "run_1", input: { siteId: "ep_1", importId: "b".repeat(32) } })).toBe("b".repeat(32));
  expect(runTransferId({ runId: "run_1", input: { restoreId: "c".repeat(32) } })).toBe("c".repeat(32));
  expect(runTransferId({ runId: "run_1", input: null })).toBe("run_1");
});

test("a site's Transfers list counts its runs in every status, local exports included", () => {
  const recent = (actionId: string, status: string, input: Record<string, unknown>) => ({ runId: `${actionId}-${status}`, actionId, status, createdAt: "2026-10-04T00:00:00Z", input });
  const runs = [
    recent("transfer.local-export", "failed", { siteId: "ddev-shop", pullId: "a".repeat(32) }),
    recent("transfer.pull", "cancelled", { siteId: "ddev-shop" }),
    recent("copy.local", "failed", { siteId: "hostinger-1", replaceSiteId: "ddev-shop" }),
    recent("transfer.pull", "succeeded", { siteId: "other" }),
    recent("transfer.preview", "succeeded", { siteId: "ddev-shop" }),
  ];
  expect(runsOfSite(runs, "ddev-shop").map(run => run.runId)).toEqual(["transfer.local-export-failed", "transfer.pull-cancelled", "copy.local-failed"]);
  expect(runsOfSite(runs.slice(0, 1), "ddev-shop")).toHaveLength(1);
});

test("a push the site refused shows as failed with the site's message", () => {
  const view = describeRun(run("succeeded", { output: { status: "failed", error: { code: "transfer_failed", message: "Every imported core or plugin table requires an existing matching destination schema." }, cancelledImport: true } }), "push");
  expect(view).toMatchObject({ label: "Failed", tone: "error", terminal: true, buttons: [] });
  expect(view.reason).toBe("Every imported core or plugin table requires an existing matching destination schema. The staged import was cancelled; nothing was activated.");
});

test("Zoer Connect's transfer fence is recognised in a failed site request", () => {
  expect(isTransferFence('HTTP 503: {"code":"zoer_transfer_paused","message":"WordPress transfer recovery is required or a request is still draining."}')).toBe(true);
  expect(isTransferFence("WordPress transfer recovery is required or a request is still draining.")).toBe(true);
  expect(isTransferFence("WordPress rejected this key.")).toBe(false);
  expect(isTransferFence(null)).toBe(false);
});

test("a finished push card follows a later rollback and cleanup of its import", () => {
  const importId = "c".repeat(32);
  const control = (control: string, status = "succeeded", phase = "done") => ({ actionId: "transfer.push.control", status, input: { siteId: "s", importId, control }, resumable: resumable({ progress: { phase } }) });
  const pushed = run("succeeded", { output: { status: "complete", cleanedUp: false } });
  expect(describeRun(pushed, "push").buttons).toEqual(["rollback", "cleanup"]);
  const rolledBack = importStateFromControls([control("rollback")], importId);
  expect(rolledBack).toEqual({ rolledBack: true });
  expect(describeRun(pushed, "push", rolledBack)).toMatchObject({ label: "Rolled back", buttons: ["cleanup"] });
  const both = importStateFromControls([control("rollback"), control("cleanup")], importId);
  expect(describeRun(pushed, "push", both)).toMatchObject({ label: "Rolled back", buttons: [], reason: "The import was rolled back and its backups and staged files were cleaned up." });
  expect(describeRun(pushed, "push", importStateFromControls([control("cleanup")], importId))).toMatchObject({ label: "Complete", buttons: [] });
  // A refused or running control, or one for another import, changes nothing.
  expect(importStateFromControls([control("rollback", "succeeded", "failed"), control("rollback", "running"), { ...control("cleanup"), input: { importId: "d".repeat(32), control: "cleanup" } }], importId)).toEqual({});
});

test("Recent transfers keeps the five newest and pins failures of the last seven days", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const entry = (runId: string, status: string, days: number, phase?: string) => ({ runId, status, createdAt: at(days), finishedAt: at(days), ...(phase ? { resumable: resumable({ progress: { phase } }) } : {}) });
  const runs = [entry("new1", "succeeded", 0.1), entry("new2", "succeeded", 0.2), entry("new3", "succeeded", 0.3), entry("new4", "succeeded", 0.4), entry("new5", "succeeded", 0.5),
    entry("failed", "failed", 3), entry("unknown", "outcome_unknown", 4), entry("refused", "succeeded", 5, "failed"), entry("old-failed", "failed", 9), entry("older-ok", "succeeded", 2), entry("running", "running", 0)];
  expect(recentTransferRuns(runs, now).map(run => run.runId)).toEqual(["new1", "new2", "new3", "new4", "new5", "failed", "unknown", "refused"]);
});
