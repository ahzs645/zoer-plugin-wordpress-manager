// S2 file sets: idempotent declaration of large manifests and paged reads.
const PAGE = 2000;

/** `fs_` + a 32-hex job ID: a deterministic set ID makes `fileset.create` idempotent on replay. */
export const setIdFor = (hex32) => `fs_${hex32}`;

/** Summary of a set, or null when it does not exist. */
export async function describeSet(host, setId) {
  try { return (await host.call("fileset.describe", { setId, offset: 0, limit: 1 })).set; }
  catch (error) { if (error?.code === "fileset_not_found") return null; throw error; }
}

/**
 * Declares `entries` in the (possibly existing) open set: creates it with the first page, then
 * extends from the number of entries the host already holds, so a replayed slice never declares
 * an entry twice.
 */
export async function declareEntries(host, { setId, name, rules, labels, retain = false }, entries, startAt = 0) {
  let set = await describeSet(host, setId);
  if (!set) {
    const first = entries.slice(0, PAGE);
    set = (await host.call("fileset.create", { setId, name, entries: first, ...(rules ? { rules } : {}), ...(labels ? { labels } : {}), retain })).set;
  }
  const held = () => set.entryCount ?? set.entries?.length ?? 0;
  for (let at = held() - startAt; at < entries.length; at = held() - startAt) {
    if (at < 0) throw new Error("The file set holds fewer entries than already declared.");
    set = (await host.call("fileset.extend", { setId, entries: entries.slice(at, at + PAGE) })).set;
  }
  return set;
}

/** Every entry of a set (optionally with sealed block digests), in pages. */
export async function listEntries(host, setId, { includeBlocks = false, from = 0, limit = Infinity } = {}) {
  const entries = [];
  let offset = from;
  while (offset !== null && entries.length < limit) {
    const page = await host.call("fileset.describe", { setId, offset, limit: 2000, ...(includeBlocks ? { includeBlocks: true } : {}) });
    entries.push(...page.entries);
    offset = page.next;
  }
  return entries;
}

export async function deleteSet(host, setId) {
  try { await host.call("fileset.delete", { setId }); } catch (error) { if (error?.code !== "fileset_not_found") throw error; }
}

/** Reads a small complete entry (≤ 4 MiB) as text. */
export async function readText(host, setId, path, maxBytes = 65536) {
  const { dataBase64 } = await host.call("fileset.read", { setId, path, offset: 0, maxBytes });
  return Buffer.from(dataBase64, "base64").toString("utf8");
}
