/**
 * In-process fake of a WordPress site running Zoer Connect (the `/wp-json/zoer-connect/v1` API
 * both transfer engines speak): status, exports (whole and paged manifests, chunk and batch
 * reads, 256 KiB block digests), file comparison, and imports (manifest, ZBT1 batches with block
 * verification, chunk uploads, upload view, step/review/approve/finish/rollback/cleanup).
 * Deterministic; records every request in order. Used by the plugin tests and the parity harness
 * (tools/parity/transfers.ts), never as a network server.
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const BLOCK = 262144;
export const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
export function blockDigests(data: Uint8Array): string[] {
  const out: string[] = [];
  for (let at = 0; at < data.length; at += BLOCK) out.push(sha(data.subarray(at, Math.min(data.length, at + BLOCK))));
  return out;
}
export function blocksRoot(data: Uint8Array) {
  const root = createHash("sha256");
  for (const digest of blockDigests(data)) root.update(Buffer.from(digest, "hex"));
  return root.digest("hex");
}

export type FakeRequest = { method: string; path: string; body?: Buffer; contentType?: string };
export type FakeResponse = { status: number; headers: Record<string, string>; body: Buffer };
export type LogEntry = { method: string; route: string; body?: string };

type ExportJob = { id: string; input: any; paged: boolean; steps: number; status: "preparing" | "ready" | "cancelled"; files: { path: string; bytes: number; sha256: string; digestFormat?: "sha256-blocks-v1"; data: Buffer }[] };
type ImportJob = { id: string; manifest: any; phase: string; spans: Buffer[]; sizes: number[]; blocks: (string[] | undefined)[]; offsets: number[]; review: boolean; stepped: number; cleanedUp: boolean; rollbackRefused?: boolean;
  /** Rollback cursor and the site before activation (restored when the rollback ends). */
  cursor: number; before?: { site: Map<string, Buffer>; database: Buffer | null }; cleanupCalls?: number; requests: Record<string, number> };

export interface FakeSiteOptions {
  origin: string;
  /** Site content: path → bytes (`database.sql` is the database snapshot). */
  files: Record<string, string | Buffer>;
  /** Paths already on the destination with their bytes (comparison and push destination). */
  existing?: Record<string, string | Buffer>;
  blocked?: string[];
  capabilities?: Record<string, boolean>;
  migrationMode?: "shared-replacement" | "verified-workers";
  pagedExport?: boolean;
  /** Paged manifest page size (Zoer Connect uses 500). */
  pageSize?: number;
  /** Export steps before "ready". */
  exportSteps?: number;
  /** Tables the destination has (GET /diagnostics). */
  tables?: string[];
  /** The first import step fails like Zoer Connect's scan of a database with missing tables. */
  refuseImport?: { phase: string; message: string };
  /** Tables an import stages (rollback walks them; Zoer Connect: one per source table). */
  importTables?: number;
  /** POST /imports/<id>/cleanup calls before cleanedUp (Zoer Connect cleans in 2 s batches). */
  cleanupCalls?: number;
  /** Refuse a new export while another one exists (the DDEV bridge and Zoer Connect's private storage). */
  singleExport?: boolean;
  batchLimits?: Record<string, number>;
  version?: string;
  /** WordPress siteurl when it differs from home (Zoer Connect 0.5.3 reports it as `source.originalUrls`). */
  siteUrl?: string;
}

const json = (status: number, value: unknown, headers: Record<string, string> = {}): FakeResponse => ({ status, headers: { "content-type": "application/json", ...headers }, body: Buffer.from(JSON.stringify(value)) });

/** Decodes a `zbt1-v1` octet-stream, multipart or JSON batch into spans. */
export function decodeBatch(body: Buffer, contentType = "application/octet-stream") {
  if (contentType.startsWith("application/json")) {
    const value = JSON.parse(body.toString("utf8"));
    return (value.spans as [number, number, number, string][]).map(([index, offset, length, data]) => ({ index, offset, data: Buffer.from(data, "base64").subarray(0, length) }));
  }
  let frame = body;
  if (contentType.startsWith("multipart/form-data")) {
    const start = body.indexOf("\r\n\r\n") + 4, end = body.lastIndexOf(Buffer.from("\r\n--"));
    frame = body.subarray(start, end);
  }
  if (frame.subarray(0, 4).toString("latin1") !== "ZBT1") throw new Error("bad frame");
  const length = frame.readUInt32BE(4);
  const header = JSON.parse(frame.subarray(8, 8 + length).toString("utf8"));
  let at = 8 + length;
  return (header.spans as number[][]).map(([index, offset, raw, encoded]) => {
    const size = header.enc ? encoded! : raw!;
    let data = frame.subarray(at, at + size); at += size;
    if (header.enc === "deflate") data = inflateSync(data);
    return { index: index!, offset: offset!, data: Buffer.from(data) };
  });
}

class ExportRefused extends Error {}

/** The messages of Zoer Connect's per-file import rules (StageStore::validateManifest), for paths the fakes see. */
function refusedPath(path: string): string | null {
  if (!/^wp-content\/(themes|plugins|uploads)\//.test(path)) return "Unsupported file path.";
  if (path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) return "Unsafe file path.";
  if (/^wp-content\/plugins\/zoer-connect(\/|$)/i.test(path) || /(^|\/)(wp-config\.php|\.htaccess)$/i.test(path)) return "Protected file.";
  if (path.startsWith("wp-content/uploads/") && /\.(php\d*|phtml|phar|cgi|pl|sh)(\.|$)/i.test(path)) return "Executable upload rejected.";
  return null;
}

export class FakeZoerConnect {
  readonly log: LogEntry[] = [];
  readonly exports = new Map<string, ExportJob>();
  readonly imports = new Map<string, ImportJob>();
  /** Remaining forced failures: route pattern → [status, count, retryAfter?]. */
  private failures: Array<{ pattern: RegExp; status: number; count: number; retryAfter?: string }> = [];
  /** Files written by activated imports (path → bytes). */
  readonly site: Map<string, Buffer>;
  database: Buffer | null = null;
  /** Called on every request with its route (tests advance a fake clock here). */
  onRequest?: (route: string, method: string) => void;
  /** Called on every export step (tests advance a fake clock here to give steps a duration). */
  onExportStep?: (job: { id: string; steps: number; status: string }) => void;
  constructor(readonly options: FakeSiteOptions) {
    this.site = new Map(Object.entries(options.existing ?? {}).map(([path, data]) => [path, Buffer.from(data)]));
  }
  failNext(pattern: RegExp, status: number, count = 1, retryAfter?: string) { this.failures.push({ pattern, status, count, retryAfter }); }
  get capabilities() {
    return { connectionKey: true, pull: true, blockDigestExport: true, pagedExport: this.options.pagedExport === true, databaseImport: true, selectivePush: true, batchUpload: true, chunkedFilePublication: true, largeTransfer: true,
      replacementRules: true, replacementVariants: true, reviewPause: true, lateFence: true, siteReplace: true, cachePurge: true, databaseFilters: true, resourceModes: true, mediaSince: true, authorMapping: true, keepActivePlugins: true, createTables: true, importPauseResume: true, ...this.options.capabilities };
  }
  status() {
    return { target: this.options.origin, version: this.options.version ?? "0.5.0", apiVersion: 1, capabilities: this.capabilities, permissions: { pull: true, push: true }, stagingReady: true,
      migrationMode: this.options.migrationMode ?? "shared-replacement", batchLimits: { blockBytes: BLOCK, maxBatchBytes: 8 * 1024 * 1024, maxJsonBatchBytes: 2 * 1024 * 1024, maxSpans: 1024, deadlineMs: 2000, ...this.options.batchLimits },
      batchTransports: ["octet-stream", "multipart", "json"] };
  }

  handle(request: FakeRequest): FakeResponse {
    const url = new URL(request.path, "https://fake.invalid");
    const route = url.pathname.replace(/^\/+/, "/");
    this.log.push({ method: request.method, route: route + (url.search || ""), ...(request.body?.length ? { body: sha(request.body).slice(0, 16) } : {}) });
    this.onRequest?.(route, request.method);
    const failure = this.failures.find(f => f.count > 0 && f.pattern.test(route));
    if (failure) { failure.count--; return json(failure.status, { code: "busy", message: "busy" }, failure.retryAfter ? { "retry-after": failure.retryAfter } : {}); }
    const body = () => JSON.parse((request.body ?? Buffer.from("{}")).toString("utf8"));
    const q = (key: string) => Number(url.searchParams.get(key));
    let m: RegExpExecArray | null;
    if (route === "/status" && request.method === "GET") return json(200, this.status());
    if (route === "/diagnostics" && request.method === "GET") {
      if (!this.options.tables) return json(404, {});
      return json(200, { database: { tables: this.options.tables.map(suffix => ({ name: `wp_${suffix}`, suffix, prefixed: true, engine: "InnoDB", rows: 1, bytes: 1 })) } });
    }
    if (route === "/files/compare" && request.method === "POST") {
      const refused = (body().files as { path: string }[]).map(({ path }) => refusedPath(path)).find(Boolean);
      if (refused) return json(400, { code: "zoer_invalid", message: refused });
      return json(200, { files: (body().files as { path: string }[]).map(({ path }) => (this.options.blocked ?? []).includes(path) ? { path, blocked: true, sha256: null } : { path, sha256: this.site.has(path) ? sha(this.site.get(path)!) : null }) });
    }
    if ((m = /^\/exports(\/paged)?$/.exec(route)) && request.method === "POST") {
      try { return json(202, this.startExport(body(), !!m[1])); }
      catch (error) { if (error instanceof ExportRefused) return json(409, { code: "zoer_export_blocked", message: error.message }); throw error; }
    }
    if ((m = /^\/exports(?:\/paged)?\/([a-f0-9]{32})\/step$/.exec(route)) && request.method === "POST") return this.stepExport(m[1]!);
    if ((m = /^\/exports(?:\/paged)?\/([a-f0-9]{32})$/.exec(route)) && request.method === "DELETE") { const job = this.exports.get(m[1]!); if (!job) return json(404, {}); job.status = "cancelled"; return json(200, { id: job.id, status: "cancelled" }); }
    if ((m = /^\/exports\/([a-f0-9]{32})\/chunks$/.exec(route)) && request.method === "GET") return this.chunk(m[1]!, q("index"), q("offset"));
    if ((m = /^\/exports\/paged\/([a-f0-9]{32})\/manifest$/.exec(route))) {
      const job = this.exports.get(m[1]!); if (!job) return json(404, {});
      const offset = q("offset"), size = this.options.pageSize ?? 500;
      return json(200, { id: job.id, offset, total: job.files.length, files: job.files.slice(offset, offset + size).map(({ data: _d, ...f }) => f) });
    }
    if ((m = /^\/exports\/paged\/([a-f0-9]{32})\/batch$/.exec(route))) {
      const job = this.exports.get(m[1]!); if (!job || job.status !== "ready") return json(404, {});
      const chunks: unknown[] = []; let index = q("index"), offset = q("offset");
      while (chunks.length < 32 && index < job.files.length) {
        const file = job.files[index]!, data = file.data.subarray(offset, Math.min(file.bytes, offset + BLOCK));
        chunks.push({ index, offset, data: data.toString("base64"), bytes: data.length, sha256: sha(data) });
        offset += data.length;
        if (offset >= file.bytes) { index++; offset = 0; }
        if (!data.length) { break; }
      }
      return json(200, { id: job.id, chunks });
    }
    if (route === "/imports" && request.method === "POST") return this.createImport(body());
    if ((m = /^\/imports\/([a-f0-9]{32})$/.exec(route)) && request.method === "GET") {
      const job = this.imports.get(m[1]!); if (!job) return json(404, {});
      if (url.searchParams.get("view") === "upload") return json(200, { cursor: this.cursor(job), phase: job.phase });
      return json(200, this.summary(job));
    }
    if ((m = /^\/imports\/([a-f0-9]{32})\/batch$/.exec(route)) && request.method === "POST") return this.batch(m[1]!, request.body ?? Buffer.alloc(0), request.contentType);
    if ((m = /^\/imports\/([a-f0-9]{32})\/chunks$/.exec(route)) && request.method === "POST") {
      const job = this.imports.get(m[1]!); if (!job) return json(404, {});
      const { index, offset, data } = body(); const bytes = Buffer.from(data, "base64");
      if (offset !== job.offsets[index]) return json(409, { code: "zoer_import_gap", message: "gap" });
      job.spans[index] = Buffer.concat([job.spans[index]!, bytes]); job.offsets[index] = job.spans[index]!.length;
      if (this.cursor(job).index >= job.sizes.length) job.phase = "importing";
      return json(200, this.summary(job));
    }
    if ((m = /^\/imports\/([a-f0-9]{32})\/(step|approve|finish|rollback|cleanup|pause|resume)$/.exec(route)) && request.method === "POST") return this.control(m[1]!, m[2]!);
    return json(404, { message: "Not found" });
  }

  private startExport(input: any, paged: boolean) {
    const id = String(input.clientId);
    const existing = this.exports.get(id);
    if (existing) return { job: this.exportView(existing) };
    if (this.options.singleExport && [...this.exports.values()].some(job => job.status !== "cancelled")) throw new ExportRefused("Cancel an existing source export before starting another.");
    const profile = input.profile ?? {};
    const wanted = (path: string) => path === "database.sql" ? !!input.database
      : path.startsWith("wp-content/themes/") ? profile.themes : path.startsWith("wp-content/plugins/") ? profile.plugins : path.startsWith("wp-content/uploads/") ? profile.media : path.startsWith("wp-content/mu-plugins/") ? profile.muplugins : profile.core;
    const files = Object.entries(this.options.files).filter(([path]) => wanted(path)).map(([path, raw]) => {
      const data = Buffer.from(raw);
      const blocks = input.largeTransfer === true && data.length > BLOCK;
      return { path, bytes: data.length, sha256: blocks ? blocksRoot(data) : sha(data), ...(blocks ? { digestFormat: "sha256-blocks-v1" as const } : {}), data };
    });
    const job: ExportJob = { id, input, paged, steps: 0, status: "preparing", files };
    this.exports.set(id, job);
    return { job: this.exportView(job) };
  }
  private exportView(job: ExportJob) {
    const ready = job.status === "ready";
    return { id: job.id, status: job.status, phase: ready ? "complete" : "database", fileCount: job.files.length,
      ...(ready && !job.paged ? { files: job.files.map(({ data: _d, ...f }) => f) } : {}),
      ...(ready ? { source: { url: this.options.origin, prefix: "wp_", originalUrls: this.options.siteUrl ? [this.options.siteUrl] : [], abspath: "/var/www/html", tables: ["options", "posts"] }, skipped: [{ path: "wp-content/cache/x", reason: "cache" }], skippedCount: 1 } : {}) };
  }
  private stepExport(id: string) {
    const job = this.exports.get(id); if (!job) return json(404, {});
    if (job.status === "preparing" && ++job.steps >= (this.options.exportSteps ?? 1)) job.status = "ready";
    this.onExportStep?.(job);
    return json(200, { job: this.exportView(job) });
  }
  private chunk(id: string, index: number, offset: number) {
    const job = this.exports.get(id); const file = job?.files[index];
    if (!job || job.status !== "ready" || !file || offset > file.bytes) return json(404, {});
    const data = file.data.subarray(offset, Math.min(file.bytes, offset + BLOCK));
    return json(200, { index, offset, data: data.toString("base64"), bytes: data.length, sha256: sha(data) });
  }

  private createImport(manifest: any) {
    // TransferImport::create validates every file (StageStore::validateManifest) and refuses the whole import.
    const refused = (manifest.files ?? []).map((f: any) => refusedPath(f.path)).find(Boolean);
    if (refused) return json(400, { code: "zoer_invalid", message: refused });
    const existing = this.imports.get(manifest.id);
    if (existing) return json(200, this.summary(existing));
    const entries = [...(manifest.database ? [manifest.database] : []), ...(manifest.files ?? [])];
    const job: ImportJob = { id: manifest.id, manifest, phase: entries.length && manifest.kind !== "replace" ? "uploading" : "importing", spans: entries.map(() => Buffer.alloc(0)), sizes: entries.map((e: any) => e.bytes),
      blocks: entries.map((e: any) => e.chunkSha256), offsets: entries.map(() => 0), review: manifest.options?.review === true || manifest.kind === "replace", stepped: 0, cleanedUp: false, cursor: 0, requests: {} };
    this.imports.set(job.id, job);
    return json(201, this.summary(job));
  }
  private cursor(job: ImportJob) {
    for (let i = 0; i < job.sizes.length; i++) if (job.offsets[i]! < job.sizes[i]!) return { index: i, offset: job.offsets[i]! };
    return { index: job.sizes.length, offset: 0 };
  }
  private summary(job: ImportJob) {
    return { id: job.id, phase: job.phase, status: job.phase, offsets: [...job.offsets], cleanedUp: job.cleanedUp, ...(["review_required", "complete", "verification_required"].includes(job.phase) ? { stats: { files: job.manifest.files?.length ?? 0, rows: 42 } } : {}), ...(job.rollbackRefused ? { rollbackRefused: true } : {}) };
  }
  private batch(id: string, body: Buffer, contentType?: string) {
    const job = this.imports.get(id); if (!job) return json(404, {});
    let spans; try { spans = decodeBatch(body, contentType); } catch { return json(200, { v: 1, cursor: this.cursor(job), complete: false, deadlineHit: false, acceptedSpans: 0, appendedBytes: 0, phase: job.phase, rejected: { span: 0, code: "decode" } }); }
    let accepted = 0, appended = 0;
    for (const [n, span] of spans.entries()) {
      const blocks = job.blocks[span.index];
      const reject = (code: string) => json(200, { v: 1, cursor: this.cursor(job), complete: false, deadlineHit: false, acceptedSpans: accepted, appendedBytes: appended, phase: job.phase, rejected: { span: n, code, expectedOffset: job.offsets[span.index] } });
      if (!blocks) return reject("unverifiable");
      if (span.offset !== job.offsets[span.index]) return reject("gap");
      for (let at = 0; at < span.data.length; at += BLOCK) if (sha(span.data.subarray(at, Math.min(span.data.length, at + BLOCK))) !== blocks[(span.offset + at) / BLOCK]) return reject("digest_mismatch");
      job.spans[span.index] = Buffer.concat([job.spans[span.index]!, span.data]); job.offsets[span.index] = job.spans[span.index]!.length;
      accepted++; appended += span.data.length;
    }
    const cursor = this.cursor(job), complete = cursor.index >= job.sizes.length;
    if (complete) job.phase = "importing";
    return json(200, { v: 1, cursor, complete, deadlineHit: false, acceptedSpans: accepted, appendedBytes: appended, phase: job.phase, rejected: null });
  }
  private control(id: string, action: string) {
    const job = this.imports.get(id); if (!job) return json(404, {});
    job.requests[action] = (job.requests[action] ?? 0) + 1;
    if (action === "step" && job.phase === "importing" && this.options.refuseImport) {
      // TransferImport::step throws while scanning; the answer is safeError() with HTTP 409.
      job.phase = this.options.refuseImport.phase;
      return json(409, { code: "zoer_import_failed", message: this.options.refuseImport.message, phase: job.phase });
    }
    if (action === "rollback") return this.rollbackStep(job);
    if (action === "cleanup") {
      if (!["complete", "rolled_back", "cancelled"].includes(job.phase)) return json(409, { code: "zoer_import_failed", message: "Only complete, rolled back or cancelled imports can be cleaned up." });
      job.cleanupCalls = (job.cleanupCalls ?? 0) + 1;
      if (job.cleanupCalls >= (this.options.cleanupCalls ?? 1)) job.cleanedUp = true;
      return json(200, this.summary(job));
    }
    if (action === "step") {
      if (job.phase === "importing") {
        job.stepped++;
        if (job.stepped >= 2) job.phase = job.review && !job.manifest.approved ? "review_required" : "complete";
        if (job.phase === "complete") this.activate(job);
      }
    } else if (action === "approve") { if (job.phase !== "review_required") return json(409, { code: "zoer_import_state", message: "Not in review." }); job.manifest.approved = true; job.phase = "importing"; }
    else if (action === "finish") { job.phase = "complete"; this.activate(job); }

    return json(200, this.summary(job));
  }
  /**
   * One rollback tick per request, through Zoer Connect's phases (TransferImport::tick):
   * rollback_reset (tables) → rollback_reset_files (artifacts) → rollback_preflight_tables →
   * rollback_preflight_files → rollback_tables (backwards) → rollback_files (backwards) →
   * rollback_ready → rolled_back. Before the fence a rollback only cancels.
   */
  private rollbackStep(job: ImportJob) {
    if (job.rollbackRefused) return json(409, { code: "zoer_import_rollback_refused", message: "refused" });
    if (["rolled_back", "cancelled"].includes(job.phase)) return json(200, this.summary(job));
    if (["uploading", "importing", "scanning_database", "review_required"].includes(job.phase) && !job.before) { job.phase = "cancelled"; return json(200, this.summary(job)); }
    const tables = this.options.importTables ?? (job.manifest.database ? 3 : 0), artifacts = job.sizes.length;
    if (!job.phase.startsWith("rollback")) { job.phase = "rollback_reset"; job.cursor = 0; }
    const next = (phase: string, cursor = 0) => { job.phase = phase; job.cursor = cursor; };
    switch (job.phase) {
      case "rollback_reset": if (job.cursor >= tables) next("rollback_reset_files"); else job.cursor++; break;
      case "rollback_reset_files": if (job.cursor >= artifacts) next("rollback_preflight_tables"); else job.cursor++; break;
      case "rollback_preflight_tables": if (job.cursor >= tables) next("rollback_preflight_files"); else job.cursor++; break;
      case "rollback_preflight_files": if (job.cursor >= artifacts) next("rollback_tables", tables - 1); else job.cursor++; break;
      case "rollback_tables": if (job.cursor < 0) next("rollback_files", artifacts - 1); else job.cursor--; break;
      case "rollback_files": if (job.cursor < 0) next("rollback_ready"); else job.cursor--; break;
      case "rollback_ready": {
        if (job.before) { this.site.clear(); for (const [path, data] of job.before.site) this.site.set(path, data); this.database = job.before.database; }
        next("rolled_back"); break;
      }
    }
    return json(200, this.summary(job));
  }

  private activate(job: ImportJob) {
    job.before ??= { site: new Map(this.site), database: this.database };
    const entries = [...(job.manifest.database ? [{ path: "database.sql" }] : []), ...(job.manifest.files ?? [])];
    entries.forEach((entry: any, index: number) => {
      if (entry.path === "database.sql") this.database = job.spans[index]!;
      else this.site.set(entry.path, job.spans[index]!);
    });
  }
}

/** Example WordPress content: a database and files under every resource. */
export function sampleSite(origin = "https://source.example", options: Partial<FakeSiteOptions> = {}): FakeZoerConnect {
  const big = Buffer.alloc(BLOCK * 2 + 12345);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) % 251;
  return new FakeZoerConnect({
    origin,
    files: {
      "database.sql": "-- Zoer Connect database snapshot\nINSERT INTO wp_posts VALUES (1);\n".repeat(50),
      "wp-content/themes/twentyone/style.css": "body{color:red}",
      "wp-content/themes/twentyone/.gitignore": "node_modules",
      "wp-content/plugins/akismet/akismet.php": "<?php // plugin",
      "wp-content/uploads/2024/01/photo.jpg": big,
      "wp-content/uploads/2024/index.php": "<?php\n// Silence is golden.",
      "wp-content/uploads/empty.txt": "",
    },
    ...options,
  });
}
