import { expect, test } from "bun:test";
import { confirmationHost, effectiveEngine, ENGINE_LABELS, engineRecordId, parseSiteEngine, pluginSwitchConfirmed, siteEngineRecord } from "./engineRecord";

const record = (data: Record<string, unknown>, id = "site-engine:ep_1", kind = "site-engine") => ({ id, kind, title: "Test", data });
const plugin = { v: 1, siteId: "ep_1", engine: "plugin", testTarget: true, updatedAt: "2026-10-04T10:00:00.000Z", confirmedAt: "2026-10-04T10:00:00.000Z" };

test("no record, a malformed record or another site's record means legacy", () => {
  expect(effectiveEngine(parseSiteEngine(null, "ep_1"))).toBe("legacy");
  expect(parseSiteEngine(record(plugin, "site-engine:ep_2"), "ep_1")).toBeNull();
  expect(parseSiteEngine(record({ ...plugin, siteId: "ep_2" }), "ep_1")).toBeNull();
  expect(parseSiteEngine(record(plugin, "site-engine:ep_1", "pull"), "ep_1")).toBeNull();
  expect(parseSiteEngine(record({ ...plugin, engine: "host" }), "ep_1")).toBeNull();
  expect(parseSiteEngine(record({ ...plugin, testTarget: "yes" }), "ep_1")).toBeNull();
  expect(parseSiteEngine(record({ ...plugin, updatedAt: "soon" }), "ep_1")).toBeNull();
  expect(parseSiteEngine({ id: "site-engine:ep_1", kind: "site-engine", data: null }, "ep_1")).toBeNull();
});

test("the plugin engine needs both engine plugin and a confirmed test target, like the workers", () => {
  const parsed = parseSiteEngine(record(plugin), "ep_1");
  expect(parsed).toMatchObject({ siteId: "ep_1", engine: "plugin", testTarget: true, confirmedAt: plugin.confirmedAt });
  expect(effectiveEngine(parsed)).toBe("plugin");
  expect(effectiveEngine(parseSiteEngine(record({ ...plugin, testTarget: false }), "ep_1"))).toBe("legacy");
  expect(effectiveEngine(parseSiteEngine(record({ ...plugin, engine: "legacy" }), "ep_1"))).toBe("legacy");
  expect(ENGINE_LABELS).toEqual({ legacy: "Legacy (Zoer host)", plugin: "Plugin (test target)" });
});

test("records are written per site with the documented shape", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const next = siteEngineRecord({ siteId: "hostinger-123", engine: "plugin", testTargetConfirmed: true, label: " Test site ", origin: "https://test.example.com", now });
  expect(next).toEqual({ id: engineRecordId("hostinger-123"), kind: "site-engine", title: "Test site", data: { v: 1, siteId: "hostinger-123", engine: "plugin", testTarget: true, label: "Test site", origin: "https://test.example.com", confirmedAt: now.toISOString(), updatedAt: now.toISOString() } });
  expect(parseSiteEngine(next, "hostinger-123")?.engine).toBe("plugin");
  const back = siteEngineRecord({ siteId: "hostinger-123", engine: "legacy", now });
  expect(back.data).toEqual({ v: 1, siteId: "hostinger-123", engine: "legacy", testTarget: false, updatedAt: now.toISOString() });
  expect(effectiveEngine(parseSiteEngine(back, "hostinger-123"))).toBe("legacy");
  expect(siteEngineRecord({ siteId: "external:abc", engine: "legacy" }).id).toBe("site-engine:external:abc");
  expect(siteEngineRecord({ siteId: "ddev-test-copy", engine: "legacy" }).title).toBe("ddev-test-copy");
});

test("switching to plugin is never implicit", () => {
  expect(() => siteEngineRecord({ siteId: "ep_1", engine: "plugin" })).toThrow(/non-production test site/);
  expect(() => siteEngineRecord({ siteId: "ep_1", engine: "plugin", testTargetConfirmed: false })).toThrow();
  expect(() => siteEngineRecord({ siteId: "../escape", engine: "legacy" })).toThrow();
  expect(() => siteEngineRecord({ siteId: "", engine: "legacy" })).toThrow();
});

test("the typed confirmation is the site's host name, plus the explicit acknowledgement", () => {
  expect(confirmationHost("https://Test.Example.com/wp/")).toBe("test.example.com");
  expect(confirmationHost("test.example.com")).toBe("test.example.com");
  expect(confirmationHost("https://localhost:8443")).toBe("localhost:8443");
  expect(confirmationHost("")).toBe("");
  expect(confirmationHost(null)).toBe("");
  expect(confirmationHost("http://")).toBe("");
  const host = "test.example.com";
  expect(pluginSwitchConfirmed({ host, typed: "test.example.com", acknowledged: true })).toBe(true);
  expect(pluginSwitchConfirmed({ host, typed: "  TEST.example.com ", acknowledged: true })).toBe(true);
  expect(pluginSwitchConfirmed({ host, typed: "test.example.com", acknowledged: false })).toBe(false);
  expect(pluginSwitchConfirmed({ host, typed: "example.com", acknowledged: true })).toBe(false);
  expect(pluginSwitchConfirmed({ host, typed: "https://test.example.com", acknowledged: true })).toBe(false);
  expect(pluginSwitchConfirmed({ host: "", typed: "", acknowledged: true })).toBe(false);
});
