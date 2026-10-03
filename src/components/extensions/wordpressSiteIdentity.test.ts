import { expect, test } from "bun:test";
import type { WordPressManagedSite } from "../../lib/api";
import { consolidateWordPressSites, wordPressInstallationAddress, wordPressTransferMatchesSite } from "./wordpressSiteIdentity";
import { filterWordPressSiteGroups, groupWordPressSites, wordPressSiteCopies, wordPressSiteSource } from "./wordpressSiteGroups";

const site = (id: string, provider: WordPressManagedSite["provider"], url = "https://example.org"): WordPressManagedSite => ({ id, provider, url, name: id, environment: "production", domain: "example.org", managedUrl: null, subdomain: null, sourceSiteId: null, status: "connected", wordpressVersion: null, phpVersion: null, updates: null, vulnerabilities: null, connectionId: null, username: null, softwareId: null, capabilities: { preview: true, admin: false, extensions: false, backups: false, deploySource: false, deployTarget: false, siteHealth: false, rollback: false }, limitation: null });
const hosted = site("hosted", "hostinger");
const external = site("external", "zoer-connect", "https://EXAMPLE.org/");
const copy = { ...site("copy", "ddev"), sourceSiteId: external.id };

test("one exact installation combines presentation while preserving both operation owners and old links", () => {
  const inventory = [copy, external, hosted];
  const identity = consolidateWordPressSites(inventory);
  expect(identity.sites).toEqual([copy, hosted]);
  expect(identity.canonicalId(external.id)).toBe(hosted.id);
  expect(identity.connector(hosted)).toBe(external);
  expect(identity.connector(external)).toBe(external);
  expect(identity.aliases(hosted.id)).toEqual([external, hosted]);
  expect(copy.sourceSiteId).toBe(external.id);
  expect(wordPressSiteSource(inventory, copy)).toBe(hosted);
  expect(wordPressSiteCopies(inventory, hosted)).toEqual([copy]);
  const groups = groupWordPressSites(inventory, new Set());
  expect(groups).toEqual([{ kind: "pair", id: hosted.id, source: hosted, copies: [copy] }]);
  expect(filterWordPressSiteGroups(groups, "external", identity.aliases)).toEqual(groups);
});

test("separating connections restores original references; old copy separation preference survives consolidation", () => {
  const inventory = [copy, external, hosted];
  const identity = consolidateWordPressSites(inventory, new Set([hosted.id]));
  expect(identity.sites).toEqual(inventory);
  expect(identity.canonicalId(external.id)).toBe(external.id);
  expect(identity.connector(hosted)).toBe(hosted);
  expect(wordPressSiteSource(inventory, copy, new Set([hosted.id]))).toBe(external);
  expect(groupWordPressSites(inventory, new Set([external.id]))).toEqual([{ kind: "site", site: copy }, { kind: "site", site: hosted }]);
});

test("ambiguous duplicate connections remain independent, regardless of inventory order", () => {
  for (const inventory of [[hosted, external, site("other", "zoer-connect")], [external, hosted, site("other", "hostinger")]]) {
    expect(consolidateWordPressSites(inventory).sites).toEqual(inventory);
    expect(consolidateWordPressSites(inventory).canonicalId(external.id)).toBe(external.id);
  }
});

test("matching is conservative: different installation paths, ports, schemes, www and invalid addresses stay separate", () => {
  for (const url of ["https://example.org/blog", "https://www.example.org", "https://other.example.org", "https://example.org:8443", "http://example.org", "https://example.org?site=1", "https://example.org/#x", "https://user:password@example.org", "invalid"]) {
    const other = site("other", "zoer-connect", url);
    expect(consolidateWordPressSites([hosted, other]).sites).toEqual([hosted, other]);
  }
  expect(wordPressInstallationAddress(site("local", "ddev"))).toBeNull();
  expect(wordPressInstallationAddress(site("path", "zoer-connect", "https://EXAMPLE.org:443/blog/"))).toBe("https://example.org/blog");
});

test("copies made through either connection share one live card without changing stored source IDs", () => {
  const second = { ...copy, id: "copy2", sourceSiteId: hosted.id };
  const inventory = [external, copy, hosted, second];
  expect(wordPressSiteCopies(inventory, hosted)).toEqual([copy, second]);
  expect(groupWordPressSites(inventory, new Set())).toEqual([{ kind: "pair", id: hosted.id, source: hosted, copies: [copy, second] }]);
  expect(consolidateWordPressSites(inventory).canonicalId("deleted-site")).toBe("deleted-site");
});


test("history filters include transfers owned by either connection and local-copy source links, without broadening other sites", () => {
  const identity = consolidateWordPressSites([hosted, external, copy]);
  const transfers = [{ siteId: external.id }, { siteId: hosted.id }, { siteId: copy.id, sourceSiteId: external.id }, { siteId: "unrelated" }];
  expect(transfers.filter(item => wordPressTransferMatchesSite(item, hosted.id, identity.canonicalId))).toEqual(transfers.slice(0, 3));
  expect(transfers.filter(item => wordPressTransferMatchesSite(item, external.id, identity.canonicalId))).toEqual(transfers.slice(0, 3));
  const separated = consolidateWordPressSites([hosted, external], new Set([hosted.id]));
  expect(transfers.filter(item => wordPressTransferMatchesSite(item, hosted.id, separated.canonicalId))).toEqual([transfers[1]]);
  expect(wordPressTransferMatchesSite(transfers[3], "", identity.canonicalId)).toBe(true);
});
