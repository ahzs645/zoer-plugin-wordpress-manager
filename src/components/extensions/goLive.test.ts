import { describe, expect, test } from "bun:test";
import { goLiveStage, parseGoLivePlan, pushApproval } from "./GoLive";
import type { HostingerTestSite } from "./hostingerTestSites";

const plan = { sourceSiteId: "ddev-shop", deploymentId: "dep-1", connectionId: "conn-1", domain: "blue-fox-1.hostingersite.com", pullId: "a".repeat(32), exportRunId: "run-export", startedAt: "2026-10-20T12:00:00Z" };
const site = (extra: Partial<HostingerTestSite>): HostingerTestSite => ({ id: "dep-1", connectionId: "conn-1", domain: plan.domain, status: "preparing", step: "Hostinger is setting up the website", error: null, createdAt: plan.startedAt, running: true, ready: false, deleted: false, warnings: [], ...extra });

describe("Create a live site plans", () => {
  test("a record is read back only when complete", () => {
    expect(parseGoLivePlan({ kind: "go-live", data: { v: 1, ...plan, pushRunId: "run-push" } })).toEqual({ ...plan, pushRunId: "run-push", endpointId: undefined, error: undefined });
    expect(parseGoLivePlan({ kind: "go-live", data: { ...plan, pullId: "" } })).toBeNull();
    expect(parseGoLivePlan({ kind: "site-link", data: plan })).toBeNull();
  });

  test("the card line follows the website, then the push", () => {
    expect(goLiveStage(plan, undefined)).toEqual({ text: "Creating blue-fox-1.hostingersite.com…", tone: "running" });
    expect(goLiveStage(plan, site({}))).toEqual({ text: "Creating blue-fox-1.hostingersite.com: hostinger is setting up the website…", tone: "running" });
    expect(goLiveStage(plan, site({ running: false, status: "failed", error: "Upload refused" })).tone).toBe("error");
    expect(goLiveStage(plan, site({ running: false, ready: true, status: "succeeded" })).text).toBe("blue-fox-1.hostingersite.com is ready; starting the push…");
    expect(goLiveStage({ ...plan, pushRunId: "run-push" }, site({ running: false, ready: true })).text).toBe("Publishing to blue-fox-1.hostingersite.com…");
    expect(goLiveStage({ ...plan, error: "Could not start the push: declined" }, undefined)).toEqual({ text: "Could not start the push: declined", tone: "error" });
  });
});

test("a plan approved up front follows its own push run", async () => {
  const { planPush } = await import("./GoLive");
  const run = (runId: string, siteId: string, createdAt: string) => ({ runId, actionId: "transfer.push", status: "running", createdAt, input: { siteId, exportPullId: plan.pullId, sourceSiteId: plan.sourceSiteId } });
  const runs = [run("mine", "await:blue-fox-1.hostingersite.com", "2026-10-20T12:00:01Z"), run("newer", "external:other", "2026-10-20T13:00:00Z")];
  expect(planPush({ ...plan, pushRunId: "mine" }, runs as any)?.push.runId).toBe("mine");
});

test("a push counts as approved only once its worker started", () => {
  for (const status of ["pending", "claimed", "running", "queued", "waiting_for_approval"]) expect(pushApproval({ status, resumable: { slices: 0 } })).toBe("pending");
  expect(pushApproval({ status: "pending" })).toBe("pending");
  expect(pushApproval({ status: "running", resumable: { slices: 0, startedAt: "2026-10-21T21:15:28Z" } })).toBe("approved");
  expect(pushApproval({ status: "retry_scheduled", resumable: { slices: 2 } })).toBe("approved");
  expect(pushApproval({ status: "cancelled", resumable: { slices: 0 } })).toBe("declined");
  expect(pushApproval({ status: "failed" })).toBe("declined");
});
