import { expect, test } from "bun:test";
import type { HostingerConnectionPublic, HostingerSetupInventory, WordPressDeployment } from "../../lib/api";
import { hostingerPlanOptions, hostingerTestSites } from "./hostingerTestSites";

const receipt = (patch: Partial<WordPressDeployment>): WordPressDeployment => ({
  id: "d1", type: "site-provision", sourceSiteId: null, targetSiteId: null, connectionId: "c1", domain: "red-fox-1.hostingersite.com",
  status: "preparing", step: "Hostinger is setting up the website", createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:00:00.000Z",
  completedAt: null, error: null, details: { provision: { deletedAt: null, warnings: [] } }, ...patch,
});

test("lists websites created here, newest first, with their state", () => {
  const sites = hostingerTestSites([
    receipt({ id: "old", status: "succeeded", createdAt: "2026-10-18T10:00:00.000Z" }),
    receipt({ id: "new" }),
    receipt({ id: "gone", status: "succeeded", details: { provision: { deletedAt: "2026-10-19T11:00:00.000Z", warnings: [] } } }),
    receipt({ id: "failed", status: "failed", error: "Hostinger refused", createdAt: "2026-10-17T10:00:00.000Z", details: { provision: { deletedAt: null, warnings: ["Storage could not be prepared.", 3] } } }),
    receipt({ id: "publish", type: "full-site" }),
    receipt({ id: "plain", details: {} }),
  ]);
  expect(sites.map((site) => [site.id, site.running, site.ready, site.deleted])).toEqual([
    ["new", true, false, false], ["gone", false, true, true], ["old", false, true, false], ["failed", false, false, false],
  ]);
  expect(sites.find((site) => site.id === "failed")!.warnings).toEqual(["Storage could not be prepared."]);
});

test("offers the hosting plans of every connected account in one list", () => {
  const connections = [{ id: "c1", name: "Agency" }, { id: "c2", name: "Personal" }] as HostingerConnectionPublic[];
  const inventory = (orders: HostingerSetupInventory["orders"], websites: number[]): HostingerSetupInventory => ({ orders, domains: [], websites: websites.map((orderId, index) => ({ domain: `s${index}.example`, orderId, hasWordPress: true, enabled: true })), temporaryDomainUrl: "" });
  const options = hostingerPlanOptions(connections, {
    c1: inventory([{ id: 10, name: "hostinger_business", status: "active" }], [10, 10, 10]),
    c2: inventory([{ id: 20, name: "hostinger_premium", status: "active" }, { id: 21, name: "hostinger_single", status: "expired" }], [20]),
  });
  expect(options).toEqual([
    { value: "c1:10", connectionId: "c1", orderId: 10, disabled: false, label: "Agency · Business plan · 3 websites" },
    { value: "c2:20", connectionId: "c2", orderId: 20, disabled: false, label: "Personal · Premium plan · 1 website" },
    { value: "c2:21", connectionId: "c2", orderId: 21, disabled: true, label: "Personal · Single plan · 0 websites · expired" },
  ]);
  // One account: its name is left out; an account whose inventory has not loaded adds nothing.
  expect(hostingerPlanOptions(connections.slice(0, 1), { c1: inventory([{ id: 10, name: "hostinger_business", status: "active" }], []) })[0]!.label).toBe("Business plan · 0 websites");
  expect(hostingerPlanOptions(connections, {})).toEqual([]);
});
