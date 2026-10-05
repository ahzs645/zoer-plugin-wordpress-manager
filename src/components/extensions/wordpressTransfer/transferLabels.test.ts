import { expect, test } from "bun:test";
import { defaultExportOptions, defaultImportOptions, legacyImportOptions } from "../../../lib/wordpress-transfer/options";
import { connectionWarnings, databaseSummary, filesSummary, formatDuration, phaseLabel, replaceSummary, safetySummary } from "./transferLabels";
import { initialDraft, switchAction } from "./draft";


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

test("durations", () => {
  expect(formatDuration(62_000)).toBe("1m 2s");
  expect(formatDuration(45_000)).toBe("45s");
  expect(formatDuration(3_780_000)).toBe("1h 3m");
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

test("connection warnings merge plugin codes with computed checks", () => {
  const warnings = connectionWarnings({ warnings: [{ code: "firewall_plugin", message: "Wordfence is active" }], wordpress: { prefix: "wp_", blogPublic: false } }, { url: "http://example.test", sourcePrefix: "zx_" });
  expect(warnings.map(w => w.code)).toEqual(["firewall_plugin", "no_https", "blog_private", "prefix_mismatch"]);
  expect(connectionWarnings(null, { url: "https://example.test" })).toEqual([]);
});

test("switching action resets locked resources and replace table lists", () => {
  const backup = switchAction(initialDraft("pull"), "backup");
  expect(backup.exportOptions.resources.themes).toBe(false);
  expect(switchAction(backup, "pull").exportOptions.resources.themes).toBe(true);
  const replace = switchAction(initialDraft("pull"), "replace");
  const withTables = { ...replace, exportOptions: { ...replace.exportOptions, database: { ...replace.exportOptions.database, tables: ["posts"] } } };
  expect(switchAction(withTables, "pull").exportOptions.database.tables).toBe("all");
});

