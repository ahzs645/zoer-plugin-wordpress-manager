import { describe, expect, test } from "bun:test";
import type { WordPressManagedSite } from "../src/lib/api";
import type { HostEndpoint } from "../src/host/actions";
import type { PullRecord } from "../src/components/extensions/pluginEngine/records";
import { completedPushUrl, guidedPushSources, localPublishDestinations, publishedWebsiteUrl, pushReviewMessage } from "../src/components/extensions/publishGuidance";

const site = (id: string, provider: WordPressManagedSite["provider"], url = "https://live.example/", sourceSiteId: string | null = null) => ({ id, provider, url, sourceSiteId, name: "Same title" } as WordPressManagedSite);
const endpoint = (id: string, origin = "https://live.example/", alias = "site") => ({ id, origin, alias, label: id } as HostEndpoint);
describe("guided local publication", () => {
  test("destinations are explicit HTTPS Connect identities, with a genuine linked alias preferred", () => {
    const local = site("local", "ddev", "https://local.example/", "hosting");
    const hosting = site("hosting", "hostinger"), connect = site("connect", "zoer-connect");
    const other = site("other", "zoer-connect", "https://other.example/");
    expect(localPublishDestinations([endpoint("connect"), endpoint("other", "https://other.example/"), endpoint("unsafe", "javascript:alert(1)"), endpoint("non-site", "https://other.example/", "other")], [local, hosting, connect, other], local)).toEqual({ destinations: [{ id: "connect", name: "connect", url: "https://live.example/" }, { id: "other", name: "other", url: "https://other.example/" }], preferredId: "connect" });
  });
  test("titles, www aliases and ambiguous hosting connections do not choose a destination", () => {
    const local = site("local", "ddev", "https://local.example/", "hosting");
    const hosting = site("hosting", "hostinger"), connect = site("connect", "zoer-connect");
    expect(localPublishDestinations([endpoint("connect", "https://moved.example/")], [local, hosting, connect], local).preferredId).toBe("");
    expect(localPublishDestinations([endpoint("connect"), endpoint("second")], [local, hosting, connect, site("second", "zoer-connect")], local).preferredId).toBe("");
    expect(localPublishDestinations([endpoint("www", "https://www.live.example/")], [local, hosting, site("www", "zoer-connect", "https://www.live.example/")], local).preferredId).toBe("");
    expect(localPublishDestinations([endpoint("connect")], [site("unlinked", "ddev"), connect], site("unlinked", "ddev")).preferredId).toBe("");
  });
  test("saved endpoint survives absent provider inventory without inventing a new site or key", () => {
    const local = site("local", "ddev", "https://local.example/", "hostinger:saved:123");
    expect(localPublishDestinations([endpoint("hostinger:saved:123", "https://intramurals.example/")], [local], local)).toEqual({ destinations: [{ id: "hostinger:saved:123", name: "hostinger:saved:123", url: "https://intramurals.example/" }], preferredId: "hostinger:saved:123" });
  });
  test("known local endpoints are excluded by installation identity, not labels", () => {
    const source = site("source", "ddev", "https://source.example/");
    const other = site("other-local", "ddev", "https://other-local.example/");
    expect(localPublishDestinations([endpoint("other-local"), endpoint("alias", other.url!), endpoint("source", source.url!)], [source, other], source).destinations).toEqual([]);
  });
  test("guided catalog admits only selected local source exports, while standalone Push retains all sources", () => {
    const own = { siteId: "local", kind: "local-export" } as PullRecord;
    const other = { siteId: "other", kind: "local-export" } as PullRecord;
    const remote = { siteId: "local", kind: "pull" } as PullRecord;
    expect(guidedPushSources([own, other, remote], "local")).toEqual([own]);
    expect(guidedPushSources([own, other, remote])).toEqual([own, other, remote]);
    expect(guidedPushSources([other], "missing")).toEqual([]);
  });
  test("review and maintenance wording follows actual selected behaviour", () => {
    expect(pushReviewMessage(true, "activation")).toContain("waits for your approval before activation");
    expect(pushReviewMessage(false, "early")).toContain("pauses when the import starts");
    expect(pushReviewMessage(false, "activation")).toContain("pauses during activation");
  });
  test("website link is only offered for a completed real push and uses a safe known HTTPS identity", () => {
    const run = { kind: "push", status: "complete", dryRun: false, rolledBack: false, url: "https://live.example/subdir/" };
    expect(completedPushUrl(run)).toBe(run.url);
    for (const change of [{ status: "verification_required" }, { status: "dry-run" }, { dryRun: true }, { rolledBack: true }, { kind: "replace" }, { url: "javascript:alert(1)" }]) expect(completedPushUrl({ ...run, ...change })).toBeNull();
    for (const url of ["http://live.example/", "//live.example/", "https://user:key@live.example/", "https://live.example/?key=secret", "https://live.example/#secret"]) expect(publishedWebsiteUrl(url)).toBeNull();
  });
});
