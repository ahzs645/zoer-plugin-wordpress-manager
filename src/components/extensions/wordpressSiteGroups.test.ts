import { expect, test } from "bun:test";
import type { WordPressManagedSite } from "../../lib/api";
import { filterWordPressSiteGroups, groupWordPressSites, wordPressSiteCopies, wordPressSiteSource } from "./wordpressSiteGroups";

const capabilities = { preview: true, admin: true, extensions: true, backups: true, deploySource: false, deployTarget: false, siteHealth: false, rollback: false };
function site(id: string, provider: WordPressManagedSite["provider"], extra: Partial<WordPressManagedSite> = {}): WordPressManagedSite {
  return { id, provider, environment: provider === "ddev" ? "local" : "production", name: id, domain: `${id}.example`, url: null, subdomain: null, managedUrl: null, status: "running", wordpressVersion: null, phpVersion: null, updates: null, vulnerabilities: null, connectionId: null, username: null, softwareId: null, capabilities, limitation: null, ...extra };
}

const copy = site("copy", "ddev", { sourceSiteId: "live" });
const orphan = site("orphan", "ddev", { sourceSiteId: "gone" });
const live = site("live", "zoer-connect");
const other = site("other", "hostinger");
const sites = [copy, orphan, other, live];

test("a local copy is grouped under its live site at the copy's position", () => {
  expect(groupWordPressSites(sites, new Set())).toEqual([
    { kind: "pair", id: "live", source: live, copies: [copy] },
    { kind: "site", site: orphan },
    { kind: "site", site: other },
  ]);
});

test("a separated pair renders as two ordinary cards", () => {
  expect(groupWordPressSites(sites, new Set(["live"])).map((group) => group.kind === "site" ? group.site.id : group.id)).toEqual(["copy", "orphan", "other", "live"]);
});

test("several copies of one site share a card and a copy pointing at itself is ignored", () => {
  const second = site("copy2", "ddev", { sourceSiteId: "live" });
  const selfish = site("self", "ddev", { sourceSiteId: "self" });
  const groups = groupWordPressSites([live, copy, second, selfish], new Set());
  expect(groups).toEqual([{ kind: "pair", id: "live", source: live, copies: [copy, second] }, { kind: "site", site: selfish }]);
});

test("searching keeps a pair together when only one side matches", () => {
  const groups = groupWordPressSites(sites, new Set());
  expect(filterWordPressSiteGroups(groups, "COPY.example").map((group) => group.kind)).toEqual(["pair"]);
  expect(filterWordPressSiteGroups(groups, "other")).toEqual([{ kind: "site", site: other }]);
  expect(filterWordPressSiteGroups(groups, "  ")).toBe(groups);
});

test("counterparts resolve in both directions and never to a missing site", () => {
  expect(wordPressSiteSource(sites, copy)).toBe(live);
  expect(wordPressSiteSource(sites, orphan)).toBeNull();
  expect(wordPressSiteCopies(sites, live)).toEqual([copy]);
  expect(wordPressSiteCopies(sites, other)).toEqual([]);
});
