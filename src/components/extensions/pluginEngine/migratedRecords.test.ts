import { expect, test } from "bun:test";
import {
  existingCopies, mergeDeployments, mergeEngineHistory, parseDeploymentRecord, parseHistoryRecord, parseLocalCopyRecord, parsePullRecord,
  parseRecoveryPointRecord, parseSiteLink, pushSources, recoveryPointRecord, recoveryPointsFor, refreshCandidates, withSiteLinks,
  type EngineHistoryItem, type LocalCopyRecord, type PullRecord,
} from "./records";

// Records exactly as Zoer's `wordpress-manager.transfers-to-plugin` data migration writes them.
const PULL = "a".repeat(32), EXPORT = "b".repeat(32);
const migratedPull = (pullId: string, kind: "pull" | "local-export", siteId: string, status?: string) => ({
  id: `pull:${pullId}`, kind: "pull", title: `Pull ${siteId}`,
  data: { v: 1, pullId, siteId, kind, setId: `fs_${pullId}`, ...(status ? { status } : {}), options: { options: { resources: { database: true, themes: true, plugins: true, media: true } }, database: true, profile: { themes: true, plugins: true, media: true } },
    source: { url: "https://shop.example", prefix: "wp_" }, skipped: [], skippedCount: 0, fileCount: 12, totalBytes: 4096, createdAt: "2026-09-01T10:00:00Z", finishedAt: "2026-09-01T10:05:00Z", engine: "legacy-migrated" },
});

test("migrated pulls and local exports are ready push and copy sources", () => {
  const pulls = [migratedPull(PULL, "pull", "external:shop", "ready"), migratedPull(EXPORT, "local-export", "ddev-shop")].map(parsePullRecord).filter((p): p is PullRecord => !!p);
  // Zoer 61657b48 writes status "ready"; earlier migration runs wrote none and are still finished pulls.
  expect(pulls.map(p => [p.pullId, p.kind, p.status, p.setId, p.engine])).toEqual([[PULL, "pull", "ready", `fs_${PULL}`, "legacy-migrated"], [EXPORT, "local-export", "ready", `fs_${EXPORT}`, "legacy-migrated"]]);
  expect(pushSources(pulls, "external:dest").map(p => p.pullId)).toEqual([PULL, EXPORT]);
  expect(pushSources(pulls, "external:shop").map(p => p.pullId)).toEqual([EXPORT]);
  // A plugin-engine pull that never finished stays a download in progress.
  expect(parsePullRecord({ ...migratedPull(PULL, "pull", "s"), data: { ...migratedPull(PULL, "pull", "s").data, engine: "plugin" } })!.status).toBe("downloading");
});

test("migrated history is listed with the earlier engine marked", () => {
  const record = { id: `history:push:${PULL}`, kind: "transfer-history", title: "Push", data: { kind: "push", id: PULL, siteId: "external:dest", siteName: "Dest", sourceSiteId: "external:shop", sourceName: "Shop", status: "complete", startedAt: "2026-09-02T10:00:00Z", finishedAt: "2026-09-02T10:09:00Z", bytes: 99, summary: "Database + 3 files from Shop", engine: "legacy" } };
  const item = parseHistoryRecord(record)!;
  expect(item).toMatchObject({ kind: "push", engine: "legacy", status: "complete", sourceSiteId: "external:shop", summary: "Database + 3 files from Shop" });
  expect(mergeEngineHistory([item], []).map((i: EngineHistoryItem) => i.key)).toEqual([`push:${PULL}`]);
  expect(parseHistoryRecord({ ...record, data: { ...record.data, lastError: "Key changed" } })!.error).toBe("Key changed");
});

test("migrated local copies are listed and refreshable, and site links group copies under their source", () => {
  const copy = (copyId: string, targetId: string, finishedAt: string) => parseLocalCopyRecord({ id: `local-copy:${copyId}`, kind: "local-copy", data: { copyId, sourceSiteId: "external:shop", pullId: PULL, targetId, targetUrl: `https://${targetId}.wp.example`, name: "Shop local", phase: "complete", createdAt: finishedAt, finishedAt, engine: "legacy" } })!;
  const copies: LocalCopyRecord[] = [copy("c1", "ddev-shop-local", "2026-09-01T00:00:00Z"), copy("c2", "ddev-shop-local", "2026-09-03T00:00:00Z"), copy("c3", "playground-x", "2026-09-02T00:00:00Z")];
  expect(existingCopies(copies, "external:shop").map(c => c.copyId)).toEqual(["c2", "c3"]);
  expect(refreshCandidates(copies, "external:shop").map(c => c.targetId)).toEqual(["ddev-shop-local"]);
  const link = parseSiteLink({ id: "site-link:ddev-shop-local", kind: "site-link", data: { targetSiteId: "ddev-shop-local", sourceSiteId: "external:shop", copyId: "c2", createdAt: "x" } })!;
  const sites = [{ id: "external:shop", sourceSiteId: null }, { id: "ddev-shop-local", sourceSiteId: null }, { id: "ddev-other", sourceSiteId: "external:gone" }];
  expect(withSiteLinks(sites, [link]).map(s => s.sourceSiteId)).toEqual([null, "external:shop", "external:gone"]);
  // Zoer's own link wins, and a link to a site that is no longer listed is ignored.
  expect(withSiteLinks([{ id: "ddev-shop-local", sourceSiteId: "other" }], [link])[0]!.sourceSiteId).toBe("other");
  expect(withSiteLinks<{ id: string; sourceSiteId?: string | null }>([{ id: "ddev-shop-local" }], [link])[0]!.sourceSiteId).toBeUndefined();
  expect(parseSiteLink({ kind: "site-link", data: { targetSiteId: "a", sourceSiteId: "a" } })).toBeNull();
});

test("migrated deployments supplement Zoer's list and recovery points show per website", () => {
  const record = { id: "deployment:d1", kind: "deployment", data: { id: "d1", type: "full-site", sourceSiteId: "ddev-shop", targetSiteId: null, connectionId: "h1", domain: "shop.example", status: "succeeded", step: "Published and verified", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T01:00:00Z", completedAt: "2026-09-01T01:00:00Z", error: null, details: { mode: "replace" }, engine: "legacy" } };
  const migrated = parseDeploymentRecord(record)!;
  expect(migrated).toMatchObject({ id: "d1", type: "full-site", status: "succeeded", domain: "shop.example", details: { mode: "replace" } });
  expect(parseDeploymentRecord({ ...record, data: { ...record.data, status: "bogus" } })).toBeNull();
  const host = { ...migrated, id: "d2", updatedAt: "2026-09-05T00:00:00Z" };
  const hostCopy = { ...migrated, step: "From Zoer" };
  expect(mergeDeployments([host, hostCopy], [migrated]).map(d => [d.id, d.step])).toEqual([["d2", "Published and verified"], ["d1", "From Zoer"]]);
  const point = parseRecoveryPointRecord({ id: "recovery-point:r1", kind: "recovery-point", data: { id: "r1", connectionId: "h1", domain: "Shop.example", label: "hPanel backup", method: "hostinger-hpanel", verifiedAt: "2026-09-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", engine: "legacy" } })!;
  expect(recoveryPointsFor([point, point], { connectionId: "h1", domain: "shop.example" }).map(p => p.id)).toEqual(["r1"]);
  expect(recoveryPointsFor([point], { connectionId: "h2", domain: "shop.example" })).toEqual([]);
  expect(recoveryPointRecord(point)).toMatchObject({ id: "recovery-point:r1", kind: "recovery-point", data: { id: "r1", connectionId: "h1", label: "hPanel backup" } });
});
