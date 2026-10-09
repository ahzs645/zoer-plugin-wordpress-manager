import { expect, test } from "bun:test";
import { localUrlRules } from "./LocalImportPanels";
import { databaseFacts, localCopyStages, restoreStages, skippedFiles, stageIndex } from "./PluginRunCard";

test("the run card lists the files a push left out", () => {
  expect(skippedFiles({ count: 3, reason: "not accepted by Zoer Connect", files: [{ path: "wp-content/plugins/akismet/.htaccess", reason: "hidden file or folder" }, { path: 7 }] }))
    .toEqual({ count: 3, reason: "not accepted by Zoer Connect", files: [{ path: "wp-content/plugins/akismet/.htaccess", reason: "hidden file or folder" }] });
  expect(skippedFiles(undefined)).toBeNull();
  expect(skippedFiles({ count: 0, files: [] })).toBeNull();
});

test("local copy and restore runs show their stages, with a recovery backup only for refreshes", () => {
  const fresh = localCopyStages({});
  expect(fresh.map(stage => stage.label)).toEqual(["Pull the source", "Check the download", "Create the local site", "Stage verified files", "Import database", "Place files", "Verify the local site"]);
  const refresh = localCopyStages({ replaceSiteId: "ddev-shop", pullSetId: "fs_x", users: "source" });
  expect(refresh.map(stage => stage.label)).toEqual(["Check the download", "Start the local copy", "Recovery backup", "Stage verified files", "Import database and users", "Place files", "Verify the local site"]);
  expect(stageIndex(fresh, "pulling: downloading")).toBe(0);
  expect(stageIndex(fresh, "staging files")).toBe(3);
  expect(stageIndex(restoreStages({}), "preparing backup")).toBe(3);
  expect(stageIndex(fresh, "something else")).toBe(-1);
});

test("the importer summary reads as short facts", () => {
  expect(databaseFacts({ tables: 42, rows: 18234, replacements: 311, users: { mode: "source", copied: 114, meta: 3403 } }))
    .toEqual(["42 tables", "18,234 rows", "311 URL replacements", "114 users and 3,403 user meta rows copied"]);
  expect(databaseFacts({ tables: 3, rows: 0, replacements: 0, users: { mode: "local" } })).toEqual(["3 tables", "0 rows", "local accounts kept"]);
  expect(databaseFacts({ tables: 3, users: { mode: "local" }, collations: [{ from: "utf8mb4_0900_ai_ci", to: "utf8mb4_unicode_520_ci", tables: 12 }, { from: "utf8mb4_0900_as_cs", to: "utf8mb4_bin", tables: 1 }, { from: "", to: "x" }] }))
    .toEqual(["3 tables", "local accounts kept", "collation utf8mb4_0900_ai_ci → utf8mb4_unicode_520_ci in 12 tables", "collation utf8mb4_0900_as_cs → utf8mb4_bin in 1 table"]);
  expect(databaseFacts(null)).toEqual([]);
});

test("the Find & Replace panel shows the importer's URL forms for the source address", () => {
  expect(localUrlRules("https://example.com/").map(rule => rule.find)).toEqual(["https://example.com", "http://example.com", "//example.com", "https:\\/\\/example.com", "https%3A%2F%2Fexample.com"]);
  expect(localUrlRules(null)[0]!.find).toBe("https://<source address>");
});

test("exact user copies read as such on the run card", () => {
  expect(databaseFacts({ tables: 2, rows: 5, replacements: 0, users: { mode: "exact", copied: 3, meta: 40 } })).toEqual(["2 tables", "5 rows", "3 users and 40 user meta rows copied exactly, no extra administrator"]);
  expect(localCopyStages({ users: "exact" }).map(stage => stage.label)).toContain("Import database and users");
});
