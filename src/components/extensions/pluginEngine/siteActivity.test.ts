import { describe, expect, test } from "bun:test";
import { activeSiteRuns } from "./siteActivity";
import type { RecentRun } from "./runState";

const run = (runId: string, actionId: string, status: string, input: Record<string, unknown>, createdAt = "2026-10-18T19:28:37.684Z"): RecentRun => ({ runId, actionId, status, input, createdAt });

describe("activeSiteRuns", () => {
  test("a refresh into a local copy is shown on that copy and pauses its changes", () => {
    const runs = [run("r1", "copy.local", "running", { siteId: "external:live", replaceSiteId: "ddev-local" })];
    expect(activeSiteRuns(runs, ["ddev-local"])).toEqual([{ run: runs[0]!, siteId: "ddev-local", writes: true, title: "Refreshing from live", needsUser: false }]);
    // The live source is only read.
    expect(activeSiteRuns(runs, ["external:live"])[0]).toMatchObject({ writes: false, title: "Making a local copy" });
  });
  test("finished runs and other sites' runs are left out", () => {
    const runs = [run("r1", "copy.local", "succeeded", { siteId: "a", replaceSiteId: "b" }), run("r2", "transfer.pull", "running", { siteId: "other" })];
    expect(activeSiteRuns(runs, ["a", "b"])).toEqual([]);
  });
  test("a push changes its target; a pull only reads its site", () => {
    const runs = [run("p", "transfer.push", "running", { siteId: "live" }, "2026-10-18T10:00:00Z"), run("l", "transfer.pull", "waiting", { siteId: "live" }, "2026-10-18T11:00:00Z")];
    const active = activeSiteRuns(runs, ["live"]);
    expect(active.map(item => [item.run.runId, item.writes, item.title])).toEqual([["l", false, "Pulling"], ["p", true, "Pushing to this site"]]);
  });
  test("a run waiting for a decision is flagged", () => {
    const runs = [{ ...run("p", "transfer.push", "running", { siteId: "live" }), resumable: { state: "needs-user" as const, slices: 1, progress: null, nextStepAt: null, lastError: null, consecutiveFailures: 0, lockKey: null } }];
    expect(activeSiteRuns(runs, ["live"])[0]?.needsUser).toBe(true);
  });
  test("a run matching two connections of one website is listed once", () => {
    const runs = [run("r", "transfer.pull", "running", { siteId: "zc", replaceSiteId: "hostinger" })];
    expect(activeSiteRuns(runs, ["hostinger", "zc"])).toHaveLength(1);
  });
});
