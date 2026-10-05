import { expect, test } from "bun:test";
import {
  defaultSelection, filterEngineHistory, mergeEngineHistory, parseHistoryRecord, parseLocalCopyRecord, parsePreviewSummary, parsePullRecord,
  previewExpired, previewFiles, pullHasDatabase, pushSources, refreshCandidates, type LocalCopyRecord, type PullRecord,
} from "./records";
import type { RecentRun } from "./runState";

const set = (n: number) => `fs_${String(n).repeat(32).slice(0, 32)}`;
const pull = (patch: Record<string, unknown>) => ({ id: `pull:${patch.pullId}`, kind: "pull", data: { v: 1, kind: "pull", status: "ready", options: { profile: { themes: true, plugins: true, media: true }, database: true }, fileCount: 10, totalBytes: 100, createdAt: "2026-10-01T10:00:00Z", engine: "plugin", ...patch } });

test("pull records parse defensively", () => {
  const parsed = parsePullRecord(pull({ pullId: "a".repeat(32), siteId: "ep_1", setId: set(1), source: { url: "https://src.test", prefix: "wp_" } }));
  expect(parsed).toMatchObject({ siteId: "ep_1", kind: "pull", setId: set(1), status: "ready", source: { url: "https://src.test", prefix: "wp_" } });
  expect(parsePullRecord(pull({ pullId: "a".repeat(32), siteId: "ep_1", setId: "not-a-set" }))?.setId).toBeNull();
  expect(parsePullRecord({ ...pull({ pullId: "a".repeat(32), siteId: "ep_1" }), kind: "preview" })).toBeNull();
  expect(parsePullRecord({ kind: "pull", data: { siteId: "ep_1" } })).toBeNull();
  expect(pullHasDatabase(parsed!)).toBe(true);
  expect(pullHasDatabase({ options: { profile: { media: true }, database: false } })).toBe(false);
});

test("push sources are ready pulls of other sites without download-only resources, newest first", () => {
  const pulls = [
    pull({ pullId: "1".repeat(32), siteId: "ep_dest", setId: set(1) }),
    pull({ pullId: "2".repeat(32), siteId: "ep_src", setId: set(2), createdAt: "2026-10-02T10:00:00Z" }),
    pull({ pullId: "3".repeat(32), siteId: "ddev-local", kind: "local-export", setId: set(3), createdAt: "2026-10-03T10:00:00Z" }),
    pull({ pullId: "4".repeat(32), siteId: "ep_src", setId: null, status: "dry-run" }),
    pull({ pullId: "5".repeat(32), siteId: "ep_src", setId: set(5), status: "downloading" }),
    pull({ pullId: "6".repeat(32), siteId: "ep_src", setId: set(6), options: { profile: { core: true }, database: true } }),
  ].map(parsePullRecord).filter((p): p is PullRecord => !!p);
  expect(pushSources(pulls, "ep_dest").map(p => p.pullId[0])).toEqual(["3", "2"]);
});

test("refresh candidates are complete copies of the same source, one per target", () => {
  const copies = [
    { copyId: "1", kind: "copy", sourceSiteId: "ep_1", targetId: "ddev-a", phase: "complete", finishedAt: "2026-10-01T00:00:00Z" },
    { copyId: "2", kind: "copy", sourceSiteId: "ep_1", targetId: "ddev-a", phase: "complete", finishedAt: "2026-10-02T00:00:00Z", name: "newer" },
    { copyId: "3", kind: "copy", sourceSiteId: "ep_2", targetId: "ddev-b", phase: "complete" },
    { copyId: "4", kind: "restore", sourceSiteId: "ep_1", targetId: "ddev-c", phase: "complete" },
    { copyId: "5", kind: "copy", sourceSiteId: "ep_1", targetId: "ddev-d", phase: "files" },
  ].map(data => parseLocalCopyRecord({ kind: "local-copy", data })).filter((c): c is LocalCopyRecord => !!c);
  const candidates = refreshCandidates(copies, "ep_1");
  expect(candidates.map(c => c.targetId)).toEqual(["ddev-a"]);
  expect(candidates[0].name).toBe("newer");
});

test("preview pages are read in page order for one preview only", () => {
  const previewId = "e".repeat(32);
  const records = [
    { kind: "preview-page", data: { previewId, page: 1, files: [{ path: "wp-content/b.php", bytes: 2, state: "unchanged" }] } },
    { kind: "preview-page", data: { previewId, page: 0, files: [{ path: "database.sql", bytes: 5, state: "database" }, { path: "wp-content/a.php", bytes: 1, state: "new" }, { path: "bad", state: "weird" }] } },
    { kind: "preview-page", data: { previewId: "f".repeat(32), page: 0, files: [{ path: "other", bytes: 1, state: "new" }] } },
    { kind: "preview-page", data: { previewId, page: 2, files: [{ path: "wp-content/c.php", bytes: 3, state: "changed" }, { path: "wp-content/d.php", bytes: 3, state: "blocked" }] } },
  ];
  const files = previewFiles(records, previewId);
  expect(files.map(f => f.path)).toEqual(["database.sql", "wp-content/a.php", "wp-content/b.php", "wp-content/c.php", "wp-content/d.php"]);
  expect(defaultSelection(files)).toEqual(["wp-content/a.php", "wp-content/c.php"]);
  const summary = parsePreviewSummary({ kind: "preview", data: { previewId, siteId: "ep_1", setId: set(1), total: 5, pages: 3, complete: true, expiresAt: "2026-10-04T11:00:00Z", counts: { new: 1, changed: 1 } } });
  expect(summary?.counts).toEqual({ new: 1, changed: 1, unchanged: 0, blocked: 0, database: 0 });
  expect(previewExpired(summary!, Date.parse("2026-10-04T10:59:59Z"))).toBe(false);
  expect(previewExpired(summary!, Date.parse("2026-10-04T11:00:00Z"))).toBe(true);
});

const recent = (patch: Partial<RecentRun>): RecentRun => ({ runId: "run_1", actionId: "transfer.push", status: "succeeded", createdAt: "2026-10-04T09:00:00Z", input: {}, ...patch });

test("history merges catalog records with runs; pushes come from runs only", () => {
  const records = [
    { kind: "transfer-history", data: { v: 1, kind: "pull", id: "a".repeat(32), siteId: "ep_1", siteName: "Test", status: "ready", startedAt: "2026-10-04T08:00:00Z", finishedAt: "2026-10-04T08:05:00Z", bytes: 100, summary: "Pulled 10 files.", engine: "plugin" } },
    { kind: "transfer-history", data: { kind: "local-copy", id: "c".repeat(32), siteId: "ep_1", status: "failed", startedAt: "2026-10-03T08:00:00Z", summary: "Copy failed.", lastError: { message: "DDEV stopped" }, engine: "legacy" } },
    { kind: "transfer-history", data: { kind: "bogus", id: "x", siteId: "ep_1", startedAt: "2026-10-03T08:00:00Z" } },
  ].map(parseHistoryRecord).filter(item => !!item);
  expect(records.map(r => r!.engine)).toEqual(["plugin", "legacy"]);
  expect(records[1]!.error).toBe("DDEV stopped");
  const runs = [
    recent({ runId: "run_push", actionId: "transfer.push", input: { siteId: "ep_2", importId: "b".repeat(32), sourceSiteId: "ep_1", dryRun: true }, createdAt: "2026-10-04T09:00:00Z" }),
    recent({ runId: "run_pull", actionId: "transfer.pull", input: { siteId: "ep_1", pullId: "a".repeat(32) } }),
    recent({ runId: "run_active", actionId: "transfer.pull", status: "running", input: { siteId: "ep_1", pullId: "d".repeat(32) }, createdAt: "2026-10-04T10:00:00Z", resumable: { state: "paused", slices: 1, progress: null, nextStepAt: null, lastError: null, consecutiveFailures: 0, lockKey: null } }),
    recent({ runId: "run_preview", actionId: "transfer.preview", input: { siteId: "ep_2" } }),
  ];
  const merged = mergeEngineHistory(records as NonNullable<typeof records[number]>[], runs);
  expect(merged.map(item => `${item.kind}:${item.id[0]}:${item.status}`)).toEqual(["pull:d:paused", "push:b:dry-run", "pull:a:ready", "local-copy:c:failed"]);
  expect(merged.find(item => item.id === "a".repeat(32))).toMatchObject({ summary: "Pulled 10 files.", runId: "run_pull", active: false });
  expect(merged[0].active).toBe(true);
  expect(filterEngineHistory(merged, { siteId: "ep_1", kind: "" }).map(item => item.id[0])).toEqual(["d", "b", "a", "c"]);
  expect(filterEngineHistory(merged, { siteId: "ep_2", kind: "push" }).length).toBe(1);
  expect(filterEngineHistory(merged, { siteId: "alias", kind: "", canonicalId: id => id === "alias" ? "ep_2" : id }).map(item => item.kind)).toEqual(["push"]);
});
