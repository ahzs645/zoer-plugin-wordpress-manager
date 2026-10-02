import { expect, test } from "bun:test";
import type { WordPressPushJob } from "../../../lib/api/types/wordpress-transfer";
import { defaultExportOptions, defaultImportOptions, legacyImportOptions } from "../../../lib/wordpress-transfer/options";
import {
  completionSummary, connectionWarnings, databaseSummary, diffSegments, failureSummary, filesSummary, filterTransfers, formatDuration,
  jobElapsed, phaseLabel, pushProgress, pushStatusLabel, replaceSummary, safetySummary, uploadTransferSummary,
} from "./transferLabels";
import { initialDraft, switchAction } from "./draft";

const job = (patch: Partial<WordPressPushJob> = {}): WordPressPushJob => ({ id: "a".repeat(32), kind: "push", siteId: "s", phase: "uploading", status: "running", createdAt: "2026-09-29T10:00:00Z", ...patch });

test("every plugin phase has a human name", () => {
  const phases = ["snapshotting", "uploading", "checking_artifacts", "scanning_database", "mapping_authors", "preparing_tables", "reading_database", "verifying_tables", "review_required", "reserving", "preparing_files", "applying_files", "activating_tables", "verification_required", "complete", "rolling_back", "rolled_back"];
  for (const phase of phases) expect(phaseLabel(phase)).not.toContain("_");
  for (const phase of ["rollback_reset", "rollback_reset_files", "rollback_preflight_tables", "rollback_preflight_files", "rollback_tables", "rollback_files", "rollback_ready", "rollback_refusal_release"]) expect(phaseLabel(phase)).not.toBe(phase.replace(/_/g, " ").replace(/^r/, "R"));
  expect(phaseLabel("rollback_tables")).toBe("Restoring tables");
  expect(phaseLabel("mapping_authors")).toBe("Matching authors");
  expect(phaseLabel("review_required")).toBe("Waiting for your review");
  expect(phaseLabel("snapshotting")).toBe("Snapshotting the database");
  expect(phaseLabel("some_new_phase")).toBe("Some new phase");
  expect(phaseLabel(undefined)).toBe("Starting");
});

test("status labels distinguish an idle runner", () => {
  expect(pushStatusLabel(job())).toBe("Push running");
  expect(pushStatusLabel(job({ runner: "idle" }))).toBe("Push waiting for the server");
  expect(pushStatusLabel(job({ kind: "replace", status: "review" }))).toBe("Review the changes before applying");
});

test("progress prefers the server percent, then bytes, then files", () => {
  expect(pushProgress(job({ progress: { percent: 42.4, uploadedBytes: 1, totalBytes: 10 } })).percent).toBe(42);
  expect(pushProgress(job({ progress: { uploadedBytes: 250, totalBytes: 1000 } })).percent).toBe(25);
  expect(pushProgress(job({ progress: { filesUploaded: 1, fileCount: 4 } })).percent).toBe(25);
  expect(pushProgress(job()).percent).toBeNull();
});

test("durations, completion and failure summaries", () => {
  expect(formatDuration(62_000)).toBe("1m 2s");
  expect(formatDuration(45_000)).toBe("45s");
  expect(formatDuration(3_780_000)).toBe("1h 3m");
  const done = job({ status: "complete", startedAt: "2026-09-29T10:00:00Z", finishedAt: "2026-09-29T10:01:02Z", progress: { totalBytes: 12_340_000 } });
  expect(jobElapsed(done)).toBe(62_000);
  expect(completionSummary(done)).toBe("12.34 MB in 1m 2s");
  expect(completionSummary({ ...done, kind: "replace", stats: { replacements: 3 } })).toBe("3 replacements in 1m 2s");
  expect(failureSummary(job({ phase: "applying_files", lastError: { message: "x", phase: "reading_database" } }))).toBe("Failed during the importing the database stage");
  expect(failureSummary(job({ phase: "applying_files" }))).toBe("Failed during the applying files stage");
});

test("panel summaries read like WP Migrate", () => {
  const exp = { ...defaultExportOptions(), database: { tables: ["posts", "postmeta"], postTypes: "all" as const, excludeRevisions: true, excludeSpam: false, excludeTransients: true } };
  expect(databaseSummary(exp)).toBe("Database: 2 tables, no revisions, no transients");
  expect(databaseSummary(defaultExportOptions(), defaultImportOptions())).toBe("Database: all tables, no transients, authors matched");
  expect(databaseSummary({ ...exp, resources: { ...exp.resources, database: false } })).toBe("Database: not included");
  expect(filesSummary({ ...defaultExportOptions(), plugins: { mode: "selected", items: ["a", "b"] }, media: { mode: "since", since: "2026-01-01" }, excludes: ["*.log"] }))
    .toBe("Files: themes (all), plugins (2 selected), media since 2026-01-01; 1 exclusion");
  expect(replaceSummary(defaultImportOptions())).toBe("Find & Replace: URL + variants, filesystem path");
  expect(replaceSummary(legacyImportOptions())).toBe("Find & Replace: URL");
  expect(safetySummary(defaultImportOptions())).toBe("Safety: site online while staging, purge caches after");
  expect(safetySummary(legacyImportOptions())).toBe("Safety: site paused for the whole import");
});

test("diff highlights only the changed middle", () => {
  expect(diffSegments("https://old.test/a", "https://new.test/a")).toEqual({
    before: [{ text: "https://", changed: false }, { text: "old", changed: true }, { text: ".test/a", changed: false }],
    after: [{ text: "https://", changed: false }, { text: "new", changed: true }, { text: ".test/a", changed: false }],
  });
  expect(diffSegments("same", "same")).toEqual({ before: [{ text: "same", changed: false }], after: [{ text: "same", changed: false }] });
});

test("connection warnings merge plugin codes with computed checks", () => {
  const warnings = connectionWarnings({ warnings: [{ code: "firewall_plugin", message: "Wordfence is active" }], wordpress: { prefix: "wp_", blogPublic: false } }, { url: "http://example.test", sourcePrefix: "zx_" });
  expect(warnings.map(w => w.code)).toEqual(["firewall_plugin", "no_https", "blog_private", "prefix_mismatch"]);
  expect(connectionWarnings(null, { url: "https://example.test" })).toEqual([]);
});

test("history filters match either end of a transfer", () => {
  const items = [
    { kind: "pull" as const, id: "1", siteId: "a", siteName: "A", status: "ready", startedAt: "", summary: "" },
    { kind: "push" as const, id: "2", siteId: "b", siteName: "B", sourceSiteId: "a", status: "complete", startedAt: "", summary: "" },
  ];
  expect(filterTransfers(items, { siteId: "a", kind: "" }).map(i => i.id)).toEqual(["1", "2"]);
  expect(filterTransfers(items, { siteId: "", kind: "push" }).map(i => i.id)).toEqual(["2"]);
});

test("switching action resets locked resources and replace table lists", () => {
  const backup = switchAction(initialDraft("pull"), "backup");
  expect(backup.exportOptions.resources.themes).toBe(false);
  expect(switchAction(backup, "pull").exportOptions.resources.themes).toBe(true);
  const replace = switchAction(initialDraft("pull"), "replace");
  const withTables = { ...replace, exportOptions: { ...replace.exportOptions, database: { ...replace.exportOptions.database, tables: ["posts"] } } };
  expect(switchAction(withTables, "pull").exportOptions.database.tables).toBe("all");
});

test("batched uploads summarize requests, transport and batch size", () => {
  expect(uploadTransferSummary(job())).toBeNull();
  expect(uploadTransferSummary(job({ progress: { requests: 12 }, transfer: { transport: "octet-stream", batchBytes: 1572864, ceiling: null, wireBytes: 1 } }))).toBe("12 requests · binary · 1.57 MB batches");
  expect(uploadTransferSummary(job({ progress: { requests: 1 }, transfer: { transport: "chunks", batchBytes: 262144, ceiling: 262144, wireBytes: 1 } }))).toBe("1 request · single blocks · 262.14 KB batches");
});
