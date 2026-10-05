/**
 * Chunk planning for `filesets.put` (Zoer docs/plugin-filesets.md): fixed 8 MiB chunks,
 * `index = offset / 8 MiB`, the last chunk short, an empty file one empty chunk 0. After a
 * reload, `filesets.status` lists incomplete entries with up to 512 missing chunk indices.
 */

export const FILESET_CHUNK_BYTES = 8 * 1024 * 1024;
const MISSING_CAP = 512;

export interface UploadEntry { path: string; bytes: number }
export interface ChunkTask { path: string; entryIndex: number; index: number; start: number; end: number }
export interface FileSetStatus {
  status: "open" | "sealed";
  completeEntries?: number;
  totalEntries?: number;
  entries: Array<{ entryIndex: number; path: string; bytes: number; received: number; missingChunks: number[] }>;
}

export function chunkCount(bytes: number) {
  return bytes <= 0 ? 1 : Math.ceil(bytes / FILESET_CHUNK_BYTES);
}

function chunk(entry: UploadEntry, entryIndex: number, index: number): ChunkTask {
  const start = index * FILESET_CHUNK_BYTES;
  return { path: entry.path, entryIndex, index, start, end: Math.min(entry.bytes, start + FILESET_CHUNK_BYTES) };
}

/**
 * Every chunk still to upload, in entry order. Without a status (a new set) that is every chunk;
 * with one, only the incomplete entries' missing chunks (a capped list also covers the chunks
 * after its last index). A sealed set needs nothing.
 */
export function planUpload(entries: UploadEntry[], status?: FileSetStatus | null): ChunkTask[] {
  if (status?.status === "sealed") return [];
  const tasks: ChunkTask[] = [];
  entries.forEach((entry, entryIndex) => {
    const count = chunkCount(entry.bytes);
    const all = Array.from({ length: count }, (_, index) => index);
    if (!status) { for (const index of all) tasks.push(chunk(entry, entryIndex, index)); return; }
    const pending = status.entries.find(item => item.path === entry.path);
    if (!pending) return; // complete
    const missing = [...new Set(pending.missingChunks.filter(index => Number.isInteger(index) && index >= 0 && index < count))].sort((a, b) => a - b);
    let indices = missing.length ? missing : all;
    if (pending.missingChunks.length >= MISSING_CAP) indices = [...missing, ...all.filter(index => index > (missing.at(-1) ?? -1))];
    for (const index of indices) tasks.push(chunk(entry, entryIndex, index));
  });
  return tasks;
}

export function plannedBytes(tasks: ChunkTask[]) {
  return tasks.reduce((sum, task) => sum + (task.end - task.start), 0);
}

/** Whether an existing set declares exactly these entries (same paths, sizes and digests, any order). */
export function sameManifest(existing: Array<{ path: string; bytes: number; sha256: string }>, wanted: Array<{ path: string; bytes: number; sha256: string }>) {
  if (existing.length !== wanted.length) return false;
  const byPath = new Map(existing.map(entry => [entry.path, entry]));
  return wanted.every(entry => { const found = byPath.get(entry.path); return !!found && found.bytes === entry.bytes && found.sha256 === entry.sha256; });
}
