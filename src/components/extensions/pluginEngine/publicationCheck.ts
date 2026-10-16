import type { StatusTone } from "@zoer/plugin-ui/controls";
import type { HostingerConnectionPublic, WordPressManagedSite } from "../../../lib/api";
import type { CatalogRecord } from "../../../lib/queries/plugin-engine";

/**
 * Public-site verification records (`publication-check:<siteId>`, written by `publication.verify`),
 * cache-clearing receipts (`cache-purge:<siteId>`) and the explicit link between a Zoer Connect
 * site and the hosting website whose caches may be cleared (`cache-link:<siteId>`).
 *
 * The labels keep four facts apart: the transfer completed; a WordPress purge was requested;
 * a hosting/CDN purge was accepted; the expected publication was observed publicly.
 */
export type CheckStatus = "current" | "stale" | "failed" | "not-verifiable" | "superseded";
export interface CheckResult { kind: "page" | "asset"; url: string; path: string; variant: string; status: string; httpStatus: number | null; detail?: string; observedPublication?: string; freshResponse?: string; headers?: Record<string, string>; redirects?: Array<{ status: number; to: string }> }
export interface PublicationCheck {
  siteId: string; importId: string | null; publicationId: string | null; checkId: string; reason: string; purgeId: string | null;
  status: CheckStatus; detail: string | null; summary: string; attempt: number; rechecking: boolean; startedAt: string; checkedAt: string;
  coverage: { pages: string[]; variants: string[]; assets: number }; results: CheckResult[];
  advisory: { maxAgeSeconds: number; cacheControl: string } | null;
  wordpressCache: { state: string; ranAt: number | null; layers: Array<{ key: string; label: string; status: string }> } | null;
}

const str = (value: unknown) => typeof value === "string" ? value : null;
export function parsePublicationCheck(record: CatalogRecord | undefined | null): PublicationCheck | null {
  const d = record?.data as Record<string, any> | undefined;
  if (!d || d.v !== 1 || typeof d.siteId !== "string" || typeof d.status !== "string") return null;
  return {
    siteId: d.siteId, importId: str(d.importId), publicationId: str(d.publicationId), checkId: String(d.checkId ?? ""), reason: String(d.reason ?? "recheck"), purgeId: str(d.purgeId),
    status: d.status as CheckStatus, detail: str(d.detail), summary: String(d.summary ?? ""), attempt: Number(d.attempt) || 1, rechecking: d.rechecking === true,
    startedAt: String(d.startedAt ?? ""), checkedAt: String(d.checkedAt ?? ""),
    coverage: { pages: Array.isArray(d.coverage?.pages) ? d.coverage.pages.map(String) : [], variants: Array.isArray(d.coverage?.variants) ? d.coverage.variants.map(String) : [], assets: Number(d.coverage?.assets) || 0 },
    results: Array.isArray(d.results) ? d.results : [], advisory: d.advisory && Number.isFinite(d.advisory.maxAgeSeconds) ? d.advisory : null,
    wordpressCache: d.wordpressCache && typeof d.wordpressCache === "object" ? d.wordpressCache : null,
  };
}

export interface CheckView { tone: StatusTone; label: string; description: string }
/** The honest label for a site's public state. `importId`: the publication this view is about, when known. */
export function publicationView(check: PublicationCheck | null, { importId, checking = false, purgePending = false }: { importId?: string | null; checking?: boolean; purgePending?: boolean } = {}): CheckView {
  const relevant = check && (!importId || !check.importId || check.importId === importId) ? check : null;
  if (checking && relevant?.rechecking) return { tone: "warning", label: "Caches cleared · rechecking", description: "A purge was requested. The public site still served old content at the last attempt; Zoer is checking again." };
  if (checking) return { tone: "running", label: "Checking public site…", description: "Reading the public pages the way an anonymous visitor does." };
  if (!relevant) return { tone: "warning", label: "Published · check pending", description: "The transfer completed. What visitors receive has not been checked yet." };
  if (relevant.rechecking || (purgePending && relevant.status === "stale")) return { tone: "warning", label: "Caches cleared · still old", description: "A purge was accepted, but the public site still served old content at the last check." };
  switch (relevant.status) {
    case "current": return { tone: "success", label: "Current on checked pages", description: coverageText(relevant) };
    case "stale": return { tone: "warning", label: "Old content detected", description: "Some public responses still contain an earlier publication." };
    case "not-verifiable": return { tone: "neutral", label: "Not verifiable", description: relevant.detail ?? "This site cannot report what it publishes." };
    case "superseded": return { tone: "neutral", label: "Superseded", description: "A newer publication replaced this one." };
    default: return { tone: "error", label: "Check failed", description: "The public check hit an error; this does not mean the transfer failed." };
  }
}

export function coverageText(check: PublicationCheck) {
  const pages = check.coverage.pages.length;
  const variants = check.coverage.variants.join(" and ") || "desktop";
  return `${pages} page${pages === 1 ? "" : "s"} (${variants})${check.coverage.assets ? ` and ${check.coverage.assets} CSS/JS file${check.coverage.assets === 1 ? "" : "s"}` : ""}, checked from Zoer's server${check.checkedAt ? ` at ${new Date(check.checkedAt).toLocaleString()}` : ""}.`;
}

export const RESULT_LABELS: Record<string, string> = {
  current: "Current", "asset-current": "Current", stale: "Old publication", "stale-content": "Old page content", "no-marker": "No publication marker", "stale-asset": "Old file",
  "redirect-offsite": "Redirects elsewhere", challenge: "Security challenge", maintenance: "Maintenance page", "http-error": "HTTP error", "not-html": "Not a web page", "error-page": "Error page (HTTP 200)", timeout: "Timed out", unreachable: "Unreachable",
};
export const isProblem = (status: string) => !["current", "asset-current"].includes(status);

export function cacheHint(headers: Record<string, string> | undefined) {
  if (!headers) return "";
  const cache = headers["x-hcdn-cache-status"] ?? headers["cf-cache-status"] ?? headers["x-cache"] ?? headers["x-litespeed-cache"] ?? headers["x-cache-status"] ?? headers["x-proxy-cache"];
  return [cache ? `cache ${cache}` : "", headers.age ? `age ${headers.age}s` : ""].filter(Boolean).join(" · ");
}

export function humanSeconds(seconds: number) {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)} day${Math.round(seconds / 86_400) === 1 ? "" : "s"}`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)} hour${Math.round(seconds / 3_600) === 1 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

// ---------------------------------------------------------------------------------------------
// Hosting link and cache layers

export interface CacheLink { siteId: string; hostingerSiteId: string; connectionId: string; domain: string; linkedAt: string }
export function parseCacheLink(record: CatalogRecord | undefined | null): CacheLink | null {
  const d = record?.data as Record<string, any> | undefined;
  return d && d.v === 1 && typeof d.hostingerSiteId === "string" && typeof d.connectionId === "string" && typeof d.domain === "string" ? { siteId: String(d.siteId), hostingerSiteId: d.hostingerSiteId, connectionId: d.connectionId, domain: d.domain, linkedAt: String(d.linkedAt ?? "") } : null;
}
export const cacheLinkRecord = (link: CacheLink) => ({ id: `cache-link:${link.siteId}`, kind: "cache-link", title: `${link.domain} cache link`, data: { v: 1, ...link } });

/**
 * Hosting websites that may be linked to a Zoer Connect site for cache clearing: only Hostinger
 * entries listed by a connected account whose website domain is exactly the endpoint's host. A
 * matching domain is a candidate for the user to confirm, never an automatic link.
 */
export function hostingerCandidates(sites: WordPressManagedSite[], endpointUrl: string) {
  let host = "";
  try { host = new URL(endpointUrl).hostname.toLowerCase(); } catch { return []; }
  return sites.filter(site => site.provider === "hostinger" && !!site.connectionId && !!site.domain && site.domain.toLowerCase() === host);
}

export type LayerState = "requested" | "accepted" | "partial" | "unsupported" | "unavailable" | "failed" | "skipped";
export interface PurgeLayer { layer: "wordpress" | "server" | "cdn"; provider: string; state: LayerState; detail: string; at?: string; layers?: Array<{ key: string; label: string; status: string }> }
export interface PurgeReceipt { siteId: string; purgeId: string; requestedAt: string; layers: PurgeLayer[] }
export function parsePurgeReceipt(record: CatalogRecord | undefined | null): PurgeReceipt | null {
  const d = record?.data as Record<string, any> | undefined;
  return d && d.v === 1 && typeof d.purgeId === "string" && Array.isArray(d.layers) ? { siteId: String(d.siteId), purgeId: d.purgeId, requestedAt: String(d.requestedAt ?? ""), layers: d.layers } : null;
}
export const purgeReceiptRecord = (receipt: PurgeReceipt) => ({ id: `cache-purge:${receipt.siteId}`, kind: "cache-purge", title: `Cache purge ${receipt.requestedAt}`, data: { v: 1, ...receipt } });

export const LAYER_LABELS: Record<PurgeLayer["layer"], string> = { wordpress: "WordPress caches", server: "Hosting cache", cdn: "CDN" };
export const LAYER_STATE_LABELS: Record<LayerState, string> = { requested: "Purge requested", accepted: "Purge accepted", partial: "Partly requested", unsupported: "Not supported", unavailable: "Not available", failed: "Failed", skipped: "Skipped" };

/** The connection is usable now only if its latest test passed recently; an old success is not current access. */
export function connectionHealth(connection: HostingerConnectionPublic | undefined, now = Date.now()) {
  if (!connection) return { ok: false, label: "Not connected" };
  if (connection.status === "error") return { ok: false, label: `Needs reconnecting${connection.lastError ? `: ${connection.lastError}` : ""}` };
  const tested = connection.lastTestedAt ? Date.parse(connection.lastTestedAt) : NaN;
  if (!Number.isFinite(tested)) return { ok: true, label: "Not checked yet", stale: true };
  const days = Math.floor((now - tested) / 86_400_000);
  return { ok: true, label: days >= 1 ? `Last checked ${days} day${days === 1 ? "" : "s"} ago` : "Checked today", stale: days >= 1 };
}

export function manualCachePath(domain: string) {
  return `Hostinger hPanel → Websites → ${domain} → Dashboard → Clear cache, then Performance → CDN → Flush cache.`;
}
