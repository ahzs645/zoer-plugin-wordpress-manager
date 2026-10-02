import { expect, test } from "bun:test";
import {
  applyExportCapabilities, applyImportCapabilities, compareVersions, defaultExportOptions, defaultImportOptions, defaultReplaceTables,
  enforceReviewFence, exportOptionsErrors, exportOptionsForAction, importOptionsErrors, legacyImportOptions, normalizeExportOptions,
  normalizeImportOptions, normalizeProfile, normalizeRecentRun, parseExcludes, pullContents, pullHasTableSubset, pullIncludesDownloadOnly, pullOptionsPayload,
  pushButtonLabel, replaceJobOptions, unwrapList,
} from "./options";
import { ZOER_CONNECT_CAPABILITIES } from "../api/types/wordpress-transfer";

const allCaps = Object.fromEntries(ZOER_CONNECT_CAPABILITIES.map(cap => [cap, true]));

test("UI defaults for new runs follow the contract", () => {
  expect(defaultImportOptions()).toEqual({
    replacements: { automatic: true, variants: true, paths: true, custom: [] },
    replaceGuids: true, keepActivePlugins: null, keepActiveTheme: null, authorMapping: "match",
    createTables: false, fence: "activation", review: false, purgeCaches: true,
  });
  const pull = defaultExportOptions("pull");
  expect(pull.database).toEqual({ tables: "all", postTypes: "all", excludeRevisions: false, excludeSpam: false, excludeTransients: true });
  expect(pull.resources).toEqual({ database: true, themes: true, plugins: true, media: true, muplugins: false, core: false });
  expect(defaultExportOptions("backup").resources).toEqual({ database: true, themes: false, plugins: false, media: false, muplugins: false, core: false });
});

test("an old destination receives only 0.3.14 behaviour and the UI learns what was turned off", () => {
  const { options, downgraded } = applyImportCapabilities({ ...defaultImportOptions(), review: true, replacements: { automatic: true, variants: true, paths: true, custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] } }, {});
  expect(options).toEqual(legacyImportOptions());
  expect(downgraded).toContain("URL variants");
  expect(downgraded).toContain("Author mapping");
  expect(downgraded).toContain("Review before applying");
  expect(applyImportCapabilities(defaultImportOptions(), allCaps)).toEqual({ options: defaultImportOptions(), downgraded: [] });
});

test("review always forces the activation fence", () => {
  expect(enforceReviewFence({ ...defaultImportOptions(), review: true, fence: "early" }).fence).toBe("activation");
  expect(normalizeImportOptions({ review: true, fence: "early" }).fence).toBe("activation");
  expect(importOptionsErrors({ ...defaultImportOptions(), review: true, fence: "early" })).toContain("Review before applying requires keeping the site online while staging.");
});

test("export capabilities: remote sources without filters fall back, local sources keep everything", () => {
  const filtered = { ...defaultExportOptions(), database: { ...defaultExportOptions().database, excludeRevisions: true }, themes: { mode: "active" as const, items: [] }, media: { mode: "since" as const, since: "2026-01-01" } };
  const old = applyExportCapabilities(filtered, {});
  expect(old.options).toEqual(defaultExportOptions());
  expect(old.downgraded).toEqual(["Database filters", "Theme and plugin selection", "Media date filter"]);
  expect(applyExportCapabilities(filtered, {}, true).options).toBe(filtered);
});

test("push never sends download-only resources and backups are database only", () => {
  const all = { ...defaultExportOptions(), resources: { database: true, themes: true, plugins: true, media: true, muplugins: true, core: true } };
  expect(exportOptionsForAction("push", all).resources.muplugins).toBe(false);
  expect(exportOptionsForAction("push", all).resources.core).toBe(false);
  expect(exportOptionsForAction("pull", all).resources.core).toBe(true);
  expect(exportOptionsForAction("backup", all).resources).toEqual(defaultExportOptions("backup").resources);
});

test("pull payload carries 0.4 options plus the legacy fields", () => {
  const options = { ...defaultExportOptions(), excludes: ["*.log"] };
  expect(JSON.parse(pullOptionsPayload(options))).toEqual({
    options, database: true,
    profile: { name: "Zoer remote pull", themes: true, plugins: true, media: true, muplugins: false, core: false, excludes: ["*.log"] },
  });
});

test("export validation names the missing choice", () => {
  const none = { ...defaultExportOptions(), resources: { database: false, themes: false, plugins: false, media: false, muplugins: false, core: false } };
  expect(exportOptionsErrors(none)).toEqual(["Select at least one resource."]);
  expect(exportOptionsErrors({ ...defaultExportOptions(), plugins: { mode: "selected", items: [] } })).toEqual(["Choose at least one plugin for “Selected”."]);
  expect(exportOptionsErrors({ ...defaultExportOptions(), media: { mode: "since", since: "" } })).toEqual(["Choose the date media should be copied from."]);
  expect(exportOptionsErrors({ ...defaultExportOptions(), database: { ...defaultExportOptions().database, tables: [] } })).toEqual(["Select at least one database table."]);
  expect(exportOptionsErrors(defaultExportOptions())).toEqual([]);
});

test("normalisation fills defaults and drops invalid values from stored profiles", () => {
  const profile = normalizeProfile({ id: "p1", name: "Staging", action: "push", exportOptions: { resources: { core: true }, themes: { mode: "bogus" } }, importOptions: { authorMapping: "nobody", keepActivePlugins: false, replacements: { custom: [{ find: "x" }, { nope: 1 }] } } });
  expect(profile?.exportOptions.resources.core).toBe(false);
  expect(profile?.exportOptions.themes).toEqual({ mode: "all", items: [] });
  expect(profile?.importOptions.authorMapping).toBe("match");
  expect(profile?.importOptions.keepActivePlugins).toBe(false);
  expect(profile?.importOptions.replacements.custom).toEqual([{ find: "x", replace: "", regex: false, caseSensitive: true }]);
  expect(normalizeProfile({ name: "missing id" })).toBeNull();
  expect(normalizeExportOptions({ media: { mode: "since" } }).media).toEqual({ mode: "all" });
  const round = normalizeExportOptions(JSON.parse(JSON.stringify({ ...defaultExportOptions(), plugins: { mode: "except", items: ["akismet"] } })));
  expect(round.plugins).toEqual({ mode: "except", items: ["akismet"] });
});

test("recent runs accept kind/options shapes and envelopes", () => {
  const run = normalizeRecentRun({ kind: "replace", options: { replacements: { custom: [{ find: "a", replace: "b", regex: true, caseSensitive: false }] } }, createdAt: "2026-09-01" });
  expect(run?.action).toBe("replace");
  expect(run?.importOptions.replacements.custom).toHaveLength(1);
  expect(run?.startedAt).toBe("2026-09-01");
  expect(unwrapList({ recent: [1, 2] }, "recent")).toEqual([1, 2]);
  expect(unwrapList([3], "recent")).toEqual([3]);
  expect(unwrapList(null, "recent")).toEqual([]);
});

test("pull contents classify both option generations", () => {
  expect(pullContents({ database: true, profile: { themes: false, plugins: false, media: false } }).label).toBe("Database only");
  expect(pullContents({ database: true, profile: { themes: true, plugins: true, media: true } }).label).toBe("Complete site");
  expect(pullContents(defaultExportOptions("backup")).label).toBe("Database only");
  expect(pullContents({ resources: { database: false, media: true } }).label).toBe("Files only");
  expect(pullIncludesDownloadOnly({ resources: { core: true } })).toBe(true);
  expect(pullIncludesDownloadOnly({ profile: { muplugins: false } })).toBe(false);
  expect(pullHasTableSubset({ database: { tables: ["posts"] } })).toBe(true);
  expect(pullHasTableSubset(defaultExportOptions())).toBe(false);
});

test("find & replace jobs use custom rows only, with review and the late fence", () => {
  const options = replaceJobOptions({ ...defaultImportOptions(), fence: "early", replacements: { automatic: true, variants: true, paths: true, custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] } }, false);
  expect(options.replacements).toEqual({ automatic: false, variants: false, paths: false, custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] });
  expect(options.review).toBe(true);
  expect(options.fence).toBe("activation");
  expect(options.purgeCaches).toBe(false);
  expect(defaultReplaceTables(["posts", "users", "usermeta", "options"])).toEqual(["posts", "options"]);
  expect(importOptionsErrors(defaultImportOptions(), { requireCustom: true })).toEqual(["Add at least one find & replace row."]);
});

test("small helpers", () => {
  expect(parseExcludes(" *.log \n\n uploads/cache/*\r\n")).toEqual(["*.log", "uploads/cache/*"]);
  expect(compareVersions("0.4.0", "0.3.14")).toBe(1);
  expect(compareVersions("0.3.14", "0.3.14")).toBe(0);
  expect(compareVersions("0.3.9", "0.3.10")).toBe(-1);
  expect(pushButtonLabel("all", 0)).toBe("Push all items");
  expect(pushButtonLabel("selected", 1)).toBe("Push 1 selected item");
  expect(pushButtonLabel("selected", 1200)).toBe(`Push ${(1200).toLocaleString()} selected items`);
});
