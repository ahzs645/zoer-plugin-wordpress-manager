import { describe, expect, test } from "bun:test";
import { extensionEntry, githubRepository, parseManifest, resolveManifest, rawManifestUrl, libraryEntries, exportLibrary, LIBRARY_KIND } from "../plugin/worker/lib/extension-library.js";
import { libraryOperation as operate } from "../plugin/worker/lib/extension-library-operations.js";

const libraryOperation = (host: any, action: string, input: any): Promise<any> => operate(host, action, input);
const entry = (name = "Our forms", kind = "plugin") => ({ kind, name, slug: "our-forms", repositoryUrl: "https://github.com/Team/Our-Forms.git", ref: "main", path: ".", description: "A form builder" });
const manifest = (repositories: unknown[] = [], manifests: unknown[] = []) => ({ schemaVersion: 1, repositories, manifests });
const repoSource = (name?: string) => ({ v: 1, type: "repository", entry: entry(name) });
const location = { name: "Shared collection", repositoryUrl: "https://github.com/team/catalog", ref: "release/one", path: "wordpress/plugins.json" };
const jsonResponse = (body: unknown) => ({ status: 200, bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64") });

function fixture() {
  let revision = 0;
  const store = new Map<string, any>();
  const calls: Array<{ method: string; input: any }> = [];
  let conflicts = 0;
  let fetch = async (_input: any): Promise<any> => jsonResponse(manifest([entry()]));
  const host = { async call(method: string, input: any): Promise<any> {
    calls.push({ method, input });
    if (method === "network.fetch") return fetch(input);
    if (method === "catalog.read") {
      if (input.ids) return { revision, records: input.ids.flatMap((id: string) => store.has(id) ? [store.get(id)] : []), next: null };
      const rows = [...store.values()].filter(row => row.kind === input.kind && row.id > (input.after ?? "")).sort((a, b) => a.id.localeCompare(b.id));
      return { revision, records: rows.slice(0, input.limit), next: rows.length > input.limit ? rows[input.limit - 1].id : null };
    }
    if (method === "catalog.commit") {
      if (conflicts-- > 0 || input.revision !== revision) return { conflict: true };
      input.deletes?.forEach((id: string) => store.delete(id));
      input.records?.forEach((row: any) => store.set(row.id, structuredClone(row)));
      return { revision: ++revision };
    }
    throw new Error(`Unexpected method ${method}`);
  } };
  return { host, store, calls, conflictOnce: () => { conflicts = 1; }, setFetch: (fn: typeof fetch) => { fetch = fn; }, rows: () => [...store.values()] };
}

describe("WordPress extension library manifests", () => {
  test("normalizes GitHub source identity, kinds, refs and folders", () => {
    expect(githubRepository("Team/Our-Forms.git")).toBe("https://github.com/team/our-forms");
    expect(extensionEntry({ ...entry(), ref: "release/one", path: "plugins/forms" })).toMatchObject({ kind: "plugin", ref: "release/one", path: "plugins/forms" });
    expect(extensionEntry({ ...entry(), kind: "theme" }).kind).toBe("theme");
    expect(rawManifestUrl(location)).toBe("https://raw.githubusercontent.com/team/catalog/release%2Fone/wordpress/plugins.json");
    for (const url of ["https://github.com.evil.test/team/repo", "https://user:secret@github.com/team/repo", "https://github.com/team/repo?token=secret", "file:///private", "https://github.com/team/repo/tree/main", "git@github.com:team/repo"]) expect(() => githubRepository(url)).toThrow();
    for (const path of ["../private", "/tmp/file", "a/../file", "a\\file", "%2e%2e/file", "a?token=x"]) expect(() => extensionEntry({ ...entry(), path })).toThrow();
  });
  test("rejects wrong schemas, invalid entries and oversized files instead of partial imports", () => {
    for (const input of ["oops", { schemaVersion: 2 }, { schemaVersion: 1, plugins: [] }, manifest([{ ...entry(), kind: "script" }]), manifest([{ ...entry(), slug: "../plugin" }]), manifest([], [{}]), manifest(Array(501).fill(entry()))]) expect(() => parseManifest(input)).toThrow();
    expect(() => parseManifest(" ".repeat(1024 * 1024 + 1))).toThrow("1 MiB");
  });
  test("resolves mixed and nested manifests with deduplicated reads", async () => {
    const seen: string[] = [];
    const result = await resolveManifest(manifest([entry()], [location, { ...location, name: "Same source" }]), async (source: { repositoryUrl: string }) => {
      seen.push(source.repositoryUrl);
      return manifest([entry("Theme", "theme")]);
    });
    expect(seen).toHaveLength(1);
    expect(result.repositories).toHaveLength(1);
    expect(result.manifests[0]!.snapshot!.repositories[0]!.kind).toBe("theme");
    expect(result.manifests[1]!.snapshot).toEqual(result.manifests[0]!.snapshot);
  });
  test("offline snapshots survive export and explicit refresh replaces their contents", async () => {
    const cached = manifest([], [{ ...location, snapshot: manifest([entry("Cached")]) }]);
    const result = await resolveManifest(cached, async () => { throw new Error("No network should be needed"); });
    expect(result.manifests[0]!.snapshot!.repositories[0]!.name).toBe("Cached");
    const fresh = await resolveManifest(cached, async () => manifest([entry("Updated")]), true);
    expect(fresh.manifests[0]!.snapshot!.repositories[0]!.name).toBe("Updated");
  });
  test("rejects circular, deep and excessive remote graphs", async () => {
    await expect(resolveManifest(manifest([], [location]), async () => manifest([], [location]))).rejects.toThrow("circular");
    const locs = Array.from({ length: 21 }, (_, index) => ({ ...location, path: `${index}.json` }));
    await expect(resolveManifest(manifest([], locs), async () => manifest())).rejects.toThrow("20 GitHub");
    let nested: any = manifest();
    for (let i = 0; i < 7; i++) nested = manifest([], [{ name: `Level ${i}`, snapshot: nested }]);
    expect(() => parseManifest(nested)).toThrow("five levels");
  });
});

describe("WordPress library operations and chat search", () => {
  test("save is idempotent, retries a revision conflict and reads back persisted data", async () => {
    const f = fixture(); f.conflictOnce();
    const saved = await libraryOperation(f.host, "library.save", { source: repoSource() });
    await libraryOperation(f.host, "library.save", { source: repoSource() });
    expect(f.rows()).toHaveLength(1);
    expect(saved.ids[0]).toMatch(/^extension-library:[a-f0-9]{64}$/);
    expect(f.calls.at(-1)?.method).toBe("catalog.read");
    expect(f.rows()[0].kind).toBe(LIBRARY_KIND);
  });
  test("mixes manual and manifest origins and removing one leaves shared entries", async () => {
    const f = fixture();
    const saved = await libraryOperation(f.host, "library.save", { source: repoSource("Manual name") });
    await libraryOperation(f.host, "library.save", { source: { v: 1, type: "manifest", source: { ...location, snapshot: manifest([entry("Manifest name"), entry("Theme", "theme")]) } } });
    const entries = libraryEntries(f.rows());
    expect(entries).toHaveLength(2);
    expect(entries.find(item => item.kind === "plugin")).toMatchObject({ name: "Manual name", origins: ["Manual name", "Shared collection"] });
    await libraryOperation(f.host, "library.remove", { id: saved.ids[0] });
    expect(libraryEntries(f.rows()).find(item => item.kind === "plugin")!.name).toBe("Manifest name");
    expect(f.rows()).toHaveLength(1);
  });
  test("export and import preserve individual repositories and nested manifest locations offline", async () => {
    const f = fixture();
    await libraryOperation(f.host, "library.save", { source: repoSource() });
    await libraryOperation(f.host, "library.save", { source: { v: 1, type: "manifest", source: { ...location, snapshot: manifest([], [{ name: "Nested", snapshot: manifest([entry("Theme", "theme")]) }]) } } });
    const exported = exportLibrary(f.rows());
    const restored = fixture();
    await libraryOperation(restored.host, "library.import", { manifest: exported });
    await libraryOperation(restored.host, "library.import", { manifest: exported });
    expect(exportLibrary(restored.rows())).toEqual(exported);
    expect(libraryEntries(restored.rows())).toEqual(libraryEntries(f.rows()));
    expect(restored.calls.some(call => call.method === "network.fetch")).toBe(false);
  });
  test("changing repository identity replaces just the selected source atomically", async () => {
    const f = fixture();
    const saved = await libraryOperation(f.host, "library.save", { source: repoSource() });
    const unrelated = { id: "pull:one", kind: "pull", title: "Download", data: { v: 1 } };
    f.store.set(unrelated.id, unrelated);
    await libraryOperation(f.host, "library.save", { source: { ...repoSource(), entry: { ...entry(), ref: "next" } }, replaceId: saved.ids[0] });
    expect(f.rows()).toHaveLength(2);
    expect(f.store.get(unrelated.id)).toEqual(unrelated);
    const change = f.calls.filter(call => call.method === "catalog.commit").at(-1)!.input;
    expect(change.deletes).toEqual(saved.ids);
    expect(change.records[0].data.entry.ref).toBe("next");
    expect(f.store.has(saved.ids[0])).toBe(false);
  });
  test("chat searches names, kinds, URLs and descriptions with deterministic pagination", async () => {
    const f = fixture();
    for (const name of ["Gamma", "Alpha", "Beta"]) await libraryOperation(f.host, "library.save", { source: { ...repoSource(name), entry: { ...entry(name), slug: name.toLowerCase() } } });
    const first = await libraryOperation(f.host, "library.search", { query: "builder", kind: "plugin", limit: 2 });
    expect(first.entries.map((item: { name: string }) => item.name)).toEqual(["Alpha", "Beta"]);
    expect(first.next).toBe(2);
    expect((await libraryOperation(f.host, "library.search", { offset: first.next, limit: 2 })).entries[0].name).toBe("Gamma");
    expect((await libraryOperation(f.host, "library.search", { kind: "theme" })).total).toBe(0);
  });
  test("network failures and invalid import trees leave the catalog unchanged", async () => {
    const f = fixture();
    f.setFetch(async () => ({ status: 404 }));
    await expect(libraryOperation(f.host, "library.resolve", { manifest: manifest([], [location]) })).rejects.toThrow("HTTP 404");
    await expect(libraryOperation(f.host, "library.import", { manifest: manifest([entry()], [location]) })).rejects.toThrow("Resolve every manifest");
    await expect(libraryOperation(f.host, "library.save", { source: { v: 1, type: "manifest", source: { ...location, snapshot: manifest([{ ...entry(), repositoryUrl: "https://evil.test/code" }]) } } })).rejects.toThrow();
    expect(f.calls.filter(call => call.method === "catalog.commit")).toHaveLength(0);
    expect(f.rows()).toHaveLength(0);
  });
  test("a refreshed manifest drops its removed entries without deleting a manual source", async () => {
    const f = fixture();
    await libraryOperation(f.host, "library.save", { source: repoSource() });
    const source = { v: 1, type: "manifest", source: { ...location, snapshot: manifest([entry("Theme", "theme")]) } };
    const saved = await libraryOperation(f.host, "library.save", { source });
    await libraryOperation(f.host, "library.save", { source: { ...source, source: { ...source.source, snapshot: manifest() } }, replaceId: saved.ids[0] });
    expect(libraryEntries(f.rows()).map(item => item.kind)).toEqual(["plugin"]);
  });
});

test("the packaged isolated worker speaks the host ticket protocol for save and search", async () => {
  const f = fixture();
  async function run(actionId: string, input: unknown) {
    const process = Bun.spawn([processExecutable(), "plugin/worker/extension-library.js"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    process.stdin.write(JSON.stringify({ protocolVersion: "1", run: { id: "library-test" }, action: { id: actionId }, input, grants: { catalog: { ticket: "one-use-ticket" } } }) + "\n");
    let buffer = "", output: any;
    for await (const chunk of process.stdout) {
      buffer += new TextDecoder().decode(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const response = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (response.kind === "host-call") {
          expect(response.input.ticket).toBe("one-use-ticket");
          const result = await f.host.call(response.method, response.input);
          process.stdin.write(JSON.stringify({ kind: "host-response", requestId: response.requestId, ok: true, result, nextTicket: "one-use-ticket" }) + "\n");
        } else output = response;
      }
    }
    expect(await process.exited).toBe(0);
    expect(await new Response(process.stderr).text()).toBe("");
    expect(output).toMatchObject({ protocolVersion: "1", runId: "library-test", ok: true });
    return output.output;
  }
  const saved = await run("library.save", { source: repoSource() });
  expect(saved.saved).toBe(1);
  const search = await run("library.search", { query: "forms" });
  expect(search.entries[0]).toMatchObject({ name: "Our forms", repositoryUrl: "https://github.com/team/our-forms" });
  expect(search.total).toBe(1);
});
function processExecutable() { return process.execPath; }
