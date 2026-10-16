import { expect, test } from "bun:test";
import { connectionHealth, hostingerCandidates, parsePublicationCheck, publicationView } from "./publicationCheck";

const record = (data: Record<string, unknown>) => ({ id: "publication-check:ep_1", kind: "publication-check", title: "", data: { v: 1, siteId: "ep_1", importId: "a".repeat(32), checkId: "c", status: "current", coverage: { pages: ["/", "/about/"], variants: ["desktop", "mobile"], assets: 2 }, results: [], checkedAt: "2026-10-16T20:00:00.000Z", ...data } });

test("transfer completion, purge and public observation keep separate labels", () => {
  expect(publicationView(null, { importId: "a".repeat(32) })).toMatchObject({ tone: "warning", label: "Published · check pending" });
  // A check of an earlier publication says nothing about this one.
  expect(publicationView(parsePublicationCheck(record({ importId: "b".repeat(32) })), { importId: "a".repeat(32) }).label).toBe("Published · check pending");
  const current = publicationView(parsePublicationCheck(record({})), { importId: "a".repeat(32) });
  expect(current).toMatchObject({ tone: "success", label: "Current on checked pages" });
  expect(current.description).toContain("2 pages (desktop and mobile) and 2 CSS/JS files");
  expect(publicationView(parsePublicationCheck(record({ status: "stale" }))).label).toBe("Old content detected");
  expect(publicationView(parsePublicationCheck(record({ status: "stale", rechecking: true }))).label).toBe("Caches cleared · still old");
  expect(publicationView(parsePublicationCheck(record({ status: "stale", rechecking: true })), { checking: true }).label).toBe("Caches cleared · rechecking");
  expect(publicationView(parsePublicationCheck(record({ status: "failed" }))).tone).toBe("error");
  expect(publicationView(parsePublicationCheck(record({ status: "not-verifiable", detail: "Update to 0.6.0" })))).toMatchObject({ tone: "neutral", label: "Not verifiable", description: "Update to 0.6.0" });
});

test("hosting websites are cache-link candidates only on an exact domain match from a connected account", () => {
  const sites = [
    { id: "h1", provider: "hostinger", connectionId: "c1", domain: "bisque-ant.example" },
    { id: "h2", provider: "hostinger", connectionId: "c1", domain: "www.bisque-ant.example" },
    { id: "h3", provider: "hostinger", connectionId: null, domain: "bisque-ant.example" },
    { id: "d1", provider: "ddev", connectionId: null, domain: "bisque-ant.example" },
  ] as any;
  expect(hostingerCandidates(sites, "https://bisque-ant.example").map((site: any) => site.id)).toEqual(["h1"]);
});

test("an old successful test is not current access", () => {
  const now = Date.parse("2026-10-16T20:00:00Z");
  expect(connectionHealth({ status: "error", lastError: "invalid_grant" } as any, now)).toMatchObject({ ok: false });
  expect(connectionHealth({ status: "connected", lastTestedAt: "2026-10-01T00:00:00Z" } as any, now)).toMatchObject({ ok: true, stale: true, label: "Last checked 15 days ago" });
  expect(connectionHealth({ status: "connected", lastTestedAt: "2026-10-16T19:00:00Z" } as any, now)).toMatchObject({ ok: true, stale: false });
  expect(connectionHealth(undefined, now).ok).toBe(false);
});
