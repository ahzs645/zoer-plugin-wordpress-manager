// Shared by the native workspace and isolated workers. Library data is metadata, never code to execute.
export const LIBRARY_KIND = "extension-library";
export const MANIFEST_VERSION = 1;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
const fail = (message) => { throw new Error(message); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
function text(value, fallback, max = 200) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "string" || !result.trim() || result.length > max || /[\x00-\x1f\x7f]/.test(result)) fail(`Expected text of 1–${max} characters.`);
  return result.trim();
}
export function githubRepository(value) {
  const raw = text(value, "", 500);
  const match = /^(?:https:\/\/github\.com\/)?([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9_.-]{1,100}?)\/?$/i.exec(raw);
  if (!match) fail("Use a GitHub repository URL or owner/repository, without credentials or query parameters.");
  const name = match[2].replace(/\.git$/i, "");
  if (!name || name === "." || name === "..") fail("Choose a GitHub repository.");
  return `https://github.com/${match[1].toLowerCase()}/${name.toLowerCase()}`;
}
function path(value, fallback) {
  const result = text(value, fallback, 300);
  if (result !== "." && (result.startsWith("/") || result.split("/").some(part => !part || part === "." || part === "..") || /[\\?#%]/.test(result))) fail("Use a relative repository path without traversal, query parameters or escapes.");
  return result;
}
function ref(value) {
  const result = text(value, "HEAD", 150);
  if (/[\\\s~^:?*\[\]%#]/.test(result) || result.includes("..") || result.startsWith("/") || result.endsWith("/")) fail("Choose a Git branch, tag or commit.");
  return result;
}
export function extensionEntry(value) {
  if (!object(value) || !["plugin", "theme"].includes(value.kind)) fail("Each repository needs kind plugin or theme.");
  const repositoryUrl = githubRepository(value.repositoryUrl);
  const slug = text(value.slug, repositoryUrl.split("/").at(-1), 100);
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug)) fail("Use a lowercase WordPress slug (letters, numbers, hyphens or underscores).");
  const description = value.description === undefined || value.description === "" ? "" : text(value.description, "", 1000);
  return { kind: value.kind, name: text(value.name, slug), slug, repositoryUrl, ref: ref(value.ref), path: path(value.path, "."), description };
}
export function manifestLocation(value) {
  if (!object(value)) fail("Choose a manifest repository.");
  const repositoryUrl = githubRepository(value.repositoryUrl);
  const filePath = path(value.path, "wordpress-library.json");
  if (filePath === ".") fail("Choose a manifest file path.");
  return { repositoryUrl, ref: ref(value.ref), path: filePath };
}
export const entryKey = entry => JSON.stringify([entry.kind, entry.repositoryUrl, entry.ref, entry.path, entry.slug]);
export const locationKey = location => JSON.stringify([location.repositoryUrl, location.ref, location.path]);
export function rawManifestUrl(location) {
  const clean = manifestLocation(location);
  return `https://raw.githubusercontent.com/${clean.repositoryUrl.slice("https://github.com/".length)}/${encodeURIComponent(clean.ref)}/${clean.path.split("/").map(encodeURIComponent).join("/")}`;
}
export function parseManifest(input) {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_MANIFEST_BYTES) fail("Manifest files are limited to 1 MiB.");
    try { input = JSON.parse(input); } catch { fail("The manifest must be valid JSON."); }
  }
  let count = 0, documents = 0;
  function visit(value, depth) {
    if (!object(value) || value.schemaVersion !== MANIFEST_VERSION) fail("Use a WordPress library manifest with schemaVersion 1.");
    if (Object.keys(value).some(key => !["schemaVersion", "repositories", "manifests"].includes(key))) fail("Unknown manifest field. Use schemaVersion, repositories and manifests.");
    if (depth > 5 || ++documents > 30) fail("A library supports up to 30 manifests, nested at most five levels.");
    const repositories = value.repositories ?? [], manifests = value.manifests ?? [];
    if (!Array.isArray(repositories) || !Array.isArray(manifests) || (count += repositories.length + manifests.length) > 500) fail("A manifest supports up to 500 entries including nested manifests.");
    return { schemaVersion: MANIFEST_VERSION, repositories: repositories.map(extensionEntry), manifests: manifests.map(item => {
      if (!object(item)) fail("Invalid manifest source.");
      const location = item.repositoryUrl === undefined ? {} : manifestLocation(item);
      if (!item.snapshot && !item.repositoryUrl) fail("A manifest source needs a GitHub repository or an embedded snapshot.");
      return { name: text(item.name, location.path ?? "Imported manifest"), ...location, ...(item.snapshot ? { snapshot: visit(item.snapshot, depth + 1) } : {}) };
    }) };
  }
  const result = visit(input, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_MANIFEST_BYTES) fail("Manifest files are limited to 1 MiB.");
  return result;
}

/** Resolve first, save separately: failed reads cannot partially import a library. Snapshots make exports portable. */
export async function resolveManifest(input, fetchManifest, refresh = false) {
  let fetched = 0, entries = 0, documents = 0;
  const cache = new Map();
  async function visit(input, parents = [], depth = 0) {
    if (depth > 5 || ++documents > 30) fail("A library supports up to 30 manifests, nested at most five levels.");
    const value = parseManifest(input);
    entries += value.repositories.length + value.manifests.length;
    if (entries > 500) fail("A manifest supports up to 500 entries including nested manifests.");
    const manifests = [];
    for (const source of value.manifests) {
      const key = source.repositoryUrl ? locationKey(source) : null;
      if (key && parents.includes(key)) fail("The manifest includes a circular reference.");
      let snapshot = source.snapshot;
      if ((!snapshot || refresh) && source.repositoryUrl) {
        if (!cache.has(key)) {
          if (++fetched > 20) fail("Import at most 20 GitHub manifest files at once.");
          cache.set(key, await fetchManifest(manifestLocation(source)));
        }
        snapshot = cache.get(key);
      }
      manifests.push({ ...source, snapshot: await visit(snapshot, key ? [...parents, key] : parents, depth + 1) });
    }
    return { ...value, manifests };
  }
  return parseManifest(await visit(input));
}

export function librarySource(value) {
  if (!object(value) || value.v !== 1) fail("Invalid library source version.");
  if (value.type === "repository") return { v: 1, type: "repository", entry: extensionEntry(value.entry) };
  if (value.type !== "manifest") fail("Choose a repository or manifest source.");
  const document = parseManifest({ schemaVersion: 1, manifests: [value.source] });
  const source = document.manifests[0];
  const complete = manifest => manifest.manifests.every(child => child.snapshot && complete(child.snapshot));
  if (!source.snapshot || !complete(source.snapshot)) fail("Resolve every manifest before saving it.");
  return { v: 1, type: "manifest", source };
}
export function sourceIdentity(source) {
  const clean = librarySource(source);
  return clean.type === "repository" ? `repository:${entryKey(clean.entry)}` : `manifest:${clean.source.repositoryUrl ? locationKey(clean.source) : clean.source.name}`;
}
export function readLibraryRecords(records) {
  return records.filter(record => record.kind === LIBRARY_KIND).map(record => ({ ...record, data: librarySource(record.data) }));
}
export function exportLibrary(records) {
  const sources = readLibraryRecords(records);
  return parseManifest({ schemaVersion: 1, repositories: sources.filter(row => row.data.type === "repository").map(row => row.data.entry), manifests: sources.filter(row => row.data.type === "manifest").map(row => row.data.source) });
}
/** Deduplicate identical sources, retaining every origin. Manual metadata wins over manifest metadata. */
export function libraryEntries(records) {
  const found = new Map();
  const add = (entry, origin) => {
    const key = entryKey(entry), previous = found.get(key);
    if (previous) { if (!previous.origins.includes(origin)) previous.origins.push(origin); }
    else found.set(key, { ...entry, key, origins: [origin] });
  };
  const sources = readLibraryRecords(records);
  for (const row of sources) if (row.data.type === "repository") add(row.data.entry, row.title);
  function visit(manifest, origin) {
    for (const entry of manifest.repositories) add(entry, origin);
    for (const child of manifest.manifests) visit(child.snapshot, `${origin} / ${child.name}`);
  }
  for (const row of sources) if (row.data.type === "manifest") visit(row.data.source.snapshot, row.title);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
