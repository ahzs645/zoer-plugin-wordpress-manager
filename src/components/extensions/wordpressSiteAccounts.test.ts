import { expect, test } from "bun:test";
import type { WordPressManagedSite } from "../../lib/api";
import type { HostingerTestSite } from "./hostingerTestSites";
import { createdWebsiteOf, siteAccountId, siteInScope } from "./wordpressSiteAccounts";

const capabilities = { preview: true, admin: true, extensions: true, backups: true, deploySource: false, deployTarget: false, siteHealth: false, rollback: false };
function site(id: string, provider: WordPressManagedSite["provider"], extra: Partial<WordPressManagedSite> = {}): WordPressManagedSite {
  return { id, provider, environment: ["ddev", "kubernetes"].includes(provider) ? "local" : "production", name: id, domain: null, url: null, subdomain: null, managedUrl: null, status: "running", wordpressVersion: null, phpVersion: null, updates: null, vulnerabilities: null, connectionId: null, username: null, softwareId: null, capabilities, limitation: null, ...extra };
}
const created = (domain: string, connectionId: string, extra: Partial<HostingerTestSite> = {}): HostingerTestSite =>
  ({ id: `dep-${domain}`, connectionId, domain, status: "succeeded", step: "Ready", error: null, createdAt: "2026-10-20T12:00:00Z", running: false, ready: true, deleted: false, warnings: [], ...extra });

const hosted = site("hostinger:shop", "hostinger", { domain: "shop.example", connectionId: "ote" });
const paired = site("external:shop", "zoer-connect", { url: "https://shop.example" });
const fresh = site("external:fox", "zoer-connect", { url: "https://gold-fox-1.hostingersite.com/" });
const unknown = site("external:other", "zoer-connect", { url: "https://other.example" });
const local = site("ddev-shop", "ddev", { sourceSiteId: "external:shop" });
const loose = site("ddev-loose", "ddev");

test("a live site's account comes from its Hostinger record, else from the website Zoer created", () => {
  expect(siteAccountId(hosted, [hosted, paired], [])).toBe("ote");
  expect(siteAccountId(paired, [hosted, paired], [])).toBe("ote");
  expect(siteAccountId(fresh, [fresh], [created("gold-fox-1.hostingersite.com", "sparklab")])).toBe("sparklab");
  expect(siteAccountId(fresh, [fresh], [created("gold-fox-1.hostingersite.com", "sparklab", { deleted: true })])).toBeNull();
  expect(siteAccountId(unknown, [unknown], [created("gold-fox-1.hostingersite.com", "sparklab")])).toBeNull();
  expect(siteAccountId(local, [local], [])).toBeNull();
});

test("an account scope keeps its live sites with their local copies", () => {
  const accountOf = (item: WordPressManagedSite) => item === hosted || item === paired ? "ote" : item === fresh ? "sparklab" : null;
  const sourceOf = (item: WordPressManagedSite) => item === local ? paired : null;
  const shown = (scope: Parameters<typeof siteInScope>[1]) => [hosted, paired, fresh, unknown, local, loose].filter(item => siteInScope(item, scope, accountOf, sourceOf)).map(item => item.id);
  expect(shown("account:ote")).toEqual(["hostinger:shop", "external:shop", "ddev-shop"]);
  expect(shown("account:sparklab")).toEqual(["external:fox"]);
  expect(shown("local")).toEqual(["ddev-shop", "ddev-loose"]);
  expect(shown("all")).toHaveLength(6);
});

test("only a website WordPress Manager created, on the same account and finished, can be deleted from its page", () => {
  const leopard = site("hostinger:spark:1", "hostinger", { domain: "gold-leopard-1.hostingersite.com", connectionId: "sparklab" });
  const receipt = created("gold-leopard-1.hostingersite.com", "sparklab");
  expect(createdWebsiteOf(leopard, [], [receipt])?.id).toBe(receipt.id);
  expect(createdWebsiteOf(fresh, [], [created("gold-fox-1.hostingersite.com", "sparklab")])?.domain).toBe("gold-fox-1.hostingersite.com");
  expect(createdWebsiteOf(leopard, [], [created("gold-leopard-1.hostingersite.com", "ote")])).toBeNull();
  expect(createdWebsiteOf(leopard, [], [created("gold-leopard-1.hostingersite.com", "sparklab", { deleted: true })])).toBeNull();
  expect(createdWebsiteOf(leopard, [], [created("gold-leopard-1.hostingersite.com", "sparklab", { running: true })])).toBeNull();
  expect(createdWebsiteOf(hosted, [], [receipt])).toBeNull();
  expect(createdWebsiteOf(local, [], [receipt])).toBeNull();
});
