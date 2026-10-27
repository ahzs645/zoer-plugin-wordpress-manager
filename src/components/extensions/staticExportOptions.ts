import { formatWhen } from "../../lib/formatWhen";
import type { WordPressStaticExportJob, WordPressStaticExportOptions } from "@zoer/api-types";

export interface StaticExportDraft {
  mode: "site" | "selected";
  paths: string;
  linkMode: "relative" | "root";
  basePath: string;
  maxPages: string;
  maxAssets: string;
  maxMiB: string;
}

export const initialStaticExportDraft: StaticExportDraft = {
  mode: "site", paths: "/", linkMode: "relative", basePath: "/", maxPages: "500", maxAssets: "5000", maxMiB: "256",
};

function integer(value: string, label: string, maximum: number) {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new Error(`${label} must be between 1 and ${maximum}.`);
  return parsed;
}

/** The frontend rejects likely mistakes; the host independently validates every path and limit. */
export function staticExportOptions(draft: StaticExportDraft): WordPressStaticExportOptions {
  const basePath = draft.linkMode === "relative" ? "/" : draft.basePath.trim() || "/";
  if (!basePath.startsWith("/") || basePath.startsWith("//") || /[\\?#\s\u0000-\u001f\u007f]/.test(basePath))
    throw new Error("Use a destination path such as / or /resources/.");
  let decodedBase: string;
  try { decodedBase = decodeURIComponent(basePath); } catch { throw new Error("The destination path has an invalid URL escape."); }
  if (decodedBase.startsWith("//") || decodedBase.split("/").some(part => part === "." || part === "..") || /[\\?#\s\u0000-\u001f\u007f]/.test(decodedBase))
    throw new Error("Use a destination path without parent folders, spaces or URL parameters.");
  const paths = draft.mode === "site" ? ["/"] : [...new Set(draft.paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean))];
  if (!paths.length) throw new Error("Enter at least one page path.");
  if (paths.length > 100) throw new Error("Choose up to 100 starting page paths.");
  for (const path of paths) {
    if (path.length > 2048 || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path))
      throw new Error("Enter page paths from this site, such as /news/, one per line.");
    let decoded: string;
    try { decoded = decodeURIComponent(path.split(/[?#]/)[0]!); } catch { throw new Error("A page path has an invalid URL escape."); }
    if (decoded.split("/").some(part => part === "." || part === "..") || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded))
      throw new Error("Page paths cannot contain parent folders or another host.");
  }
  return {
    mode: draft.mode,
    paths,
    linkMode: draft.linkMode,
    basePath: basePath.endsWith("/") ? basePath : `${basePath}/`,
    maxPages: integer(draft.maxPages, "Page limit", 500),
    maxAssets: integer(draft.maxAssets, "Asset limit", 5000),
    maxBytes: integer(draft.maxMiB, "Size limit", 256) * 1024 * 1024,
  };
}

export function staticExportActive(job: Pick<WordPressStaticExportJob, "status">) {
  return job.status === "queued" || job.status === "running";
}

export function staticExportBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

/** Only the exact host-owned preview route may open from a job response. */
export function staticExportPreviewPath(job: Pick<WordPressStaticExportJob, "siteId" | "id" | "previewUrl" | "status">) {
  if (job.status !== "ready" || !job.previewUrl) return null;
  const path = `/wordpress-manager/sites/${encodeURIComponent(job.siteId)}/static-exports/${encodeURIComponent(job.id)}/preview/index.html`;
  return job.previewUrl === path || job.previewUrl === `/api${path}` ? path : null;
}

export function staticExportFilename(siteName: string, exportId: string) {
  const name = siteName.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "wordpress";
  return `${name}-static-${exportId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "export"}.zip`;
}

/** Zoer's calendar-relative time ("Today 6:58 PM"); the exact time stays in the element's dateTime. */
export function staticExportTimestamp(value: string, now?: Date) {
  return Number.isNaN(new Date(value).getTime()) ? "Date unavailable" : formatWhen(value, now);
}
