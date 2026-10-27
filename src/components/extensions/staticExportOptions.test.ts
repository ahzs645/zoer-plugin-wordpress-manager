import { describe, expect, test } from "bun:test";
import { initialStaticExportDraft, staticExportActive, staticExportFilename, staticExportOptions, staticExportPreviewPath, staticExportTimestamp } from "./staticExportOptions";

describe("static website export choices", () => {
  test("preserves query-loop states and deduplicates selected starting paths", () => {
    const result = staticExportOptions({ ...initialStaticExportDraft, mode: "selected", paths: "/news/?query-7-page=2\n/news/?query-7-page=3\n/news/?query-7-page=2", linkMode: "root", basePath: "/resources" });
    expect(result.paths).toEqual(["/news/?query-7-page=2", "/news/?query-7-page=3"]);
    expect(result.basePath).toBe("/resources/");
    expect(result.maxBytes).toBe(256 * 1024 * 1024);
  });

  test("rejects external targets and traversal before requesting a build", () => {
    for (const paths of ["https://example.com/", "//example.com/", "/../private/", "/%2e%2e/private/", "/%2f%2fevil.test/", "/page\\private", "/%00hidden/"])
      expect(() => staticExportOptions({ ...initialStaticExportDraft, mode: "selected", paths })).toThrow();
    for (const basePath of ["https://example.com/", "//example.com/", "/%2f%2fevil.test/", "/../site/", "/%2e%2e/site/", "/site?query=1", "/site#anchor", "/site name/"])
      expect(() => staticExportOptions({ ...initialStaticExportDraft, linkMode: "root", basePath })).toThrow();
  });

  test("rejects empty selections and invalid caps without silently clipping requested coverage", () => {
    expect(() => staticExportOptions({ ...initialStaticExportDraft, mode: "selected", paths: " \n" })).toThrow();
    expect(() => staticExportOptions({ ...initialStaticExportDraft, mode: "selected", paths: Array.from({ length: 101 }, (_, i) => `/page-${i}/`).join("\n") })).toThrow();
    for (const [field, values] of [["maxPages", ["0", "501", "1.5", "-2"]], ["maxAssets", ["0", "5001"]], ["maxMiB", ["0", "257", "Infinity"]]] as const)
      for (const value of values) expect(() => staticExportOptions({ ...initialStaticExportDraft, [field]: value })).toThrow();
    expect(staticExportOptions({ ...initialStaticExportDraft, mode: "site", paths: "unused", maxPages: "1" }).paths).toEqual(["/"]);
  });

  test("defaults to portable links without applying a hidden destination folder", () => {
    expect(staticExportOptions({ ...initialStaticExportDraft, basePath: "/old-folder/" })).toMatchObject({ linkMode: "relative", basePath: "/" });
    expect(staticExportOptions({ ...initialStaticExportDraft, linkMode: "root", basePath: "/fixed" })).toMatchObject({ linkMode: "root", basePath: "/fixed/" });
  });

  test("opens only ready previews at the exact site's host route", () => {
    const job = { siteId: "ddev-source", id: "export-1", status: "ready" as const, previewUrl: "/api/wordpress-manager/sites/ddev-source/static-exports/export-1/preview/index.html" };
    expect(staticExportPreviewPath(job)).toBe("/wordpress-manager/sites/ddev-source/static-exports/export-1/preview/index.html");
    for (const previewUrl of ["https://example.com/", "javascript:alert(1)", "/api/wordpress-manager/sites/other/static-exports/export-1/preview/index.html", `${job.previewUrl}?next=https://example.com`])
      expect(staticExportPreviewPath({ ...job, previewUrl })).toBeNull();
    expect(staticExportPreviewPath({ ...job, status: "running" })).toBeNull();
  });

  test("retains finished exports while only pending builds keep polling", () => {
    expect(staticExportActive({ status: "queued" })).toBe(true);
    expect(staticExportActive({ status: "running" })).toBe(true);
    for (const status of ["ready", "failed", "cancelled"] as const) expect(staticExportActive({ status })).toBe(false);
    expect(staticExportFilename("../../A news site", "../../run")).toBe("A-news-site-static-run.zip");
    expect(staticExportTimestamp("2026-10-22T09:30:00", new Date("2026-10-22T18:00:00"))).toMatch(/^Today 9:30\sAM$/);
    expect(staticExportTimestamp("2026-03-02T09:30:00", new Date("2026-10-22T18:00:00"))).toMatch(/^Mar 2, 9:30\sAM$/);
    expect(staticExportTimestamp("invalid")).toBe("Date unavailable");
  });
});
