// `publication.verify`: what ordinary visitors receive after a publication.
//
// A completed transfer is not proof that visitors see it: page caches, a hosting CDN, the object
// cache and browsers can keep serving the previous publication (Apex, 2026-10-16: an anonymous
// homepage HIT from the CDN showed theme 1.5.11 after 1.5.22 was published, while a cache-busting
// query URL showed the new content). This action compares the publication identity Zoer Connect
// (0.6.0+) expects — GET /publication through the keyed endpoint — with the identity found in
// public responses fetched without the key, cookies or query (`network.fetch` scope
// `endpoint-public`), for the home page and recently changed pages, desktop and mobile, plus
// selected changed CSS/JS against the pushed file set. HTTP 200 alone is never success.
//
// The result is one catalog record per destination (`publication-check:<siteId>`), never older
// than the publication it describes: a check of an earlier import never overwrites a newer one.
// Stale results after a cache purge are rechecked with a bounded, resumable backoff. Nothing is
// republished, replaced or rolled back.
import { readRecords } from "./catalog.js";
import { listEntries } from "./filesets.js";
import { connectClient, ZOER_CONNECT_PREFIX } from "./zoer-connect.js";
import { fail, TransferError } from "./slices.js";

const HEX32 = /^[a-f0-9]{32}$/;
export const VARIANTS = {
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 ZoerPublicationCheck/1",
  mobile: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 ZoerPublicationCheck/1",
};
/** Public pages and assets one check reads (each with up to 3 same-host redirects). */
export const LIMITS = { pages: 9, assets: 8, redirects: 3, requestsPerSlice: 40, history: 6 };
/** Waits before each recheck after a purge (bounded: about 16 minutes in total). */
export const RECHECK_WAITS_MS = [30_000, 60_000, 120_000, 240_000, 480_000];
const CACHE_HEADERS = ["cache-control", "age", "expires", "vary", "last-modified", "etag", "x-hcdn-cache-status", "x-cache", "x-cache-status", "cf-cache-status", "x-litespeed-cache", "x-proxy-cache", "x-zoer-publication", "content-type", "retry-after", "server"];
const STALE = new Set(["stale", "stale-content", "no-marker", "stale-asset"]);
const FAILED = new Set(["redirect-offsite", "challenge", "maintenance", "http-error", "not-html", "error-page", "timeout", "unreachable"]);

export const recordId = (siteId) => `publication-check:${siteId}`;

function endpointOf(request, siteId) {
  const endpoint = (request.grants?.network?.endpoints ?? []).flatMap((entry) => entry.alias === "site" ? entry.endpoints : []).find((entry) => entry.id === siteId);
  if (!endpoint) fail("This site's connection was removed. Add the site again in WordPress Manager.");
  return endpoint;
}

const header = (headers, name) => {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  const value = Array.isArray(entry?.[1]) ? entry[1].join(", ") : entry?.[1];
  return typeof value === "string" ? value : undefined;
};
function cacheHeaders(headers) {
  const out = {};
  for (const name of CACHE_HEADERS) { const value = header(headers, name); if (value !== undefined) out[name] = value.replace(/[\r\n]/g, " ").slice(0, 200); }
  return out;
}

/** The `content` of `<meta name="...">` (attribute order independent), or null. */
export function metaContent(html, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`\\bname\\s*=\\s*["']?${name}["'\\s/>]`, "i").test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (content) return (content[1] ?? content[2] ?? content[3] ?? "").trim();
  }
  return null;
}

/** Stylesheets and scripts under wp-content/themes|plugins on this host. */
export function assetUrls(html, pageUrl, homePath) {
  const base = new URL(pageUrl);
  const out = [];
  const refs = [...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet[^>]*>/gi)].map((m) => m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1])
    .concat([...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]));
  for (const ref of refs) {
    if (!ref) continue;
    let url;
    try { url = new URL(ref.replace(/&amp;/g, "&"), base); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname !== base.hostname) continue;
    const prefix = `${homePath.replace(/\/+$/, "")}/wp-content/`;
    if (!url.pathname.startsWith(prefix)) continue;
    const path = `wp-content/${decodeURIComponent(url.pathname.slice(prefix.length))}`;
    if (!/^wp-content\/(?:themes|plugins)\/[^?#]+\.(?:css|js)$/i.test(path) || out.some((asset) => asset.path === path)) continue;
    url.hash = "";
    out.push({ url: url.href, path });
  }
  return out;
}

const CHALLENGE = /cf-chl|challenge-platform|just a moment\.\.\.|sgcaptcha|captcha-delivery|attention required!|checking your browser/i;
const ERROR_PAGE = /there has been a critical error on this website|error establishing a database connection|briefly unavailable for scheduled maintenance/i;

/**
 * Classifies one public page response against the expected publication and revision.
 * `fetched` is { status, headers, body (string), finalUrl, offsite?, error? }.
 */
export function classifyPage(fetched, expected) {
  if (fetched.error) return { status: fetched.error === "timeout" ? "timeout" : "unreachable", detail: fetched.detail };
  if (fetched.offsite) return { status: "redirect-offsite", detail: `Redirects to ${fetched.offsite}.` };
  const type = header(fetched.headers, "content-type") ?? "";
  const body = fetched.body ?? "";
  if (fetched.status === 503 && (header(fetched.headers, "retry-after") || /maintenance/i.test(body))) return { status: "maintenance", detail: "The site answered with a maintenance page." };
  if ((fetched.status === 403 || fetched.status === 429 || fetched.status === 503) && CHALLENGE.test(body.slice(0, 20_000)) || header(fetched.headers, "cf-mitigated")) return { status: "challenge", detail: "A bot or security challenge answered instead of the page." };
  if (fetched.status < 200 || fetched.status >= 300) return { status: "http-error", detail: `HTTP ${fetched.status}.` };
  if (!/html/i.test(type)) return { status: "not-html", detail: `Answered with ${type || "no content type"}.` };
  if (ERROR_PAGE.test(body.slice(0, 200_000))) return { status: "error-page", detail: "HTTP 200, but the page is a WordPress error or maintenance page." };
  const observed = metaContent(body, "zoer-publication") ?? header(fetched.headers, "x-zoer-publication") ?? null;
  const observedPublication = observed && HEX32.test(observed) ? observed : null;
  if (!observedPublication) return { status: "no-marker", detail: "No publication marker: the page may be a copy cached before this publication, or not rendered by WordPress." };
  if (observedPublication !== expected.publicationId) return { status: "stale", observedPublication, detail: "Serves an earlier publication." };
  const revision = metaContent(body, "zoer-revision");
  if (expected.revision && revision && revision !== expected.revision) return { status: "stale-content", observedPublication, detail: "Current publication, but this page's content is older (object or fragment cache)." };
  return { status: "current", observedPublication };
}

/** Browser cache advisory for HTML: how long a visitor's browser may reuse it without asking. */
export function browserCacheAdvisory(headers) {
  const value = (header(headers, "cache-control") ?? "").toLowerCase();
  if (!value || /\b(no-store|no-cache|private)\b/.test(value)) return null;
  const maxAge = Number(value.match(/(?:^|[,\s])max-age\s*=\s*(\d+)/)?.[1]);
  if (!Number.isFinite(maxAge) || maxAge < 3600) return null;
  return { maxAgeSeconds: maxAge, cacheControl: value.slice(0, 200) };
}

/** Overall status from per-request results. */
export function overallStatus(results) {
  if (!results.length) return "failed";
  if (results.some((result) => STALE.has(result.status))) return "stale";
  if (results.some((result) => FAILED.has(result.status))) return "failed";
  return results.every((result) => result.status === "current" || result.status === "asset-current") ? "current" : "failed";
}

async function publicFetch(host, endpoint, url, variant, counter) {
  const hops = [];
  let target = url;
  for (let hop = 0; hop <= LIMITS.redirects; hop++) {
    counter.requests++;
    let result;
    try {
      result = await host.call("network.fetch", { url: target, method: "GET", headers: { "user-agent": VARIANTS[variant], accept: "text/html,application/xhtml+xml,text/css,application/javascript,*/*;q=0.8" }, auth: { type: "endpoint-public", endpointId: endpoint.id, generation: endpoint.generation } });
    } catch (error) {
      if (error?.code === "endpoint_route_denied" && /own HTTPS host|keyed API/.test(String(error.message))) return { offsite: new URL(target).host, hops };
      if (["endpoint_changed", "endpoint_unbound", "ZOER_PAUSED", "capability_denied"].includes(error?.code)) throw error;
      if (/limit/i.test(String(error?.message))) return { error: "unreachable", detail: "The response was larger than the check reads.", hops };
      return { error: /time/i.test(String(error?.message)) ? "timeout" : "unreachable", detail: String(error?.message ?? "Request failed").slice(0, 200), hops };
    }
    const location = header(result.headers, "location");
    if (result.status >= 300 && result.status < 400 && location) {
      const next = new URL(location, target);
      hops.push({ status: result.status, to: next.href.slice(0, 300) });
      if (next.hostname !== new URL(url).hostname || next.protocol !== "https:") return { offsite: next.host, hops };
      target = next.href;
      continue;
    }
    return { status: result.status, headers: result.headers ?? {}, bodyBase64: result.bodyBase64 ?? "", finalUrl: target, hops };
  }
  return { error: "unreachable", detail: "Too many redirects.", hops };
}

async function sha256Hex(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function plan(state) {
  const home = new URL(state.expected.home);
  const items = [];
  for (const page of state.expected.pages.slice(0, LIMITS.pages)) {
    const url = new URL(page.path.replace(/^\//, ""), home).href;
    for (const variant of Object.keys(VARIANTS)) items.push({ kind: "page", url, path: page.path, variant, revision: page.revision ?? null });
  }
  return items;
}

/** Writes the result unless a newer publication or a newer check of this one is already recorded. */
export async function saveResult(host, record) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await host.call("catalog.read", { ids: [record.id] });
    const existing = read?.records?.[0]?.data;
    if (existing) {
      const ours = Number(record.data.committedAt ?? 0), theirs = Number(existing.committedAt ?? 0);
      if (theirs > ours) return { saved: false, reason: "newer-publication" };
      if (theirs === ours && existing.importId === record.data.importId && String(existing.startedAt ?? "") > String(record.data.startedAt ?? "")) return { saved: false, reason: "newer-check" };
      record.data.history = [{ checkId: existing.checkId, importId: existing.importId, status: existing.status, checkedAt: existing.checkedAt }, ...(existing.history ?? [])]
        .filter((entry) => entry.checkId && entry.checkId !== record.data.checkId).slice(0, LIMITS.history);
    }
    const result = await host.call("catalog.commit", { revision: read.revision, records: [record] });
    if (!result?.conflict) return { saved: true };
  }
  throw new TransferError("The WordPress Manager catalog kept changing. Retrying shortly.", { transient: true });
}

function summaryOf(state) {
  const results = state.results;
  const status = state.status;
  const pages = new Set(results.filter((r) => r.kind === "page").map((r) => r.path)).size;
  const assets = results.filter((r) => r.kind === "asset").length;
  return status === "current" ? `Current on ${pages} checked page${pages === 1 ? "" : "s"}${assets ? ` and ${assets} asset${assets === 1 ? "" : "s"}` : ""}.`
    : status === "stale" ? "Old content detected on the public site."
      : status === "not-verifiable" ? state.detail
        : "The public check could not complete.";
}

function recordOf(state, now) {
  return {
    id: recordId(state.siteId), kind: "publication-check", title: summaryOf(state).slice(0, 200),
    data: {
      v: 1, siteId: state.siteId, importId: state.importId ?? null, publicationId: state.expected?.publicationId ?? null, committedAt: state.expected?.committedAt ?? 0,
      checkId: state.checkId, reason: state.reason, purgeId: state.purgeId ?? null, status: state.status, detail: state.detail ?? null, summary: summaryOf(state),
      attempt: state.attempt, rechecking: state.rechecking === true, startedAt: state.startedAt, checkedAt: new Date(now()).toISOString(),
      coverage: { pages: [...new Set(state.results.filter((r) => r.kind === "page").map((r) => r.path))], variants: Object.keys(VARIANTS), assets: state.results.filter((r) => r.kind === "asset").length },
      results: state.results, advisory: state.advisory ?? null, wordpressCache: state.wordpressCache ?? null,
    },
  };
}

export const verifySpec = {
  async start(input, { request, now }) {
    if (!HEX32.test(input.checkId ?? "")) fail("A valid check ID is required.");
    if (input.importId !== undefined && !HEX32.test(input.importId)) fail("A valid import ID is required.");
    endpointOf(request, input.siteId);
    return { v: 1, siteId: input.siteId, importId: input.importId ?? null, setId: input.setId ?? null, checkId: input.checkId, reason: input.reason ?? "recheck", purgeId: input.purgeId ?? null,
      attempt: 1, phase: "expect", startedAt: new Date(now()).toISOString(), queue: [], results: [] };
  },

  async step(state, _input, ctx) {
    const { host, request, now } = ctx;
    const endpoint = endpointOf(request, state.siteId);
    const counter = { requests: 0 };
    const finishWith = async (status, detail) => {
      state.status = status; state.detail = detail ?? null;
      const saved = state.superseded ? { saved: false, reason: "newer-publication" } : await saveResult(host, recordOf(state, now));
      return ctx.done({ siteId: state.siteId, importId: state.importId, checkId: state.checkId, status, summary: summaryOf(state), saved: saved.saved, ...(saved.reason ? { skipped: saved.reason } : {}) }, { phase: "done" });
    };

    if (state.phase === "expect") {
      const client = connectClient(host, endpoint, endpoint.generation, counter);
      const status = await client.request("/status");
      const version = typeof status?.version === "string" ? status.version.slice(0, 20) : "an older version";
      if (status?.capabilities?.publicationIdentity !== true) return finishWith("not-verifiable", `Zoer Connect ${version} does not report a publication identity. Update Zoer Connect on this site to 0.6.0 or later.`);
      const expected = await client.request("/publication");
      const publication = expected?.publication;
      if (!publication || !HEX32.test(publication.id ?? "")) return finishWith("not-verifiable", "No publication is recorded on this site yet. Publish to it again with Zoer Connect 0.6.0 or later.");
      let home;
      try { home = new URL(expected.home); } catch { home = null; }
      if (!home || home.protocol !== "https:" || home.hostname.toLowerCase() !== new URL(endpoint.origin).hostname.toLowerCase()) return finishWith("not-verifiable", "The site's home address is not on this connection's HTTPS host.");
      state.expected = {
        publicationId: publication.id, importId: HEX32.test(publication.importId ?? "") ? publication.importId : null, committedAt: Number(publication.committedAt) || 0, kind: String(publication.kind ?? "import").slice(0, 20), home: home.href,
        pages: (Array.isArray(expected.pages) ? expected.pages : []).filter((page) => typeof page?.path === "string" && page.path.startsWith("/") && page.path.length <= 512 && !page.path.includes("?"))
          .map((page) => ({ path: page.path, revision: typeof page.revision === "string" && /^[a-f0-9]{16}$/.test(page.revision) ? page.revision : null })),
      };
      if (!state.expected.pages.some((page) => page.path === "/")) state.expected.pages.unshift({ path: "/", revision: null });
      state.wordpressCache = expected.wordpressCache && typeof expected.wordpressCache === "object" ? { state: String(expected.wordpressCache.state ?? "").slice(0, 20), ranAt: expected.wordpressCache.ranAt ?? null, layers: (expected.wordpressCache.layers ?? []).slice(0, 16).map((l) => ({ key: String(l.key).slice(0, 40), label: String(l.label).slice(0, 60), status: String(l.status).slice(0, 20) })) } : null;
      // Checking an earlier import after a newer publication would describe the wrong website.
      if (state.importId && state.expected.importId && state.expected.importId !== state.importId) { state.superseded = true; return finishWith("superseded", "A newer publication replaced this one."); }
      state.importId = state.importId ?? state.expected.importId;
      state.queue = plan(state);
      state.phase = "check";
      return ctx.continue(state, { phase: "checking public pages", done: 0, total: state.queue.length, unit: "requests" });
    }

    if (state.phase === "check") {
      while (state.queue.length && counter.requests < LIMITS.requestsPerSlice && ctx.timeLeft() > 20_000) {
        const item = state.queue.shift();
        const fetched = await publicFetch(host, endpoint, item.url, item.variant, counter);
        const body = fetched.bodyBase64 ? Buffer.from(fetched.bodyBase64, "base64") : Buffer.alloc(0);
        if (item.kind === "asset") {
          const result = { kind: "asset", url: item.url, path: item.path, variant: item.variant, httpStatus: fetched.status ?? null, headers: cacheHeaders(fetched.headers) };
          if (fetched.error || fetched.offsite || fetched.status !== 200) Object.assign(result, { status: fetched.offsite ? "redirect-offsite" : fetched.error ?? "http-error", detail: fetched.detail ?? `HTTP ${fetched.status}.` });
          else Object.assign(result, (await sha256Hex(body)) === item.sha256 ? { status: "asset-current" } : { status: "stale-asset", detail: "Differs from the published file (an old cached copy, or the host rewrote it)." });
          state.results.push(result);
          continue;
        }
        const html = body.toString("utf8");
        const verdict = classifyPage({ ...fetched, body: html }, { publicationId: state.expected.publicationId, revision: item.revision });
        const result = { kind: "page", url: item.url, path: item.path, variant: item.variant, httpStatus: fetched.status ?? null, ...verdict, headers: cacheHeaders(fetched.headers), ...(fetched.hops?.length ? { redirects: fetched.hops } : {}) };
        if (item.diagnostic) { // A fresh-response diagnostic never counts as success.
          const original = state.results.find((r) => r.kind === "page" && r.url === item.original && r.variant === item.variant);
          if (original) original.freshResponse = verdict.status === "current" ? "current" : verdict.status;
          continue;
        }
        state.results.push(result);
        if (item.path === "/" && item.variant === "desktop" && verdict.status !== "unreachable") {
          state.advisory = browserCacheAdvisory(fetched.headers);
          if (state.setId && verdict.status === "current") {
            const wanted = assetUrls(html, fetched.finalUrl ?? item.url, new URL(state.expected.home).pathname).slice(0, LIMITS.assets * 3);
            const entries = new Map((await listEntries(host, state.setId)).map((entry) => [entry.path, entry.sha256]));
            for (const asset of wanted.filter((a) => entries.has(a.path)).slice(0, LIMITS.assets)) state.queue.push({ kind: "asset", url: asset.url, path: asset.path, variant: "desktop", sha256: entries.get(asset.path) });
          }
        }
        if (STALE.has(verdict.status) && item.variant === "desktop" && !state.queue.some((q) => q.diagnostic && q.original === item.url)) {
          const fresh = new URL(item.url); fresh.searchParams.set("zoer-check", state.checkId.slice(0, 12));
          state.queue.push({ kind: "page", url: fresh.href, path: item.path, variant: "desktop", revision: item.revision, diagnostic: true, original: item.url });
        }
      }
      if (state.queue.length) return ctx.continue(state, { phase: "checking public pages", done: state.results.length, total: state.results.length + state.queue.length, unit: "requests" });
      const status = overallStatus(state.results);
      // After a purge, stale content is expected to clear: recheck with a bounded backoff.
      if (status === "stale" && state.reason === "after-purge" && state.attempt <= RECHECK_WAITS_MS.length) {
        state.status = "stale"; state.rechecking = true;
        await saveResult(host, recordOf(state, now));
        const wait = RECHECK_WAITS_MS[state.attempt - 1];
        state.attempt++; state.results = []; state.queue = []; state.phase = "expect"; state.advisory = null;
        return ctx.continue(state, { phase: "waiting for caches to clear", message: `Rechecking in ${Math.round(wait / 1000)} s (attempt ${state.attempt} of ${RECHECK_WAITS_MS.length + 1})` }, wait);
      }
      state.rechecking = false;
      return finishWith(status);
    }
    fail("Unknown check phase.");
  },
  definiteFailures: true,
  failureOutput: (state, input) => ({ siteId: state?.siteId ?? input.siteId, checkId: state?.checkId ?? input.checkId, status: "failed" }),
};

/** Per-layer receipt entries as Zoer Connect reports them (bounded, display-safe). */
export function receiptLayers(receipt) {
  return (Array.isArray(receipt?.layers) ? receipt.layers : []).slice(0, 16).map((layer) => ({ key: String(layer?.key ?? "").slice(0, 40), label: String(layer?.label ?? "").slice(0, 60), status: String(layer?.status ?? "").slice(0, 20) }));
}

/**
 * `publication.purge`: Zoer Connect's POST /cache/purge (WordPress cache plugins and the object
 * cache). Returns the receipt; a plugin hook's "requested" is not proof of eviction, which only the
 * public check can show. Hosting/CDN caches are separate provider operations.
 */
export const purgeSpec = {
  async start(input, { request }) {
    if (!HEX32.test(input.purgeId ?? "")) fail("A valid purge ID is required.");
    endpointOf(request, input.siteId);
    return { v: 1, siteId: input.siteId, purgeId: input.purgeId };
  },
  async step(state, _input, ctx) {
    const endpoint = endpointOf(ctx.request, state.siteId);
    const client = connectClient(ctx.host, endpoint, endpoint.generation, { requests: 0 });
    const status = await client.request("/status");
    if (status?.capabilities?.cacheReceipts !== true) {
      return ctx.done({ siteId: state.siteId, purgeId: state.purgeId, layer: "wordpress", state: "unsupported", summary: "Update Zoer Connect on this site to 0.6.0 or later to clear WordPress caches from Zoer.", layers: [] }, { phase: "done" });
    }
    const result = await client.request("/cache/purge", "POST", {});
    const layers = receiptLayers(result?.receipt);
    const failed = layers.filter((layer) => layer.status === "failed").length;
    return ctx.done({ siteId: state.siteId, purgeId: state.purgeId, layer: "wordpress", state: failed ? "partial" : "requested", ranAt: Number(result?.receipt?.ranAt) || null, layers,
      summary: failed ? `WordPress cache purge requested; ${failed} layer${failed === 1 ? "" : "s"} failed.` : "WordPress cache purge requested." }, { phase: "done" });
  },
  definiteFailures: true,
  failureOutput: (state, input) => ({ siteId: state?.siteId ?? input.siteId, purgeId: state?.purgeId ?? input.purgeId, layer: "wordpress", state: "failed" }),
};

export { ZOER_CONNECT_PREFIX };
