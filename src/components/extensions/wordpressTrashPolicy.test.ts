import { describe, expect, test } from "bun:test";
import { purgeLabel, removalRequest, sortTrashedSites, type SiteRemovalPlan } from "./wordpressTrashPolicy";

describe("WordPress trash helpers", () => {
  test("orders by scheduled purge and labels the remaining days", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    const sites = sortTrashedSites([
      { id: "b", name: "B", status: "stopped", archivedAt: "", scheduledPurgeAt: "", owned: true },
      { id: "a", name: "A", status: "stopped", archivedAt: "", scheduledPurgeAt: "2026-10-09T00:00:00Z", owned: false },
      { id: "c", name: "C", status: "stopped", archivedAt: "", scheduledPurgeAt: "2026-10-05T00:00:00Z", owned: true },
    ]);
    expect(sites.map(site => site.id)).toEqual(["c", "a", "b"]);
    expect(purgeLabel("2026-10-05T00:00:00Z", now)).toBe("Purged in 1 day");
    expect(purgeLabel("2026-10-09T00:00:00Z", now)).toBe("Purged in 5 days");
    expect(purgeLabel("2026-10-03T00:00:00Z", now)).toBe("Purge due");
    expect(purgeLabel("", now)).toBe("Purge date unknown");
  });

  test("a removal is sent only with the exact phrase of the reviewed plan", () => {
    const plan: SiteRemovalPlan = { resourceId: "ddev-site", name: "Site", confirmationPhrase: "REMOVE FROM ZOER ddev-site", steps: [], warnings: [], retainedResources: [], fingerprintSha256: "a".repeat(64) };
    expect(removalRequest(plan, "remove from zoer ddev-site")).toBeNull();
    expect(removalRequest(plan, "REMOVE FROM ZOER ddev-site ")).toBeNull();
    expect(removalRequest({ ...plan, fingerprintSha256: "x" }, plan.confirmationPhrase)).toBeNull();
    expect(removalRequest(plan, plan.confirmationPhrase)).toEqual({ siteId: "ddev-site", fingerprintSha256: "a".repeat(64), confirmation: "REMOVE FROM ZOER ddev-site" });
  });
});
