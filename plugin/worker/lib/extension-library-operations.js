import { createHash } from "node:crypto";
import { LIBRARY_KIND, MAX_MANIFEST_BYTES, resolveManifest, rawManifestUrl, parseManifest, libraryEntries, librarySource, sourceIdentity, exportLibrary } from "./extension-library.js";
const MAX_SOURCES = 100;
const fail = message => { throw new Error(message); };
// Worker operations keep the entire library inside WordPress Manager's existing catalog.
export async function libraryOperation(host, actionId, input) {
  if (actionId === "library.resolve") {
    const manifest = await resolveManifest(input.manifest, async location => {
      const response = await host.call("network.fetch", { url: rawManifestUrl(location), method: "GET", headers: { accept: "application/json" } });
      if (response.status < 200 || response.status >= 300) fail(`GitHub returned HTTP ${response.status}. For private repositories, import the manifest from an existing repository or upload its JSON.`);
      const bytes = Buffer.from(response.bodyBase64 ?? "", "base64");
      if (bytes.length > MAX_MANIFEST_BYTES) fail("Manifest files are limited to 1 MiB.");
      return parseManifest(bytes.toString("utf8"));
    }, input.refresh === true);
    return { manifest };
  }
  async function read() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const records = []; let after = "", revision;
      for (;;) {
        const page = await host.call("catalog.read", { kind: LIBRARY_KIND, after, limit: 100 });
        if (revision !== undefined && revision !== page.revision) break;
        records.push(...page.records); revision = page.revision;
        if (records.length > MAX_SOURCES) fail("A library supports up to 100 saved sources.");
        if (!page.next) return { records, revision };
        after = page.next;
      }
    }
    return fail("The library kept changing while it was read. Reload it and try again.");
  }
  if (actionId === "library.search") {
    const entries = libraryEntries((await read()).records).filter(entry => (!input.kind || entry.kind === input.kind) && JSON.stringify(entry).toLowerCase().includes((input.query ?? "").toLowerCase()));
    const offset = input.offset ?? 0, limit = input.limit ?? 20;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) fail("Choose a nonnegative offset and a limit of 1–20.");
    return { entries: entries.slice(offset, offset + limit), total: entries.length, next: offset + limit < entries.length ? offset + limit : null };
  }
  if (!["library.save", "library.remove", "library.import"].includes(actionId)) fail("Unknown library operation.");
  const validId = id => typeof id === "string" && /^extension-library:[a-f0-9]{64}$/.test(id);
  const imported = actionId === "library.import" ? parseManifest(input.manifest) : null;
  const sources = imported ? [
    ...imported.repositories.map(entry => librarySource({ v: 1, type: "repository", entry })),
    ...imported.manifests.map(source => librarySource({ v: 1, type: "manifest", source })),
  ] : actionId === "library.save" ? [librarySource(input.source)] : [];
  const recordsToSave = [...new Map(sources.map(source => {
    const id = `extension-library:${createHash("sha256").update(sourceIdentity(source)).digest("hex")}`;
    return [id, { id, kind: LIBRARY_KIND, title: source.type === "repository" ? source.entry.name : source.source.name, data: source }];
  })).values()];
  const deletes = actionId === "library.remove" ? [input.id] : input.replaceId && !recordsToSave.some(row => row.id === input.replaceId) ? [input.replaceId] : [];
  if (deletes.some(id => !validId(id))) fail("Choose a saved library source.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const { records, revision } = await read();
    if (input.replaceId && !records.some(row => row.id === input.replaceId)) fail("The source being edited was removed. Reload the library.");
    const changed = new Set([...recordsToSave.map(row => row.id), ...deletes]);
    const next = [...records.filter(row => !changed.has(row.id)), ...recordsToSave];
    if (next.length > MAX_SOURCES) fail("A library supports up to 100 saved sources.");
    exportLibrary(next); // Keep the combined library exportable within the manifest limits.
    const result = await host.call("catalog.commit", { revision, records: recordsToSave, deletes });
    if (result.conflict) continue;
    const saved = await read();
    if (recordsToSave.some(row => !saved.records.some(record => record.id === row.id && JSON.stringify(record.data) === JSON.stringify(row.data))) || deletes.some(id => saved.records.some(record => record.id === id))) fail("The saved library changed during verification. Reload it before trying again.");
    return { ids: recordsToSave.map(row => row.id), saved: recordsToSave.length, removed: deletes.length };
  }
  fail("The library kept changing. Reload it and try again.");
}
