import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { bindHost } from "../../host/bridge";
import { mergeRecentRuns, recentRunsInterval, recentRunsQuery } from "./plugin-engine";
import type { RecentRun } from "../../components/extensions/pluginEngine/runState";

const run = (runId: string, actionId: string, status: string, createdAt: string, finishedAt?: string): RecentRun => ({ runId, actionId, status, createdAt, ...(finishedAt ? { finishedAt } : {}), input: { siteId: "s" } });

test("every component shares one runs.recent call per poll", async () => {
  const calls: unknown[] = [];
  const unbind = bindHost({ request: async (method: string, input?: unknown) => { calls.push([method, input]); return { runs: [run("1", "transfer.push", "running", "2026-10-05T10:00:00Z"), run("2", "transfer.push.control", "succeeded", "2026-10-05T09:00:00Z"), run("3", "transfer.pull", "failed", "2026-10-05T08:00:00Z")] }; }, subscribe: () => () => {} });
  const client = new QueryClient();
  // What the transfer dialog mounts: workspace, site runs, engine switch, history, push flow, local copy, restore and a run card.
  const lists = [["transfer.pull", "transfer.local-export", "transfer.push", "transfer.replace", "copy.local", "transfer.push.control"], ["transfer.pull", "transfer.local-export", "transfer.push", "transfer.replace", "copy.local", "backup.restore-local"],
    ["transfer.local-export"], ["copy.local"], ["backup.restore-local"], ["transfer.push.control"]];
  const observers = lists.map(ids => new QueryObserver(client, recentRunsQuery(client, ids) as any));
  const results = await Promise.all(observers.map(observer => observer.refetch()));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(calls).toEqual([["runs.recent", { limit: 50 }]]);
  // Each component sees only its actions.
  expect((results[0]!.data as RecentRun[]).map(r => r.runId)).toEqual(["1", "2", "3"]);
  expect((results[5]!.data as RecentRun[]).map(r => r.runId)).toEqual(["2"]);
  expect((results[3]!.data as RecentRun[])).toEqual([]);
  unbind();
});

test("finished runs seen earlier stay for seven days when newer runs push them out", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const previous = [run("old-failed", "transfer.push", "failed", "2026-10-01T10:00:00Z", "2026-10-01T10:05:00Z"), run("too-old", "transfer.push", "failed", "2026-09-20T10:00:00Z", "2026-09-20T10:05:00Z"),
    run("was-running", "transfer.pull", "running", "2026-10-04T10:00:00Z"), run("fresh", "transfer.pull", "running", "2026-10-05T11:00:00Z")];
  const fresh = [run("fresh", "transfer.pull", "succeeded", "2026-10-05T11:00:00Z", "2026-10-05T11:10:00Z"), run("newest", "site.start", "succeeded", "2026-10-05T11:30:00Z")];
  expect(mergeRecentRuns(fresh, previous, now).map(r => [r.runId, r.status])).toEqual([["newest", "succeeded"], ["fresh", "succeeded"], ["old-failed", "failed"]]);
  expect(mergeRecentRuns(fresh, undefined, now).map(r => r.runId)).toEqual(["newest", "fresh"]);
});

test("the list polls every 3 s only while a run is active", () => {
  expect(recentRunsInterval([run("1", "transfer.push", "running", "x")])).toBe(3_000);
  expect(recentRunsInterval([run("1", "transfer.push", "failed", "x")])).toBe(30_000);
  expect(recentRunsInterval(undefined)).toBe(30_000);
});
