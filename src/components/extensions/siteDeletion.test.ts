import { describe, expect, test } from "bun:test";
import { eraseConfirmed, FALLBACK_DELETE_PREVIEW, previewFailure, purgeWhen } from "./siteDeletion";

describe("site deletion", () => {
  test("deleting everything needs the exact site name", () => {
    expect(eraseConfirmed("Hilltop Local", " Hilltop Local ")).toBe(true);
    expect(eraseConfirmed("Hilltop Local", "hilltop local")).toBe(false);
    expect(eraseConfirmed("", "")).toBe(false);
  });
  test("the purge date comes from the host, or the retention period", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(purgeWhen({ ...FALLBACK_DELETE_PREVIEW.trash, purgeAt: "2026-10-21T12:00:00Z" }, now)).toStartWith("in 3 days");
    expect(purgeWhen(FALLBACK_DELETE_PREVIEW.trash, now)).toStartWith("in 7 days");
  });
  test("older hosts only offer the trash", () => {
    expect(FALLBACK_DELETE_PREVIEW.erase.available).toBe(false);
  });
  test("a preview failure keeps the trash; only a bare 404 means an older host", () => {
    const err = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
    expect(previewFailure(err("Not Found", 404))).toEqual({ olderHost: true, warning: null });
    expect(previewFailure(err("Method Not Allowed", 405))).toEqual({ olderHost: true, warning: null });
    const missing = previewFailure(err("Site not found", 404, "SITE_NOT_FOUND"));
    expect(missing.olderHost).toBe(false);
    expect(missing.warning).toContain("Site not found");
    expect(previewFailure(err("Bridge timed out", 500)).olderHost).toBe(false);
    expect(previewFailure(new Error("network down")).warning).toContain("network down");
  });
});
