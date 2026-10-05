import { expect, test } from "bun:test";
import { chunkCount, FILESET_CHUNK_BYTES, planUpload, plannedBytes, sameManifest } from "./uploadPlan";

const MiB = 1024 * 1024;
const entries = [
  { path: "backup_db.gz", bytes: 20 * MiB },
  { path: "backup-plugins.zip", bytes: 8 * MiB },
  { path: "backup-themes.zip", bytes: 1 },
  { path: "backup-uploads.zip", bytes: 0 },
];

test("chunks are fixed 8 MiB with a short last chunk and one empty chunk for an empty file", () => {
  expect(FILESET_CHUNK_BYTES).toBe(8 * MiB);
  expect(chunkCount(20 * MiB)).toBe(3);
  expect(chunkCount(8 * MiB)).toBe(1);
  expect(chunkCount(8 * MiB + 1)).toBe(2);
  expect(chunkCount(1)).toBe(1);
  expect(chunkCount(0)).toBe(1);
});

test("a new set uploads every chunk of every entry in order", () => {
  const tasks = planUpload(entries);
  expect(tasks.map(t => `${t.entryIndex}:${t.index}`)).toEqual(["0:0", "0:1", "0:2", "1:0", "2:0", "3:0"]);
  expect(tasks[2]).toEqual({ path: "backup_db.gz", entryIndex: 0, index: 2, start: 16 * MiB, end: 20 * MiB });
  expect(tasks[5]).toEqual({ path: "backup-uploads.zip", entryIndex: 3, index: 0, start: 0, end: 0 });
  expect(plannedBytes(tasks)).toBe(28 * MiB + 1);
});

test("after a reload only the missing chunks of incomplete entries are uploaded", () => {
  const tasks = planUpload(entries, { status: "open", entries: [
    { entryIndex: 0, path: "backup_db.gz", bytes: 20 * MiB, received: 8 * MiB, missingChunks: [2, 1] },
    { entryIndex: 3, path: "backup-uploads.zip", bytes: 0, received: 0, missingChunks: [0] },
  ] });
  expect(tasks.map(t => `${t.path}#${t.index}`)).toEqual(["backup_db.gz#1", "backup_db.gz#2", "backup-uploads.zip#0"]);
  expect(plannedBytes(tasks)).toBe(12 * MiB);
});

test("an incomplete entry without a missing list is uploaded again; out-of-range indices are ignored", () => {
  const tasks = planUpload(entries, { status: "open", entries: [{ entryIndex: 1, path: "backup-plugins.zip", bytes: 8 * MiB, received: 8 * MiB, missingChunks: [] }, { entryIndex: 0, path: "backup_db.gz", bytes: 20 * MiB, received: 0, missingChunks: [7, -1, 2] }] });
  expect(tasks.map(t => `${t.path}#${t.index}`)).toEqual(["backup_db.gz#2", "backup-plugins.zip#0"]);
});

test("a capped missing list also covers the chunks after its last index", () => {
  const big = [{ path: "big.zip", bytes: 600 * FILESET_CHUNK_BYTES }];
  const missing = Array.from({ length: 512 }, (_, i) => i);
  const tasks = planUpload(big, { status: "open", entries: [{ entryIndex: 0, path: "big.zip", bytes: big[0].bytes, received: 0, missingChunks: missing }] });
  expect(tasks.length).toBe(600);
  expect(tasks.at(-1)?.index).toBe(599);
});

test("a sealed set needs no upload", () => {
  expect(planUpload(entries, { status: "sealed", entries: [] })).toEqual([]);
});

test("an earlier upload is reused only for the same files", () => {
  const wanted = [{ path: "a-db.gz", bytes: 3, sha256: "a".repeat(64) }, { path: "a-plugins.zip", bytes: 4, sha256: "b".repeat(64) }];
  expect(sameManifest([...wanted].reverse(), wanted)).toBe(true);
  expect(sameManifest([wanted[0], { ...wanted[1], sha256: "c".repeat(64) }], wanted)).toBe(false);
  expect(sameManifest([wanted[0], { ...wanted[1], bytes: 5 }], wanted)).toBe(false);
  expect(sameManifest([wanted[0]], wanted)).toBe(false);
});
