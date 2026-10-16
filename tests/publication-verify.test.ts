import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FakeWorld } from "./fakes/host";
import { sampleSite } from "./fakes/zoer-connect";
import { assetUrls, browserCacheAdvisory, classifyPage, metaContent, overallStatus, RECHECK_WAITS_MS, recordId } from "../plugin/worker/lib/verify.js";

// Deterministic stale-cache fixture: an origin that renders the current publication and a CDN in
// front of it that keeps serving whatever it cached, keyed by exact URL and (optionally) device.
// The Apex failure of 2026-10-16: the plain homepage was a CDN HIT with the old publication while
// a cache-busting query URL reached the origin and looked correct.

const SITE = "ep_apex";
const ORIGIN = "https://bisque-ant.example";
const CHECK = "1".repeat(32), CHECK2 = "2".repeat(32), IMPORT = "a".repeat(32), OLD_IMPORT = "b".repeat(32), PURGE = "3".repeat(32);
const PUB_OLD = "0".repeat(31) + "1", PUB_NEW = "0".repeat(31) + "2";
const REV = { home: "aaaaaaaaaaaaaaaa", services: "bbbbbbbbbbbbbbbb", servicesOld: "cccccccccccccccc" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type Page = { status?: number; body: string; headers?: Record<string, string> };
const html = (publication: string | null, revision?: string, extra = "") =>
  `<!doctype html><html><head>${publication ? `<meta name="zoer-publication" content="${publication}">` : ""}${revision ? `<meta content="${revision}" name="zoer-revision">` : ""}<link rel="stylesheet" href="/wp-content/themes/apex/style.css?ver=1.5.22"><script src="${ORIGIN}/wp-content/plugins/apex-interactions/view.js?ver=1.5.0"></script></head><body>${extra}</body></html>`;

class PublicSite {
  /** What WordPress renders now (the origin). */
  origin = new Map<string, Page>();
  /** What the CDN keeps returning for an exact URL (and device), until purged. */
  cdn = new Map<string, Page>();
  varyByDevice = false;
  log: Array<{ url: string; ua: string; cookie?: string; auth?: unknown }> = [];
  fail: Record<string, "timeout" | "offsite" | "challenge" | "maintenance"> = {};
  key(url: string, ua: string) { return this.varyByDevice ? `${/iPhone/.test(ua) ? "m" : "d"}:${url}` : url; }
  serve(url: string, ua: string, headers: Record<string, string>) {
    this.log.push({ url, ua, cookie: headers.cookie });
    const path = new URL(url).pathname;
    const mode = this.fail[path];
    if (mode === "timeout") throw Object.assign(new Error("Network request timed out."), { code: "ETIMEDOUT" });
    if (mode === "offsite") return { status: 301, headers: { location: "https://login.example/challenge" }, body: "" };
    if (mode === "challenge") return { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" }, body: "<title>Just a moment...</title>" };
    if (mode === "maintenance") return { status: 503, headers: { "content-type": "text/html", "retry-after": "60" }, body: "Briefly unavailable for scheduled maintenance." };
    const cached = this.cdn.get(this.key(url, ua));
    if (cached) return { status: cached.status ?? 200, headers: { "content-type": "text/html; charset=UTF-8", "x-hcdn-cache-status": "HIT", "cache-control": "public, max-age=604800", ...cached.headers }, body: cached.body };
    const page = this.origin.get(new URL(url).pathname) ?? { status: 404, body: "not found" };
    return { status: page.status ?? 200, headers: { "content-type": "text/html; charset=UTF-8", "x-hcdn-cache-status": "DYNAMIC", "cache-control": "public, max-age=604800", ...page.headers }, body: page.body };
  }
}

function world(options: { connectVersion?: string; publication?: Record<string, unknown> | null; capabilities?: Record<string, boolean> } = {}) {
  const w = new FakeWorld();
  w.addSite(SITE, sampleSite(ORIGIN));
  const pub = new PublicSite();
  pub.origin.set("/", { body: html(PUB_NEW, REV.home) });
  pub.origin.set("/services/", { body: html(PUB_NEW, REV.services) });
  pub.origin.set("/wp-content/themes/apex/style.css", { body: "body{--v:1522}", headers: { "content-type": "text/css" } });
  pub.origin.set("/wp-content/plugins/apex-interactions/view.js", { body: "/*1.5.0*/", headers: { "content-type": "application/javascript" } });
  const state = {
    publication: options.publication === undefined ? { id: PUB_NEW, importId: IMPORT, kind: "import", committedAt: 2000 } : options.publication,
    purges: 0,
  };
  w.services["network.fetch"] = async (input: any) => {
    const url = String(input.url);
    if (input.auth?.type === "endpoint-public") {
      // The host's rules for the public scope: own host, GET, never the keyed API, no credentials.
      if (new URL(url).hostname !== new URL(ORIGIN).hostname) throw Object.assign(new Error("Public probes may only read the endpoint's own HTTPS host."), { code: "endpoint_route_denied" });
      if (new URL(url).pathname.startsWith("/wp-json/zoer-connect/")) throw Object.assign(new Error("Public probes may not request the endpoint's keyed API."), { code: "endpoint_route_denied" });
      if (input.headers?.cookie || input.headers?.authorization) throw new Error("credentials sent to a public probe");
      const response = pub.serve(url, input.headers?.["user-agent"] ?? "", input.headers ?? {});
      return { status: response.status, headers: response.headers, bodyBase64: Buffer.from(response.body).toString("base64") };
    }
    const route = url.slice(`${ORIGIN}/wp-json/zoer-connect/v1`.length);
    const json = (status: number, body: unknown) => ({ status, headers: { "content-type": "application/json" }, bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64") });
    if (route === "/status") return json(200, { target: ORIGIN, version: options.connectVersion ?? "0.6.0", capabilities: { connectionKey: true, ...(options.connectVersion ? {} : { publicationIdentity: true, cacheReceipts: true }), ...options.capabilities } });
    if (route === "/publication") return json(200, { v: 1, home: `${ORIGIN}/`, publication: state.publication, pages: [{ path: "/", kind: "front-page", revision: REV.home }, { path: "/services/", kind: "page", revision: REV.services }], wordpressCache: { state: "ran", ranAt: 1, layers: [{ key: "litespeed", label: "LiteSpeed Cache", status: "requested" }] } });
    if (route === "/cache/purge" && input.method === "POST") { state.purges++; return json(200, { receipt: { state: "ran", ranAt: 2, layers: [{ key: "litespeed", label: "LiteSpeed Cache", status: "requested" }, { key: "object-cache", label: "Object cache", status: "flushed" }] } }); }
    return json(404, {});
  };
  return { w, pub, state };
}

const run = (w: FakeWorld, input: Record<string, unknown> = {}, options: Parameters<FakeWorld["run"]>[2] = {}) => w.run("publication.verify", { siteId: SITE, checkId: CHECK, importId: IMPORT, reason: "finish", ...input }, options);
const record = (w: FakeWorld) => w.catalog.records.get(recordId(SITE))?.data;

describe("publication.verify against a deterministic stale-cache fixture", () => {
  test("current publication on every checked page, desktop and mobile: green with coverage", async () => {
    const { w, pub } = world();
    const result = await run(w);
    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({ status: "current", saved: true });
    const data = record(w);
    expect(data).toMatchObject({ status: "current", importId: IMPORT, publicationId: PUB_NEW, coverage: { pages: ["/", "/services/"], variants: ["desktop", "mobile"] } });
    expect(data.results.filter((r: any) => r.kind === "page")).toHaveLength(4);
    // The exact canonical URLs: no query, no cookies.
    expect(pub.log.every(entry => !new URL(entry.url).search && !entry.cookie)).toBe(true);
  });

  test("old normal URL but current query URL: old content detected, the fresh response is only a diagnostic", async () => {
    const { w, pub } = world();
    pub.cdn.set(`${ORIGIN}/`, { body: html(PUB_OLD, REV.home, "Years in business") });
    const result = await run(w);
    expect(result.output).toMatchObject({ status: "stale" });
    const home = record(w).results.find((r: any) => r.path === "/" && r.variant === "desktop");
    expect(home).toMatchObject({ status: "stale", observedPublication: PUB_OLD, freshResponse: "current", headers: { "x-hcdn-cache-status": "HIT" } });
    expect(pub.log.some(entry => new URL(entry.url).searchParams.has("zoer-check"))).toBe(true);
  });

  test("old page content with the new theme (stale object/fragment cache): detected by the page revision", async () => {
    const { w, pub } = world();
    pub.origin.set("/services/", { body: html(PUB_NEW, REV.servicesOld) });
    expect((await run(w)).output).toMatchObject({ status: "stale" });
    expect(record(w).results.find((r: any) => r.path === "/services/").status).toBe("stale-content");
  });

  test("stale asset with an unchanged version number: compared by content against the pushed file", async () => {
    const { w, pub } = world();
    const setId = `fs_${"4".repeat(32)}`;
    w.sets.create({ setId, labels: {}, rules: "site-export", entries: [] } as any);
    const set = (w.sets as any).get(setId);
    set.entries = [{ path: "wp-content/themes/apex/style.css", bytes: 14, sha256: sha("body{--v:1522}") }, { path: "wp-content/plugins/apex-interactions/view.js", bytes: 9, sha256: sha("/*1.5.0*/") }];
    set.status = "sealed";
    pub.cdn.set(`${ORIGIN}/wp-content/themes/apex/style.css?ver=1.5.22`, { body: "body{--v:1511}", headers: { "content-type": "text/css" } });
    const result = await run(w, { setId });
    expect(result.output).toMatchObject({ status: "stale" });
    const assets = record(w).results.filter((r: any) => r.kind === "asset");
    expect(assets.map((a: any) => [a.path, a.status])).toEqual([["wp-content/themes/apex/style.css", "stale-asset"], ["wp-content/plugins/apex-interactions/view.js", "asset-current"]]);
  });

  test("different desktop/mobile cached variants: only the stale variant is flagged", async () => {
    const { w, pub } = world();
    pub.varyByDevice = true;
    pub.cdn.set(`m:${ORIGIN}/`, { body: html(PUB_OLD) });
    expect((await run(w)).output).toMatchObject({ status: "stale" });
    const home = record(w).results.filter((r: any) => r.path === "/");
    expect(home.map((r: any) => [r.variant, r.status])).toEqual([["desktop", "current"], ["mobile", "stale"]]);
  });

  test("HTTP 200 error pages, challenges, maintenance, timeouts and off-site redirects are check failures, not success", async () => {
    for (const [mode, expected] of [["error", "error-page"], ["challenge", "challenge"], ["maintenance", "maintenance"], ["timeout", "timeout"], ["offsite", "redirect-offsite"]] as const) {
      const { w, pub } = world();
      if (mode === "error") pub.origin.set("/services/", { body: "<html><body>There has been a critical error on this website.</body></html>" });
      else pub.fail["/services/"] = mode;
      const result = await run(w);
      expect(result.output).toMatchObject({ status: "failed" });
      expect(record(w).results.find((r: any) => r.path === "/services/").status).toBe(expected);
    }
  });

  test("a legacy connector without publication identity is not verifiable, never green", async () => {
    const { w, pub } = world({ connectVersion: "0.5.3" });
    const result = await run(w);
    expect(result.output).toMatchObject({ status: "not-verifiable" });
    expect(record(w).detail).toContain("0.6.0");
    expect(pub.log).toHaveLength(0);
  });

  test("purge accepted while content stays stale: rechecks with bounded backoff, then reports old content", async () => {
    const { w, pub } = world();
    pub.cdn.set(`${ORIGIN}/`, { body: html(PUB_OLD) });
    const waits: number[] = [];
    const result = await run(w, { reason: "after-purge", purgeId: PURGE }, { onSlice: (envelope: any) => { if (envelope.waitMs) waits.push(envelope.waitMs); } });
    expect(result.output).toMatchObject({ status: "stale" });
    expect(waits).toEqual(RECHECK_WAITS_MS);
    expect(record(w)).toMatchObject({ status: "stale", purgeId: PURGE, rechecking: false, attempt: RECHECK_WAITS_MS.length + 1 });
  });

  test("purge then the CDN clears: green on a later attempt", async () => {
    const { w, pub } = world();
    pub.cdn.set(`${ORIGIN}/`, { body: html(PUB_OLD) });
    let rechecks = 0;
    const result = await run(w, { reason: "after-purge", purgeId: PURGE }, { onSlice: (envelope: any) => {
      if (envelope.waitMs && ++rechecks === 2) pub.cdn.clear();
      // While waiting, the saved record says the purge is still pending, never green.
      if (envelope.waitMs) expect(record(w)).toMatchObject({ status: "stale", rechecking: true });
    } });
    expect(result.output).toMatchObject({ status: "current" });
    expect(record(w)).toMatchObject({ status: "current", attempt: 3, rechecking: false });
  });

  test("an older check never overwrites the result of a newer publication", async () => {
    const { w, state } = world();
    expect((await run(w)).output).toMatchObject({ status: "current" });
    // The site has since been published again; a late check of the earlier import is superseded.
    const older = await run(w, { checkId: CHECK2, importId: OLD_IMPORT });
    expect(older.output).toMatchObject({ status: "superseded", saved: false });
    expect(record(w)).toMatchObject({ checkId: CHECK, importId: IMPORT });
    // A record of a newer publication is kept even when an earlier publication's check finishes later.
    w.catalog.records.set(recordId(SITE), { id: recordId(SITE), kind: "publication-check", title: "", data: { ...record(w), committedAt: 9999, importId: "c".repeat(32), checkId: "9".repeat(32), startedAt: "2099-01-01T00:00:00.000Z" } });
    state.publication = { id: PUB_NEW, importId: IMPORT, kind: "import", committedAt: 2000 };
    expect((await run(w, { checkId: CHECK2 })).output).toMatchObject({ saved: false, skipped: "newer-publication" });
  });

  test("resumes from its checkpoint after a restart mid-check", async () => {
    const { w } = world();
    let checkpoint: any = null;
    const first = await run(w, {}, { maxSlices: 1, onSlice: (envelope: any) => { checkpoint = envelope.checkpoint; } });
    expect(first.status).toBe("running"); // stopped after one slice, as if the worker restarted
    expect(checkpoint).toMatchObject({ phase: "check" });
    const resumed = await run(w, {}, { checkpoint, step: 2 });
    expect(resumed.output).toMatchObject({ status: "current" });
  });

  test("publication.purge returns the WordPress layer receipt without claiming eviction", async () => {
    const { w, state } = world();
    const result = await w.run("publication.purge", { siteId: SITE, purgeId: PURGE }, { effect: "external_write" });
    expect(result.output).toMatchObject({ layer: "wordpress", state: "requested", layers: [{ key: "litespeed", status: "requested" }, { key: "object-cache", status: "flushed" }] });
    expect(state.purges).toBe(1);
    const legacy = world({ connectVersion: "0.5.3" });
    expect((await legacy.w.run("publication.purge", { siteId: SITE, purgeId: PURGE }, { effect: "external_write" })).output).toMatchObject({ state: "unsupported" });
  });
});

describe("verification helpers", () => {
  test("meta parsing is attribute-order independent", () => {
    expect(metaContent('<meta content="abc" name="zoer-revision">', "zoer-revision")).toBe("abc");
    expect(metaContent("<meta name=zoer-publication content=xyz>", "zoer-publication")).toBe("xyz");
    expect(metaContent('<meta name="zoer-publication-x" content="no">', "zoer-publication")).toBeNull();
  });
  test("assets: same host, under the home path, themes/plugins CSS/JS only", () => {
    const page = '<link rel="stylesheet" href="/blog/wp-content/themes/t/a.css?ver=2"><script src="https://cdn.other/x.js"></script><script src="/blog/wp-content/uploads/u.js"></script><link rel="icon" href="/blog/wp-content/themes/t/i.png">';
    expect(assetUrls(page, "https://site.example/blog/", "/blog/")).toEqual([{ url: "https://site.example/blog/wp-content/themes/t/a.css?ver=2", path: "wp-content/themes/t/a.css" }]);
  });
  test("a cache HIT with the current publication is fine; HTTP 200 alone is not", () => {
    expect(classifyPage({ status: 200, headers: { "content-type": "text/html", "x-hcdn-cache-status": "HIT" }, body: html(PUB_NEW) }, { publicationId: PUB_NEW, revision: null }).status).toBe("current");
    expect(classifyPage({ status: 200, headers: { "content-type": "text/html" }, body: "<html>hello</html>" }, { publicationId: PUB_NEW, revision: null }).status).toBe("no-marker");
    expect(overallStatus([{ status: "current" }, { status: "no-marker" }])).toBe("stale");
    expect(overallStatus([])).toBe("failed");
  });
  test("browser HTML cache advisory: seven-day public HTML is flagged, revalidating HTML is not", () => {
    expect(browserCacheAdvisory({ "cache-control": "public, max-age=604800" })).toMatchObject({ maxAgeSeconds: 604800 });
    expect(browserCacheAdvisory({ "cache-control": "public, max-age=0, s-maxage=604800, must-revalidate" })).toBeNull();
    expect(browserCacheAdvisory({ "cache-control": "no-cache" })).toBeNull();
  });
});
