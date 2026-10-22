import { describe, expect, test } from "bun:test";
import { copyInput, copyInputForDownload, copyPresetRecord, copyScope, copySettingsProblem, copySettingsSummary, defaultCopySettings, parseCopyPreset, type CopySettings } from "./refreshOptions";

const refresh = (patch: Partial<CopySettings> = {}) => ({ ...defaultCopySettings(true), ...patch });
const fresh = (patch: Partial<CopySettings> = {}) => ({ ...defaultCopySettings(false), ...patch });

describe("copy settings → copy.local input", () => {
  test("defaults: a new copy takes everything; a refresh starts as database only and keeps local pages", () => {
    expect(copyInput(fresh(), false)).toEqual({ activePlugins: "source" });
    expect(copyInput(refresh(), true)).toEqual({ scope: "database", keepLocalDesign: true });
    expect(copyInput(refresh({ files: true }), true)).toEqual({ scope: "complete", activePlugins: "source" });
    expect(copyInput(fresh({ activePlugins: "none" }), false)).toEqual({});
  });
  test("a refresh with every option maps each one to the worker's fields", () => {
    const input = copyInput(refresh({ files: true, media: "since-last", plugins: { mode: "selected", items: ["akismet"] }, themes: { mode: "except", items: [] }, removeStale: true, languages: true, excludeRevisions: true, excludeSpam: true,
      postTypes: ["post", "page"], tables: ["posts", "options", "postmeta"], activePlugins: "local", replacePaths: true, custom: [{ find: "Old", replace: "New", regex: false, caseSensitive: true }, { find: "", replace: "", regex: false, caseSensitive: true }], pace: "gentle" }), true);
    expect(input).toEqual({ scope: "complete", media: "since-last", plugins: { mode: "selected", items: ["akismet"] }, removeStale: true, languages: true,
      database: { excludeRevisions: true, excludeSpam: true, postTypes: ["post", "page"], tables: ["posts", "options", "postmeta"] }, activePlugins: "local",
      replacements: { paths: true, custom: [{ find: "Old", replace: "New", regex: false, caseSensitive: true }] }, pace: "gentle" });
  });
  test("files only sends no database options; a new copy never sends refresh-only fields", () => {
    expect(copyInput(refresh({ database: false, files: true, media: "none", activePlugins: "source", custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] }), true)).toEqual({ scope: "files", media: "none" });
    expect(copyInput(fresh({ media: "since-last", removeStale: true, tables: ["posts"], activePlugins: "local" }), false)).toEqual({});
    expect(copyInput(fresh({ activePlugins: "source" }), false)).toEqual({ activePlugins: "source" });
  });
  test("scope and problems mirror the worker's refusals", () => {
    expect(copyScope({ database: false, files: false })).toBeNull();
    expect(copySettingsProblem(refresh({ database: false }), true)).toBe("Choose the database, the files, or both.");
    expect(copySettingsProblem(fresh({ files: false }), false)).toBe("A new copy takes both the database and the files.");
    expect(copySettingsProblem(refresh({ files: true, plugins: { mode: "selected", items: [] } }), true)).toContain("at least one of the plugins");
    expect(copySettingsProblem(refresh({ files: true, tables: ["postmeta"] }), true)).toBe("Include the posts and options tables.");
    expect(copySettingsProblem(refresh({ tables: ["posts"] }), true)).toBeNull();
    expect(copySettingsProblem(fresh({ tables: ["posts", "options"] }), false)).toBe("A new copy needs every table.");
    expect(copySettingsProblem(refresh({ custom: [{ find: "", replace: "x", regex: false, caseSensitive: true }] }), true)).toContain("empty find & replace");
    expect(copySettingsProblem(refresh({ files: true }), true)).toBeNull();
  });
  test("summary names what the run takes", () => {
    expect(copySettingsSummary(refresh({ files: true, media: "since-last", removeStale: true, activePlugins: "local", pace: "gentle" }), true))
      .toBe("Database and files · new media only · deleted files removed · local plugins stay active · live site's users copied · gentle pace");
    expect(copySettingsSummary(refresh(), true)).toBe("Database only · live site's users copied");
    expect(copySettingsSummary(refresh({ users: "local" }), true)).toBe("Database only");
    expect(copySettingsSummary(fresh(), false)).toBe("Database and files · all media · live plugins active · live site's users copied");
  });
});

describe("copies from an existing download", () => {
  test("the scope follows the download; selection options are not sent; no-media downloads refresh as without-media", () => {
    const settings = refresh({ files: true, media: "since-last", plugins: { mode: "active", items: [] }, languages: true, pace: "gentle", removeStale: true, activePlugins: "local", custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] });
    const noMedia = { options: { profile: { themes: true, plugins: true, media: false }, database: true } };
    expect(copyInputForDownload(settings, true, noMedia)).toEqual({ scope: "without-media", removeStale: true, activePlugins: "local", replacements: { custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] } });
    expect(copyInputForDownload(settings, true, { options: { profile: {}, database: true } })).toEqual({ scope: "database", keepLocalDesign: true, replacements: { custom: [{ find: "a", replace: "b", regex: false, caseSensitive: true }] } });
    expect(copyInputForDownload(settings, true, { options: { profile: { themes: true, plugins: true, media: true }, database: false } })).toEqual({ scope: "files", removeStale: true });
    expect(copyInputForDownload(fresh(), false, { options: { profile: { themes: true, plugins: true, media: true }, database: true } })).toEqual({ activePlugins: "source" });
  });
});

describe("saved presets", () => {
  test("round-trip through a catalog record, with untrusted fields reset", () => {
    const settings = refresh({ files: true, media: "none", plugins: { mode: "active", items: [] }, custom: [{ find: "a", replace: "b", regex: true, caseSensitive: false }], users: "exact" });
    const record = copyPresetRecord("abc", "Code refresh", settings, new Date("2026-10-18T12:00:00Z"));
    expect(record).toMatchObject({ id: "refresh-preset:abc", kind: "refresh-preset", title: "Code refresh" });
    expect(parseCopyPreset(record)).toEqual({ id: "refresh-preset:abc", name: "Code refresh", updatedAt: "2026-10-18T12:00:00.000Z", settings });
    const tampered = parseCopyPreset({ id: "refresh-preset:x", kind: "refresh-preset", data: { name: "X", settings: { media: "everything", activePlugins: "all", themes: { mode: "bogus" }, pace: 3, database: "yes" } } })!;
    expect(tampered.settings).toMatchObject({ media: "all", activePlugins: "source", themes: { mode: "all", items: [] }, pace: "normal", database: true, users: "local" });
    // The account choice is saved; older presets and unknown values keep only the local administrator.
    expect(record.data.settings.users).toBe("exact");
    expect(parseCopyPreset({ id: "refresh-preset:s", kind: "refresh-preset", data: { name: "S", settings: { users: "source" } } })!.settings.users).toBe("source");
    expect(parseCopyPreset({ id: "refresh-preset:o", kind: "refresh-preset", data: { name: "O", settings: {} } })!.settings.users).toBe("local");
    expect(parseCopyPreset({ id: "refresh-preset:b", kind: "refresh-preset", data: { name: "B", settings: { users: "everyone" } } })!.settings.users).toBe("local");
    expect(parseCopyPreset({ id: "pull:x", kind: "pull", data: { name: "X" } })).toBeNull();
    expect(parseCopyPreset({ id: "refresh-preset:y", kind: "refresh-preset", data: { name: "" } })).toBeNull();
  });
});
