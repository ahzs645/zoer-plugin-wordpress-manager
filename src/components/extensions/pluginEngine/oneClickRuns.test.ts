import { describe, expect, test } from "bun:test";
import { abandonedPush, activeRunsOf, findOneClickPush, oneClickStages, pushSummary } from "./oneClickRuns";
import type { RecentRun } from "./runState";

const PULL = "a".repeat(32), PREVIEW = "e".repeat(32);
const run = (runId: string, actionId: string, input: Record<string, unknown>, status = "running", extra: Partial<RecentRun> = {}): RecentRun =>
  ({ runId, actionId, status, createdAt: "2026-10-20T12:00:00Z", input, ...extra });
const pushInput = { siteId: "external:live", exportPullId: PULL, sourceSiteId: "ddev-local", previewId: PREVIEW };
const states = (stages: ReturnType<typeof oneClickStages>) => Object.fromEntries(stages.map(stage => [stage.id, stage.state]));

describe("finding a one-click push", () => {
  test("pairs the newest push from the local site with its export and comparison", () => {
    const runs = [
      run("old", "transfer.push", { ...pushInput, exportPullId: "b".repeat(32) }, "succeeded", { createdAt: "2026-10-19T12:00:00Z" }),
      run("push", "transfer.push", pushInput, "waiting_for_approval"),
      run("export", "transfer.local-export", { siteId: "ddev-local", pullId: PULL }),
      run("preview", "transfer.preview", { siteId: "external:live", previewId: PREVIEW, exportPullId: PULL }),
      // A push of a chosen download is not a one-click push.
      run("manual", "transfer.push", { siteId: "external:live", setId: "fs_x", sourceSiteId: "ddev-local" }, "running", { createdAt: "2026-10-21T12:00:00Z" }),
    ];
    const found = findOneClickPush(runs, "ddev-local", "external:live")!;
    expect([found.push.runId, found.exportRun?.runId, found.previewRun?.runId]).toEqual(["push", "export", "preview"]);
    expect(findOneClickPush(runs, "ddev-local", "external:other")).toBeNull();
    // A website's IDs (its Hostinger site and its connection): a push to an earlier live site does not count.
    expect(findOneClickPush(runs, "ddev-local", ["hostinger:a:1", "external:live"])!.push.runId).toBe("push");
    expect(findOneClickPush(runs, "ddev-local", ["hostinger:b:2", "external:new"])).toBeNull();
    expect(activeRunsOf(found).map(r => r.runId)).toEqual(["push", "export", "preview"]);
  });

  test("a failed export leaves the waiting push to be withdrawn", () => {
    const push = run("push", "transfer.push", pushInput);
    expect(abandonedPush({ push, exportRun: run("export", "transfer.local-export", {}, "failed"), previewRun: null })).toBe(true);
    // A worker refusal ends the run as succeeded with a failed phase.
    expect(abandonedPush({ push, exportRun: run("export", "transfer.local-export", {}, "succeeded", { resumable: { state: "running", slices: 1, progress: { phase: "failed" }, nextStepAt: null, lastError: null, consecutiveFailures: 0, lockKey: null } }), previewRun: null })).toBe(true);
    expect(abandonedPush({ push, exportRun: run("export", "transfer.local-export", {}, "succeeded"), previewRun: run("preview", "transfer.preview", {}) })).toBe(false);
    expect(abandonedPush({ push: { ...push, status: "succeeded" }, exportRun: run("export", "transfer.local-export", {}, "failed"), previewRun: null })).toBe(false);
  });
});

describe("one-click push stages", () => {
  const host = "live.example";
  const resumable = (phase: string, state: "running" | "needs-user" = "running") => ({ state, slices: 3, progress: { phase }, nextStepAt: null, lastError: null, consecutiveFailures: 0, lockKey: null });

  test("approval first, while the export already runs", () => {
    expect(states(oneClickStages({ push: { status: "waiting_for_approval" }, input: pushInput, exportRun: { status: "running" }, previewRun: { status: "running" }, host })))
      .toEqual({ approve: "waiting", export: "active", compare: "pending", upload: "pending", apply: "pending" });
  });

  test("comparing, uploading, then updating the live site", () => {
    const exportRun = { status: "succeeded" }, previewRun = { status: "running" };
    expect(states(oneClickStages({ push: { status: "running", resumable: resumable("comparing") }, input: pushInput, exportRun, previewRun, host })))
      .toEqual({ approve: "done", export: "done", compare: "active", upload: "pending", apply: "pending" });
    expect(states(oneClickStages({ push: { status: "running", resumable: resumable("uploading") }, input: pushInput, exportRun, previewRun: { status: "succeeded" }, host })))
      .toEqual({ approve: "done", export: "done", compare: "done", upload: "active", apply: "pending" });
    expect(states(oneClickStages({ push: { status: "running", resumable: resumable("review_required", "needs-user") }, input: pushInput, exportRun, previewRun: { status: "succeeded" }, host })))
      .toEqual({ approve: "done", export: "done", compare: "done", upload: "done", apply: "waiting" });
    expect(states(oneClickStages({ push: { status: "succeeded", output: { status: "complete" } }, input: pushInput, exportRun, previewRun: { status: "succeeded" }, host })))
      .toEqual({ approve: "done", export: "done", compare: "done", upload: "done", apply: "done" });
  });

  test("nothing to send, a test run, an old destination and a failure", () => {
    const done = { status: "succeeded" };
    const unchanged = oneClickStages({ push: { status: "succeeded", output: { status: "unchanged" } }, input: pushInput, exportRun: done, previewRun: done, host });
    expect(states(unchanged)).toMatchObject({ upload: "skipped", apply: "skipped" });
    expect(unchanged.find(s => s.id === "upload")!.detail).toBe("live.example already has these changes.");
    expect(states(oneClickStages({ push: { status: "succeeded", output: { status: "dry-run" } }, input: { ...pushInput, dryRun: true }, exportRun: done, previewRun: done, host })))
      .toMatchObject({ upload: "done", apply: "skipped" });
    expect(states(oneClickStages({ push: { status: "running", resumable: resumable("exporting") }, input: { ...pushInput, previewId: undefined }, exportRun: { status: "running" }, previewRun: null, host })))
      .toMatchObject({ export: "active", compare: "skipped", upload: "pending" });
    const failed = oneClickStages({ push: { status: "succeeded", output: { status: "failed" }, resumable: resumable("failed") }, input: pushInput, exportRun: done, previewRun: done, host });
    expect(states(failed)).toMatchObject({ upload: "failed", apply: "pending" });
    const exportFailed = oneClickStages({ push: { status: "cancelled" }, input: pushInput, exportRun: { status: "failed", error: "The DDEV bridge refused the export." }, previewRun: { status: "cancelled" }, host });
    expect(states(exportFailed)).toMatchObject({ export: "failed", compare: "failed" });
    expect(exportFailed.find(s => s.id === "export")!.detail).toBe("The DDEV bridge refused the export.");
  });
});

describe("push summary line", () => {
  const now = Date.parse("2026-10-20T12:30:00Z");
  const summary = (push: Partial<RecentRun>, extra: Partial<{ exportRun: RecentRun | null }> = {}) => pushSummaryOf({ push: { ...run("push", "transfer.push", pushInput), ...push }, exportRun: null, previewRun: null, ...extra });
  const pushSummaryOf = (runs: Parameters<typeof pushSummary>[0]) => pushSummary(runs, "live.example", now);
  const progress = (phase: string, state: "running" | "needs-user" = "running") => ({ state, slices: 1, progress: { phase }, nextStepAt: null, lastError: null, consecutiveFailures: 0, lockKey: null });
  test("running, waiting and finished pushes", () => {
    expect(summary({ status: "waiting_for_approval" })).toEqual({ text: "Push to live.example is waiting for your approval", tone: "warning" });
    expect(summary({ resumable: progress("uploading") }, { exportRun: run("export", "transfer.local-export", {}, "succeeded") }).text).toBe("Push to live.example: compare with live.example…");
    expect(summary({ resumable: progress("verification_required", "needs-user") }).tone).toBe("warning");
    expect(summary({ status: "succeeded", finishedAt: "2026-10-20T12:00:00Z", resumable: progress("complete") })).toEqual({ text: "Pushed to live.example 30 min ago", tone: "success" });
    expect(summary({ status: "succeeded", finishedAt: "2026-10-20T12:29:50Z", resumable: progress("unchanged") }).text).toBe("live.example was already up to date (just now)");
    expect(summary({ status: "succeeded", finishedAt: "2026-10-18T12:00:00Z", resumable: progress("failed") })).toEqual({ text: "Last push to live.example failed 2 days ago", tone: "error" });
  });
});

describe("a push into a website still being created", () => {
  test("skips the comparison and says it waits for the website", () => {
    const input = { siteId: "await:new.example", exportPullId: PULL, sourceSiteId: "ddev-local" };
    const stages = oneClickStages({ push: { status: "running", resumable: { state: "running", progress: { phase: "waiting for site" } } as any }, input, exportRun: { status: "succeeded" }, previewRun: null, host: "new.example" });
    expect(states(stages)).toMatchObject({ approve: "done", export: "done", compare: "skipped", upload: "active" });
    expect(stages.find(stage => stage.id === "compare")!.detail).toBe("A new website: everything in the export is sent.");
    expect(stages.find(stage => stage.id === "upload")!.detail).toBe("Waiting for new.example to be ready.");
    const runs = [run("push", "transfer.push", input), run("export", "transfer.local-export", { siteId: "ddev-local", pullId: PULL }, "succeeded")];
    expect(findOneClickPush(runs, "ddev-local", ["external:new", "await:new.example"])?.exportRun?.runId).toBe("export");
  });
});
