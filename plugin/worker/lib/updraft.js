// The five-part UpdraftPlus set uploaded for a restore (legacy `validateUpdraftImportManifest` in
// Zoer `backend/src/wordpress-updraft-import.ts`, same limits and messages). The set's entries are
// the original file names; the host already verified sizes and digests when they were uploaded.
import { TransferError } from "./slices.js";

export const UPDRAFT_COMPONENTS = ["database", "plugins", "themes", "uploads", "others"];
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_COMPONENT_BYTES = 1024 * 1024 * 1024;
const FILE_SUFFIX = { database: /-db\.gz$/i, plugins: /-plugins\.zip$/i, themes: /-themes\.zip$/i, uploads: /-uploads\.zip$/i, others: /-others\.zip$/i };
const fail = (message) => { throw new TransferError(message); };

export function componentOf(name) {
  return UPDRAFT_COMPONENTS.find(component => FILE_SUFFIX[component].test(name)) ?? null;
}

/** Components in restore order with their entry indices. */
export function validateUpdraftSet(entries) {
  if (!Array.isArray(entries) || entries.length !== UPDRAFT_COMPONENTS.length) fail("select one database, plugins, themes, uploads, and others backup file");
  const byComponent = new Map();
  const prefixes = new Set();
  for (const [entryIndex, entry] of entries.entries()) {
    const name = entry.path;
    const component = componentOf(name);
    if (!component || name.includes("/") || name.length > 255) fail(`${component ?? "backup"} has an unexpected UpdraftPlus filename`);
    if (byComponent.has(component)) fail(`duplicate ${component} backup component`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_COMPONENT_BYTES) fail(`${component} has an invalid size`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) fail(`${component} has an invalid SHA-256 digest`);
    prefixes.add(name.replace(FILE_SUFFIX[component], ""));
    byComponent.set(component, { component, originalName: name, size: entry.bytes, sha256: entry.sha256, entryIndex });
  }
  const components = UPDRAFT_COMPONENTS.map(component => byComponent.get(component));
  if (components.some(c => !c)) fail("select one database, plugins, themes, uploads, and others backup file");
  if (components.reduce((sum, c) => sum + c.size, 0) > MAX_TOTAL_BYTES) fail("backup set exceeds the 2 GiB import limit");
  if (prefixes.size !== 1) fail("all five files must belong to the same UpdraftPlus backup set");
  return components;
}
