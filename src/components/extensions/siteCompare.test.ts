import { expect, test } from "bun:test";
import type { WordPressInstalledExtension, WordPressManagedSite } from "../../lib/api";
import { compareSites, compareSummary, extensionsReported, isDifference } from "./siteCompare";

const capabilities = { preview: true, admin: true, extensions: true, backups: true, deploySource: false, deployTarget: false, siteHealth: false, rollback: false };
function site(id: string, provider: WordPressManagedSite["provider"], extra: Partial<WordPressManagedSite> = {}): WordPressManagedSite {
  return { id, provider, environment: provider === "ddev" ? "local" : "production", name: id, domain: null, url: null, subdomain: null, managedUrl: null, status: "running", wordpressVersion: null, phpVersion: null, updates: null, vulnerabilities: null, connectionId: null, username: null, softwareId: null, capabilities, limitation: null, ...extra };
}
function ext(slug: string, version: string, status = "active", kind: "plugin" | "theme" = "plugin"): WordPressInstalledExtension {
  return { kind, slug, name: slug.toUpperCase(), status, version, updateVersion: "", updateAvailable: false, autoUpdate: "off", vulnerabilities: [] };
}

test("compares versions, presence and activation; differences sort before matches", () => {
  const rows = compareSites({
    live: site("live", "hostinger", { wordpressVersion: "6.8.1", phpVersion: "8.2" }),
    local: site("local", "ddev", { wordpressVersion: "6.8.1", phpVersion: "8.3" }),
    livePlugins: [ext("akismet", "5.3"), ext("seo", "1.0"), ext("cache", "2.0")],
    localPlugins: [ext("akismet", "5.3"), ext("seo", "1.1"), ext("debug", "0.1"), ext("cache", "2.0", "inactive")],
    liveThemes: [ext("twentyfive", "1.2", "active", "theme")],
    localThemes: [ext("twentyfive", "1.2", "active", "theme")],
  });
  expect(rows.map(row => [row.key, row.state])).toEqual([
    ["core", "same"],
    ["php", "version-differs"],
    ["plugin:seo", "version-differs"],
    ["plugin:debug", "only-local"],
    ["plugin:cache", "status-differs"],
    ["plugin:akismet", "same"],
    ["theme:twentyfive", "same"],
  ]);
  expect(rows.find(row => row.key === "plugin:cache")?.local).toBe("2.0 · inactive");
  expect(compareSummary(rows)).toEqual({ "only-live": 0, "only-local": 1, "version-differs": 2, "status-differs": 1, same: 3, "not-reported": 0 });
});

test("a version only one side reports is not counted as a difference", () => {
  const rows = compareSites({ live: site("live", "hostinger"), local: site("local", "ddev", { wordpressVersion: "6.8" }), livePlugins: [], localPlugins: [], liveThemes: [], localThemes: [] });
  expect(rows).toEqual([{ key: "core", kind: "core", name: "WordPress", live: null, local: "6.8", state: "not-reported" }]);
  expect(rows.filter(isDifference)).toEqual([]);
});

test("a side that didn't report its plugins and themes adds no extension rows", () => {
  const local = site("local", "ddev", { wordpressVersion: "6.8" });
  const live = site("live", "zoer-connect");
  const rows = compareSites({ live, local, livePlugins: null, localPlugins: [ext("akismet", "5.3")], liveThemes: null, localThemes: [ext("twentyfive", "1.2", "active", "theme")] });
  expect(rows.filter(row => row.kind === "plugin" || row.kind === "theme")).toEqual([]);
  expect(rows.filter(isDifference)).toEqual([]);
});

test("empty lists, errors or a missing capability mean not reported", () => {
  const themes = [ext("twentyfive", "1.2", "active", "theme")];
  expect(extensionsReported({ plugins: [], themes })).toBe(true);
  expect(extensionsReported({ plugins: [], themes: [] })).toBe(false);
  expect(extensionsReported({ plugins: [], themes, errors: ["Hostinger didn't answer"] })).toBe(false);
  expect(extensionsReported({ plugins: [], themes, failed: true })).toBe(false);
  expect(extensionsReported({ site: site("x", "hostinger", { capabilities: { ...capabilities, extensions: false } }), plugins: [], themes })).toBe(false);
  expect(extensionsReported({ plugins: null, themes })).toBe(false);
  expect(extensionsReported(undefined)).toBe(false);
});
