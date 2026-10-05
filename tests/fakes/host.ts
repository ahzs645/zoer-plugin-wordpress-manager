/**
 * In-process fake of the Zoer host services the plugin transfer engine calls: S7b endpoint
 * `network.fetch` (route prefix, generation), S2 file sets (in memory, block digests at seal),
 * S3 transfers (chunk downloads, ZBT1/chunk uploads, runtime peers), the plugin catalog, S8/S9
 * runtime operations on a fake DDEV bridge (with emulated command bundles), S5 route assignment
 * and `run.progress`. The parity harness swaps in Zoer's real S2/S3 implementations.
 */
import { createHash } from "node:crypto";
import { runTransferAction } from "../../plugin/worker/lib/actions.js";
import { BLOCK, blockDigests, blocksRoot, FakeZoerConnect, sha, type FakeResponse } from "./zoer-connect";
import { DDEV_OPERATION_SCHEMAS, schemaIssues } from "./ddev-schemas";
import { readZip } from "./zip";

export class FakeHostError extends Error {
  name = "HostCallError";
  constructor(message: string, readonly code: string) { super(message); }
}
const refuse = (message: string, code: string): never => { throw new FakeHostError(message, code); };

// ---------------------------------------------------------------------------------------------
// File sets
// ---------------------------------------------------------------------------------------------

type Entry = { path: string; bytes: number; sha256: string; digestFormat?: string; sourceSha256?: string; state: "pending" | "partial" | "complete"; received: number; data: Buffer; blocks?: string[] };
type StoredSet = { id: string; name: string; status: "open" | "sealed"; rules?: string; labels?: Record<string, string>; retain: boolean; entries: Entry[]; blockDigests?: "ready" };
export class FakeFileSets {
  readonly sets = new Map<string, StoredSet>();
  private n = 0;
  summary(set: StoredSet) { const { entries, ...rest } = set; return { ...rest, entryCount: entries.length, totalBytes: entries.reduce((s, e) => s + e.bytes, 0) }; }
  get(id: string) { const set = this.sets.get(id); if (!set) refuse("File set not found.", "fileset_not_found"); return set!; }
  private declare(entries: any[], existing: Entry[]) {
    const seen = new Set(existing.map(e => e.path.toLowerCase()));
    return entries.map((e: any) => {
      if (typeof e.path !== "string" || seen.has(e.path.toLowerCase()) || e.path.split("/").some((p: string) => !p || p === "..")) refuse(`Duplicate or unsafe path ${e.path}.`, "fileset_rules");
      seen.add(e.path.toLowerCase());
      return { path: e.path, bytes: e.bytes, sha256: e.sha256, ...(e.digestFormat ? { digestFormat: e.digestFormat } : {}), state: e.bytes === 0 ? "pending" : "pending", received: 0, data: Buffer.alloc(0) } as Entry;
    });
  }
  create(input: any) {
    const id = input.setId ?? `fs_${(++this.n).toString(16).padStart(32, "0")}`;
    const existing = this.sets.get(id);
    if (existing) return { set: this.summary(existing) };
    const set: StoredSet = { id, name: input.name, status: "open", rules: input.rules, labels: input.labels, retain: input.retain === true, entries: this.declare(input.entries, []) };
    this.sets.set(id, set);
    return { set: this.summary(set) };
  }
  extend(input: any) { const set = this.get(input.setId); if (set.status !== "open") refuse("sealed", "fileset_sealed"); set.entries.push(...this.declare(input.entries, set.entries)); return { set: this.summary(set) }; }
  describe(input: any) {
    const set = this.get(input.setId); const offset = input.offset ?? 0, limit = input.limit ?? 500;
    if (input.includeBlocks && set.status !== "sealed") refuse("Block digests exist only for sealed file sets.", "fileset_integrity");
    const entries = set.entries.slice(offset, offset + limit).map(({ data: _d, blocks, ...e }) => ({ ...e, ...(input.includeBlocks ? { blockSha256: blocks } : {}) }));
    return { set: this.summary(set), entries, next: offset + entries.length < set.entries.length ? offset + entries.length : null };
  }
  list(input: any) { return { sets: [...this.sets.values()].filter(s => !input.label || s.labels?.[input.label.key] === input.label.value).map(s => this.summary(s)) }; }
  read(input: any) { const set = this.get(input.setId); const e = set.entries.find(x => x.path === input.path); if (!e || e.state !== "complete") refuse("Not complete.", "fileset_integrity"); const data = e!.data.subarray(input.offset ?? 0, (input.offset ?? 0) + input.maxBytes); return { dataBase64: data.toString("base64"), bytes: data.length, eof: (input.offset ?? 0) + data.length >= e!.bytes }; }
  seal(input: any) {
    const set = this.get(input.setId);
    if (set.status === "sealed") return { set: this.summary(set) };
    for (const e of set.entries) {
      if (e.bytes === 0) { e.state = "complete"; e.received = 0; }
      if (e.state !== "complete") refuse(`File set is incomplete: ${e.path}.`, "fileset_integrity");
      if (sha(e.data) !== e.sha256) refuse(`${e.path} changed on disk.`, "fileset_integrity");
      e.blocks = blockDigests(e.data);
    }
    set.status = "sealed"; set.blockDigests = "ready";
    return { set: this.summary(set) };
  }
  delete(input: any) { return { deleted: this.sets.delete(input.setId) }; }
  /** Test helper: a sealed set from path → bytes. */
  sealed(name: string, files: Record<string, string | Buffer>, labels?: Record<string, string>) {
    const { set } = this.create({ name, labels, entries: Object.entries(files).map(([path, raw]) => ({ path, bytes: Buffer.from(raw).length, sha256: sha(Buffer.from(raw)) })) });
    for (const e of this.sets.get(set.id)!.entries) { const raw = Buffer.from(files[e.path]!); e.data = raw; e.received = raw.length; e.state = "complete"; }
    this.seal({ setId: set.id });
    return set.id as string;
  }
}

// ---------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------

export class FakeCatalog {
  readonly records = new Map<string, any>();
  revision = 0;
  read(input: any) {
    if (Array.isArray(input.ids)) return { revision: this.revision, records: input.ids.map((id: string) => this.records.get(id)).filter(Boolean), next: null };
    const rows = [...this.records.values()].filter(r => input.kind === undefined || r.kind === input.kind).sort((a, b) => a.id.localeCompare(b.id)).filter(r => r.id > String(input.after ?? ""));
    const page = rows.slice(0, input.limit ?? 100);
    return { revision: this.revision, records: page, next: page.length && rows.length > page.length ? page.at(-1).id : null };
  }
  commit(input: any) {
    if (input.revision !== this.revision) return { conflict: true, revision: this.revision };
    for (const r of input.records ?? []) { if (JSON.stringify(r.data).length > 300000) refuse("Catalog record exceeds 300,000 characters.", "catalog_limit"); this.records.set(r.id, structuredClone(r)); }
    for (const id of input.deletes ?? []) this.records.delete(id);
    return { revision: ++this.revision, saved: (input.records ?? []).length };
  }
  engine(siteId: string, engine = "plugin", testTarget = true) {
    this.records.set(`site-engine:${siteId}`, { id: `site-engine:${siteId}`, kind: "site-engine", title: siteId, data: { v: 1, siteId, engine, testTarget, updatedAt: "2026-10-04T00:00:00Z" } });
  }
}

// ---------------------------------------------------------------------------------------------
// DDEV bridge and command bundles (emulated)
// ---------------------------------------------------------------------------------------------

type DdevSite = { id: string; name: string; status: string; state: "active" | "archived"; files: Map<string, Buffer>; database: Buffer | null; home: string | null; stage: Map<string, Map<string, Buffer>>; pending: Set<string>; backups: number; content?: FakeZoerConnect; inspections: number };
export class FakeDdev {
  readonly sites = new Map<string, DdevSite>();
  readonly commands: Array<{ command: string; resourceId: string; plan: any }> = [];
  failCommand?: { command: string; message: string; count: number };
  add(id: string, name: string, content?: FakeZoerConnect, status = "running") {
    this.sites.set(id, { id, name, status, state: "active", files: new Map(), database: null, home: null, stage: new Map(), pending: new Set(), backups: 0, content, inspections: 0 });
  }
  site(id: string) { const s = this.sites.get(id); if (!s) refuse("Runtime resource is unavailable or outside this grant.", "resource_unbound"); return s!; }
  /** Forced refusals of the next calls of one operation (code as Zoer reports it). */
  failOperation?: { operation: string; message: string; code: string; count: number };
  /** Every args object the bridge operations received, in order (after the schema check). */
  readonly invocations: Array<{ operation: string; args: any }> = [];
  invoke(input: any) {
    const args = input.args ?? {};
    // Zoer checks args against the connector's input schema before the driver runs.
    const schema = DDEV_OPERATION_SCHEMAS[input.operation];
    const issues = schema ? schemaIssues(schema, args) : [];
    if (issues.length) refuse(`Runtime operation args are invalid: ${issues.join("; ")}`, "invalid_request");
    this.invocations.push({ operation: input.operation, args });
    const forced = this.failOperation;
    if (forced && forced.operation === input.operation && forced.count-- > 0) refuse(forced.message, forced.code);
    switch (input.operation) {
      case "runtime.list.v1": return { resources: [...this.sites.values()].filter(s => s.state === "active").map(s => ({ id: s.id, name: s.name, status: s.status, connectorId: "ddev", state: s.state })) };
      case "runtime.inspect.v1": { const s = this.site(input.resourceId); if (s.status === "starting" && ++s.inspections > 1) s.status = "running"; return { resource: { id: s.id, name: s.name, status: s.status, connectorId: "ddev", state: s.state } }; }
      case "runtime.create.v1": { const id = `ddev-${String(args.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`; this.add(id, args.name, undefined, "starting"); return { resource: { id, name: args.name, status: "starting", connectorId: "ddev", ownerPluginId: "wordpress-manager" } }; }
      case "runtime.archive.v1": { const s = this.site(input.resourceId); s.state = "archived"; return { archived: true, archivedAt: "2026-10-04T00:00:00Z", scheduledPurgeAt: "2026-10-11T00:00:00Z", recovery: "" }; }
      case "backup.create.v1": { const s = this.site(input.resourceId); s.backups++; return { backup: { id: `backup-${s.backups}` } }; }
      case "export.create.v1": {
        // Zoer's driver sends the site's DDEV router address when no sourceUrl is given; the
        // bridge refuses it (a port), and Zoer reports the driver's plain Error under this code.
        const sourceUrl = args.sourceUrl ?? `https://${this.site(input.resourceId).name}.ddev.site:8443`;
        if (new URL(sourceUrl).port) refuse("Invalid source URL.", "database_query_failed");
        if (typeof args.database !== "boolean" && (typeof args.database !== "object" || args.database === null)) refuse("Invalid export selections.", "database_query_failed");
        this.exportSources.set(args.clientId, sourceUrl);
        this.contentOf(input.resourceId).handle({ method: "POST", path: "/exports", body: Buffer.from(JSON.stringify(args)) });
        return this.bridgeJob(JSON.parse(this.contentOf(input.resourceId).handle({ method: "POST", path: `/exports/${args.clientId}/step`, body: Buffer.alloc(0) }).body.toString()).job);
      }
      case "export.step.v1": return this.bridgeJob(JSON.parse(this.contentOf(input.resourceId).handle({ method: "POST", path: `/exports/${args.exportId}/step` }).body.toString()).job);
      case "export.cancel.v1": return JSON.parse(this.contentOf(input.resourceId).handle({ method: "DELETE", path: `/exports/${args.exportId}` }).body.toString());
      case "files.stage.v1": {
        const s = this.site(input.resourceId); const stage = s.stage.get(args.copyId);
        if (!stage || !s.pending.has(args.copyId)) refuse("Private copy batch failed verification.", "execution_failed");
        for (const span of args.spans) {
          const data = Buffer.from(span.data, "base64");
          if (sha(data) !== span.sha256) refuse("Private copy batch failed verification.", "execution_failed");
          const current = stage!.get(String(span.index)) ?? Buffer.alloc(0);
          if (current.length < span.offset) refuse("Private copy batch failed verification.", "execution_failed");
          stage!.set(String(span.index), Buffer.concat([current.subarray(0, span.offset), data]));
        }
        return { ok: true };
      }
      case "runtime.exec.v1": return this.exec(input.resourceId, args);
      default: return refuse("Runtime connector action is unavailable.", "capability_denied");
    }
  }
  /** Source URL each bridge export was created with (the bridge echoes it as `source.url`). */
  readonly exportSources = new Map<string, string>();
  private bridgeJob(job: any) { return job?.source ? { ...job, source: { ...job.source, url: this.exportSources.get(job.id) ?? job.source.url } } : job; }
  private contentOf(id: string) { const content = this.site(id).content; if (!content) refuse("No content.", "invalid_request"); return content!; }
  /** Bridge export chunk (runtime peer of `export.chunk.v1`). */
  exportChunk(id: string, args: any): FakeResponse { return this.contentOf(id).handle({ method: "GET", path: `/exports/${args.exportId}/chunks?index=${args.index}&offset=${args.offset}` }); }
  private exec(resourceId: string, args: any) {
    const s = this.site(resourceId);
    const plan = JSON.parse(args.files.find((f: any) => f.name === "plan.json").text);
    this.commands.push({ command: args.command, resourceId, plan });
    const fail = (message: string) => refuse(`Computer command ${args.command} exited with code 1. ZOER_ERROR: ${message}`, "execution_failed");
    const failing = this.failCommand;
    if (failing && failing.command === args.command && failing.count-- > 0) fail(failing.message);
    const stage = s.stage.get(plan.id);
    const tail = (value: unknown) => ({ command: args.command, resourceId, exitCode: 0, durationMs: 1, inputs: [], outputs: [{ name: "result.json", present: false }], stdoutTail: JSON.stringify(value) + "\n", stderrTail: "" });
    switch (args.command) {
      case "wordpress.copy.prepare": if (!stage) s.stage.set(plan.id, new Map()); s.pending.add(plan.id); return tail({ ok: true });
      case "wordpress.copy.database": {
        const db = stage?.get(String(plan.databaseIndex));
        if (!db || sha(db) !== plan.databaseSha256) fail("Local copy operation failed.");
        s.database = Buffer.from(db!.toString("utf8").replaceAll(plan.sourceUrl, plan.targetUrl));
        return tail({ ok: true, database: "ready" });
      }
      case "wordpress.copy.files": {
        const files = plan.fromPrepared ? JSON.parse(stage!.get("prepared.json")!.toString()).files.filter((f: any) => f.path !== "database.sql").slice(plan.offset, plan.offset + plan.limit) : plan.files;
        for (const f of files) {
          const data = f.bytes === 0 && f.sha256 === sha("") ? Buffer.alloc(0) : stage?.get(f.source);
          if (!data || sha(data) !== f.sha256) fail("Local copy operation failed.");
          s.files.set(f.path, data!);
        }
        return tail({ ok: true, placed: files.length });
      }
      case "wordpress.copy.finish": if (!s.pending.has(plan.id)) fail("Local website verification failed."); s.home = plan.targetUrl; s.pending.delete(plan.id); return tail({ ok: true, http: 200 });
      case "wordpress.updraft.prepare": {
        const byComponent = Object.fromEntries(plan.components.map((c: any) => [c.component, stage!.get(c.source)!]));
        for (const c of plan.components) if (!byComponent[c.component] || sha(byComponent[c.component]) !== c.sha256) fail("Upload failed its SHA-256 or size check.");
        const db = Buffer.from(`-- Zoer Connect database snapshot\n-- from ${createHash("sha256").update(byComponent.database).digest("hex")}\n`);
        stage!.set("extracted/database.sql", db);
        const files = [{ path: "database.sql", source: "extracted/database.sql", bytes: db.length, sha256: sha(db) }];
        for (const component of ["plugins", "themes", "uploads", "others"]) for (const entry of readZip(byComponent[component])) {
          if (entry.path.endsWith("/")) continue;
          const source = `extracted/${files.length}`, data = entry.data();
          stage!.set(source, data); files.push({ path: `wp-content/${entry.path}`, source, bytes: data.length, sha256: sha(data) });
        }
        stage!.set("prepared.json", Buffer.from(JSON.stringify({ files })));
        return tail({ metadata: { prefix: "wp_", sourceUrl: "http://backup.local", wordpressVersion: "6.9.4", tables: 4, activePlugins: true }, warnings: ["Restored plugins start inactive. Review and activate the required plugins before publication."], fileCount: files.length, databaseSha256: sha(db) });
      }
      default: return fail("Unknown command.");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The world: endpoints, services, and the slice driver
// ---------------------------------------------------------------------------------------------

export type Endpoint = { id: string; origin: string; label: string; generation: string; site: FakeZoerConnect };
type TransferState = { cursor: { index: number; offset: number }; complete: boolean; requests: number; rawBytes: number; wireBytes: number; unverifiable: Set<number>; synced?: boolean; phase?: string };

export class FakeWorld {
  readonly endpoints = new Map<string, Endpoint>();
  readonly sets = new FakeFileSets();
  readonly catalog = new FakeCatalog();
  readonly ddev = new FakeDdev();
  readonly transfers = new Map<string, TransferState>();
  readonly calls: Array<{ method: string; input: any }> = [];
  /** Optional overrides (the parity harness plugs Zoer's real S2/S3 here). */
  services: Partial<Record<string, (input: any, context: { actionId: string; runId: string; effect: string; execution: number }) => Promise<any> | any>> = {};
  networkRequests = 0;
  /** Called with every slice envelope (the harness checks them with Zoer's own parser). */
  envelopeCheck?: (envelope: unknown, actionId: string) => void;
  /**
   * Zoer's pause notice (user pause, cancel or drain). While set, every host response carries it
   * and calls that start external work are refused with `ZOER_PAUSED`, like the real runner.
   */
  pause: { reason: "maintenance"; graceSeconds: number; drainId?: string } | null = null;
  addSite(id: string, site: FakeZoerConnect, generation = "g1") { this.endpoints.set(id, { id, origin: site.options.origin, label: id, generation, site }); return site; }
  rotateKey(id: string) { const e = this.endpoints.get(id)!; e.generation = e.generation + "x"; }

  request(actionId: string, input: any, runId = "run-1", resumable?: any) {
    return {
      protocolVersion: "1", action: { id: actionId }, input, run: { id: runId },
      grants: { network: { ticket: "n0", endpoints: [{ alias: "site", endpoints: [...this.endpoints.values()].map(({ site: _s, ...e }) => e) }] }, filesets: { ticket: "f0" }, catalog: { ticket: "c0" }, routes: { ticket: "r0" }, runtimes: [{ alias: "wordpress_site", ticket: "w0" }] },
      ...(resumable ? { resumable } : {}),
    };
  }

  host(actionId: string, runId: string, effect: string, execution: number) {
    const world = this;
    return {
      get pauseRequested() { return world.pause; },
      call: async (method: string, input: any = {}) => {
        this.calls.push({ method, input });
        if (this.pause && ["network.fetch", "runtime.invoke"].includes(method)) refuse("Paused for Zoer update", "ZOER_PAUSED");
        const service = this.services[method];
        if (service) return service(input, { actionId, runId, effect, execution });
        return this.serve(method, input, effect);
      },
    };
  }

  private fetchPeer(peer: any, method: string, query: Record<string, string | number>, body?: Buffer, contentType?: string): FakeResponse {
    if (peer.runtime) {
      if (peer.runtime.operation === "export.chunk.v1") return this.ddev.exportChunk(peer.runtime.resourceId, { ...peer.runtime.args, ...query });
      throw new Error("unsupported runtime peer in fake GET");
    }
    const endpoint = this.endpoints.get(peer.endpoint.endpointId);
    if (!endpoint) refuse("Endpoint removed.", "endpoint_unbound");
    if (peer.endpoint.generation && peer.endpoint.generation !== endpoint!.generation) refuse("The endpoint connection changed.", "endpoint_changed");
    this.networkRequests++;
    const [path, search = ""] = String(peer.path).split("?");
    const params = new URLSearchParams(search); for (const [k, v] of Object.entries(query)) params.set(k, String(v));
    const q = params.toString();
    return endpoint!.site.handle({ method, path: `/${path}${q ? `?${q}` : ""}`, body, contentType });
  }

  async serve(method: string, input: any, effect: string): Promise<any> {
    switch (method) {
      case "run.progress": return { ok: true };
      case "network.fetch": {
        const endpoint = this.endpoints.get(input.auth?.endpointId);
        if (!endpoint) return refuse("Endpoint removed.", "endpoint_unbound");
        if (input.auth.generation && input.auth.generation !== endpoint.generation) return refuse("The endpoint connection changed.", "endpoint_changed");
        const prefix = `${endpoint.origin}/wp-json/zoer-connect/v1`;
        if (!String(input.url).startsWith(prefix)) return refuse("Route denied.", "endpoint_route_denied");
        if (/^\/imports/.test(String(input.url).slice(prefix.length)) && !["external_write", "destructive"].includes(effect)) return refuse("Route effect exceeds the action effect.", "endpoint_route_denied");
        this.networkRequests++;
        const response = endpoint.site.handle({ method: input.method, path: String(input.url).slice(prefix.length), body: input.bodyBase64 ? Buffer.from(input.bodyBase64, "base64") : undefined, contentType: input.headers?.["content-type"] });
        return { status: response.status, headers: response.headers, bodyBase64: response.body.toString("base64") };
      }
      case "fileset.create": if (effect !== "local_write") refuse("File set writes require a local-write action.", "capability_denied"); return this.sets.create(input);
      case "fileset.extend": return this.sets.extend(input);
      case "fileset.describe": return this.sets.describe(input);
      case "fileset.list": return this.sets.list(input);
      case "fileset.read": return this.sets.read(input);
      case "fileset.seal": return this.sets.seal(input);
      case "fileset.delete": return this.sets.delete(input);
      case "catalog.read": return this.catalog.read(input);
      case "catalog.commit": if (effect !== "local_write") refuse("Catalog writes require a local-write action.", "capability_denied"); return this.catalog.commit(input);
      case "runtime.invoke": return this.ddev.invoke(input);
      case "routes.assign": return { route: { id: `route-${input.resourceId}`, url: `https://${input.resourceId.replace(/^ddev-/, "")}.wp.example/`, subdomain: input.resourceId, displayName: input.name } };
      case "archive.inspect": {
        const set = this.sets.get(input.source.setId); const entry = set.entries.find(e => e.path === input.source.path)!;
        const entries = readZip(entry.data).map(e => ({ path: e.path, bytes: e.bytes, compressedBytes: e.compressedBytes, kind: e.path.endsWith("/") ? "dir" : ((e.mode & 0o170000) === 0o120000 ? "symlink" : "file") }));
        return { format: "zip", entries, totals: { entries: entries.length, bytes: entries.reduce((s, e) => s + e.bytes, 0), compressedBytes: 0 }, flags: { zip64: false, encrypted: false, symlinks: entries.some(e => e.kind === "symlink"), traversal: entries.some(e => e.path.split("/").includes("..")), absolute: entries.some(e => e.path.startsWith("/")) } };
      }
      case "transfer.download": return this.download(input);
      case "transfer.upload": return this.upload(input);
      default: return refuse(`Unknown host method ${method}.`, "invalid_host_call");
    }
  }

  private download(input: any) {
    const set = this.sets.get(input.setId);
    const state = this.transfers.get(input.transferId) ?? { cursor: { index: 0, offset: 0 }, complete: false, requests: 0, rawBytes: 0, wireBytes: 0, unverifiable: new Set<number>() };
    this.transfers.set(input.transferId, state);
    let appended = 0; const completed: number[] = [];
    for (let calls = 0; calls < (input.maxChunks ?? 8) && state.cursor.index < set.entries.length; calls++) {
      const entry = set.entries[state.cursor.index]!;
      const response = this.fetchPeer(input.source, "GET", { index: state.cursor.index, offset: state.cursor.offset });
      state.requests++;
      if (response.status >= 500 || response.status === 429) return { cursor: { ...state.cursor }, appendedBytes: appended, completedEntries: completed, complete: false, retryAfterMs: 1000, transient: { code: "transfer_transient", message: "The peer is busy." } };
      if (response.status !== 200) refuse("The peer refused the request.", "transfer_rejected");
      const body = JSON.parse(response.body.toString());
      const chunks = input.protocol === "chunk-batch-json-v1" ? body.chunks : [body];
      for (const chunk of chunks) {
        const current = set.entries[state.cursor.index]!;
        const data = Buffer.from(chunk.data, "base64");
        if (chunk.index !== state.cursor.index || chunk.offset !== state.cursor.offset || sha(data) !== chunk.sha256) refuse("Chunk mismatch.", "transfer_integrity");
        current.data = Buffer.concat([current.data, data]); current.received = current.data.length; appended += data.length; state.cursor.offset += data.length;
        if (current.received >= current.bytes) {
          const plain = sha(current.data);
          const expected = current.digestFormat === "sha256-blocks-v1" ? blocksRoot(current.data) : plain;
          if (expected !== current.sha256) { current.data = Buffer.alloc(0); current.received = 0; state.cursor.offset = 0; refuse("Export file integrity check failed.", "transfer_integrity"); }
          if (current.digestFormat) { current.sourceSha256 = current.sha256; current.sha256 = plain; delete current.digestFormat; }
          current.state = "complete"; completed.push(state.cursor.index); state.cursor = { index: state.cursor.index + 1, offset: 0 };
        }
      }
      void entry;
    }
    state.complete = state.cursor.index >= set.entries.length;
    return { cursor: { ...state.cursor }, appendedBytes: appended, completedEntries: completed, complete: state.complete };
  }

  private upload(input: any) {
    const set = this.sets.get(input.setId);
    if (set.status !== "sealed") refuse("Seal the file set before uploading it.", "transfer_rejected");
    const order: number[] = input.order ?? set.entries.map((_e, i) => i);
    const files = order.map(i => set.entries[i]!);
    let state = this.transfers.get(input.transferId);
    if (!state) { state = { cursor: { index: 0, offset: 0 }, complete: false, requests: 0, rawBytes: 0, wireBytes: 0, unverifiable: new Set() }; this.transfers.set(input.transferId, state); }
    const result = (extra: object = {}) => ({ cursor: { ...state!.cursor }, complete: state!.complete, phase: state!.phase, transport: "octet-stream", batchBytes: BLOCK * 4, ceiling: null, requests: state!.requests, wireBytes: state!.wireBytes, rawBytes: state!.rawBytes, ...extra });
    if (state.complete) return result();
    if (input.resync && !state.synced) {
      const response = this.fetchPeer(input.resync, "GET", {});
      const view = JSON.parse(response.body.toString()); state.cursor = view.cursor; state.phase = view.phase; state.synced = true;
      if (view.phase !== "uploading") { state.complete = true; return result(); }
    }
    while (files[state.cursor.index]?.bytes === 0) state.cursor = { index: state.cursor.index + 1, offset: 0 };
    if (state.cursor.index >= files.length) { state.complete = true; state.phase ??= "uploading"; return result(); }
    const maxBytes = input.protocol === "chunks-json-v1" || state.unverifiable.has(state.cursor.index) ? BLOCK : Math.min(input.remote?.limits?.maxBatchBytes ?? 1024 * 1024, 1024 * 1024);
    const spans: { index: number; offset: number; data: Buffer }[] = []; let total = 0;
    let index = state.cursor.index, offset = state.cursor.offset;
    while (index < files.length && total < maxBytes) {
      const file = files[index]!;
      if (file.bytes === 0) { index++; offset = 0; continue; }
      if (spans.length && state.unverifiable.has(index)) break;
      const length = Math.min(BLOCK, file.bytes - offset, maxBytes - total);
      spans.push({ index, offset, data: file.data.subarray(offset, offset + length) }); total += length; offset += length;
      if (offset >= file.bytes) { index++; offset = 0; }
      if (state.unverifiable.has(spans[0]!.index)) break;
    }
    state.requests++; state.rawBytes += total;
    const chunked = input.protocol === "chunks-json-v1" || state.unverifiable.has(spans[0]!.index);
    if (input.target.runtime) {
      if (input.target.runtime.operation !== "files.stage.v1") refuse("unsupported runtime peer", "transfer_rejected");
      this.ddev.invoke({ operation: "files.stage.v1", resourceId: input.target.runtime.resourceId, args: { ...input.target.runtime.args, spans: spans.map(s => ({ index: s.index, offset: s.offset, data: s.data.toString("base64"), sha256: sha(s.data) })) } });
      const last = spans.at(-1)!; const end = last.offset + last.data.length;
      state.cursor = end >= files[last.index]!.bytes ? { index: last.index + 1, offset: 0 } : { index: last.index, offset: end };
    } else if (chunked) {
      const span = spans[0]!;
      const peer = input.protocol === "chunks-json-v1" ? input.target : input.chunks;
      const response = this.fetchPeer(peer, "POST", {}, Buffer.from(JSON.stringify({ index: span.index, offset: span.offset, data: span.data.toString("base64") })), "application/json");
      if (response.status >= 500) return result({ transient: { code: "transfer_transient", message: "busy" }, retryAfterMs: 1000 });
      const end = span.offset + span.data.length;
      state.cursor = end >= files[span.index]!.bytes ? { index: span.index + 1, offset: 0 } : { index: span.index, offset: end };
    } else {
      const header = Buffer.from(JSON.stringify({ v: 1, spans: spans.map(s => [s.index, s.offset, s.data.length]), payloadBytes: total, enc: null }));
      const prefix = Buffer.alloc(8); prefix.write("ZBT1", 0, "latin1"); prefix.writeUInt32BE(header.length, 4);
      const body = Buffer.concat([prefix, header, ...spans.map(s => s.data)]);
      state.wireBytes += body.length;
      const response = this.fetchPeer(input.target, "POST", {}, body, "application/octet-stream");
      if (response.status >= 500 || response.status === 429) return result({ transient: { code: "transfer_transient", message: "The peer is busy." }, retryAfterMs: 1000 });
      const answer = JSON.parse(response.body.toString());
      if (answer.rejected?.code === "unverifiable") { state.unverifiable.add(spans[answer.rejected.span].index); return result({ rejected: answer.rejected }); }
      if (answer.rejected?.code === "digest_mismatch") refuse("The peer rejected a block's digest.", "transfer_integrity");
      state.cursor = answer.cursor; state.phase = answer.phase;
      if (answer.complete) state.complete = true;
    }
    if (state.cursor.index >= files.length) { state.complete = true; state.phase ??= "uploading"; }
    return result();
  }

  /** Runs one action through its slices like the S1 dispatcher (continue/retry loop; stops at needs-user, done or failure). */
  /**
   * `clock` replaces Date.now for the worker (and the slice deadline); `deadlineMs` is the time
   * each slice gets (default 300 s, the pull's `stepTimeoutMs`).
   */
  async run(actionId: string, input: any, options: { runId?: string; effect?: string; maxSlices?: number; checkpoint?: any; step?: number; cancelling?: boolean; clock?: () => number; deadlineMs?: number; onSlice?: (envelope: any, slice: number) => void | Promise<void> } = {}) {
    const clock = options.clock ?? Date.now;
    const effect = options.effect ?? ({ "transfer.push": "external_write", "transfer.replace": "external_write", "transfer.push.control": "external_write" } as Record<string, string>)[actionId] ?? "local_write";
    let checkpoint = options.checkpoint ?? null;
    const envelopes: any[] = [];
    const resumable = actionId !== "transfer.push.control";
    // Zoer's consecutive retry count (`attempt`); the run fails after `maxConsecutive` (default 8).
    let failures = 0;
    for (let slice = options.step ?? 1; slice <= (options.maxSlices ?? 200); slice++) {
      const request = this.request(actionId, input, options.runId ?? "run-1", resumable ? { step: slice, checkpoint, attempt: failures, deadlineAt: new Date(clock() + (options.deadlineMs ?? 300_000)).toISOString(), ...(options.cancelling ? { cancelling: true } : {}) } : undefined);
      let envelope: any;
      try { envelope = await runTransferAction(request, this.host(actionId, request.run.id, effect, slice), clock); }
      catch (error) { return { status: "failed" as const, error: error as Error & { code?: string }, envelopes, checkpoint }; }
      envelopes.push(envelope);
      if (resumable) this.envelopeCheck?.(envelope, actionId);
      await options.onSlice?.(envelope, slice);
      if (!resumable) return { status: "succeeded" as const, output: envelope, envelopes, checkpoint };
      if (envelope.paused) { checkpoint = envelope.checkpoint; continue; }
      if (envelope.resumable === "continue") { checkpoint = envelope.checkpoint; failures = 0; continue; }
      if (envelope.resumable === "retry") {
        if (envelope.checkpoint !== undefined) checkpoint = envelope.checkpoint;
        if (++failures > 8) return { status: "failed" as const, error: Object.assign(new Error(`${envelope.error.message} (gave up after ${failures} consecutive failures)`), { code: envelope.error.code }), envelopes, checkpoint };
        // The S1 dispatcher waits max(backoff, Retry-After) before the next slice.
        await new Promise(done => setTimeout(done, Math.min(envelope.retryAfterMs ?? 0, 2_000)));
        continue;
      }
      if (envelope.resumable === "needs-user") return { status: "needs-user" as const, reason: envelope.reason, envelopes, checkpoint: envelope.checkpoint };
      if (envelope.resumable === "done") return { status: "succeeded" as const, output: envelope.output, envelopes, checkpoint };
      throw new Error(`Unexpected envelope ${JSON.stringify(envelope)}`);
    }
    return { status: "running" as const, envelopes, checkpoint };
  }
}
