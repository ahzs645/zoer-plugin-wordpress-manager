import { expect, test } from "bun:test";
import type { WordPressPullJob } from "../../lib/queries/wordpress-pulls";
import { formatTransferBytes, pullProgress, pullStatus } from "./wordpressPullProgress";

const job: WordPressPullJob = { id: "pull", status: "preparing", createdAt: "2026-09-15", index: 0, offset: 0, files: [] };
test("an old preparing checkpoint is resume needed, never done or actively scanning", () => {
  expect(pullStatus(job)).toBe("Resume needed");
  expect(pullStatus({ ...job, running: true })).toBe("Preparing source export");
  expect(pullStatus({ ...job, status: "ready" })).toBe("Download complete · Verified");
  expect(pullStatus({ ...job, lastError: "Export expired" })).toBe("Transfer interrupted");
  expect(pullStatus({ ...job, pendingAction: "pause" })).toBe("Pausing after current batch…");
});
test("scanning and paused scans never present an incomplete manifest sum as the total", () => {
  const partial = { ...job, fileCount: 500, totalBytes: 1000 };
  expect(pullProgress(partial).total).toBeNull();
  expect(pullProgress({ ...partial, status: "paused", pausedFrom: "preparing" }).total).toBeNull();
});
test("bytes include partial files and distinguish a full byte count from verified completion", () => {
  const download = { ...job, status: "downloading" as const, running: true, files: [{ path: "a", bytes: 1000 }, { path: "b", bytes: 3000 }], index: 1, offset: 1000 };
  expect(pullProgress(download)).toEqual({ bytes: 2000, total: 4000, percent: 50 });
  expect(pullProgress({ ...download, downloadedBytes: 3557437696, totalBytes: 3557437696 }).percent).toBe(100);
  expect(pullStatus(download)).toBe("Downloading to Zoer");
  expect(formatTransferBytes(3557437696)).toBe("3.56 GB");
  expect(formatTransferBytes(0)).toBe("0 B");
});
