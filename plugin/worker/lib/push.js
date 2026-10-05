// `transfer.preview`, `transfer.push`, `transfer.replace` and `transfer.push.control`: the Zoer
// Connect import state machine of the legacy host engine (`WordPressPushStore` in Zoer
// `backend/src/wordpress-push.ts`) over S1 slices, S3 uploads (`zbt1-v1`, remote cursor
// authority) and S7b endpoint auth (docs/plugin-shared-services.md Appendix A).
import { createHash } from "node:crypto";
import { assertPluginEngine, commitRecords, readRecord, readRecords } from "./catalog.js";
import { listEntries } from "./filesets.js";
import { capabilityFlags, importOptionsToPlugin, legacyImportOptions, replaceOptionsToPlugin, validateImportOptions, validateTableSuffixes } from "./options.js";
import { HEX32, pullOfSet, runHex } from "./pull.js";
import { connectRefusal, normalizeConnectUrl, NOT_ACCEPTED } from "./files.js";
import { fail, OUTPUT_RESERVE, TransferError } from "./slices.js";
import { connectClient, parseStatus, siteEndpoint } from "./zoer-connect.js";

const PREVIEW_BATCH = 20;
const PREVIEW_PAGE = 400;
const PREVIEW_TTL_MS = 3_600_000;
/** Output one more compare batch can add: its request and its 20 entries in the page commit. */
const PREVIEW_BATCH_OUTPUT = 64 * 1024;
const MANIFEST_BODY_BYTES = 8 * 1024 * 1024;
const TERMINAL = ["complete", "rolled_back", "cancelled"];
const CHANGED = "Connection changed. Restore the original connection to recover this import.";
const GIB = 1024 ** 3;

function endpointOf(request, siteId) {
  const endpoint = siteEndpoint(request, siteId);
  if (!endpoint) fail("This site's connection was removed. Add the site again in WordPress Manager.", { code: "endpoint_unbound" });
  return endpoint;
}
const pullProfile = (profile) => ({ name: profile?.name, themes: profile?.themes, plugins: profile?.plugins, media: profile?.media, muplugins: profile?.muplugins, core: profile?.core, excludes: profile?.excludes });

/** Replacement policy confirmed for the destination's migration mode. */
function policy(status, input) {
  const shared = status.migrationMode === "shared-replacement";
  if (shared ? input.replacementAccepted !== true : input.wordpressOnlyWriters !== true) fail(shared ? "Confirm replacement of the selected live resources." : "This destination still requires verified-worker setup. Enable shared-hosting migration in WordPress or confirm isolated WordPress writers.");
  return shared ? { migrationMode: "shared-replacement", replacementAccepted: true } : { wordpressOnlyWriters: true };
}

// ---------------------------------------------------------------------------------------------
// Preview (compare the source set with the destination, 20 paths per request)
// ---------------------------------------------------------------------------------------------

export const previewSpec = {
  async start(input, { host, request, now }) {
    if (!HEX32.test(input.previewId ?? "")) fail("A valid preview ID is required.");
    await assertPluginEngine(host, input.siteId);
    const endpoint = endpointOf(request, input.siteId);
    const status = await connectClient(host, endpoint).request("/status");
    if (!status.permissions?.push || !status.capabilities?.selectivePush) fail("Update the destination Zoer Connect plugin for selective Push and enable Push permission.");
    const { set, pull } = await pullOfSet(host, input.setId);
    if (pull.siteId === input.siteId) fail("Choose a different local source export.");
    const created = now();
    return { v: 1, previewId: input.previewId, siteId: input.siteId, setId: input.setId, pullId: pull.pullId, generation: endpoint.generation, cursor: 0, page: 0, total: set.entryCount,
      counts: { new: 0, changed: 0, unchanged: 0, blocked: 0, database: 0 }, createdAt: new Date(created).toISOString(), expiresAt: new Date(created + PREVIEW_TTL_MS).toISOString() };
  },
  async step(state, input, ctx) {
    const { host, request } = ctx;
    const client = connectClient(host, endpointOf(request, state.siteId), state.generation);
    // Pages of ≤ 400 files, each committed with the summary, until the slice's time or output
    // budget runs out (the page and every compare request count against maxOutputBytes).
    // The first page always commits (an empty set still records its complete summary).
    for (let pages = 0; (pages === 0 || state.cursor < state.total) && ctx.timeLeft() > 5_000 && ctx.outputLeft() > PREVIEW_BATCH_OUTPUT; pages++) {
      if (!(await previewPage(state, ctx, client))) break;
    }
    const progress = { phase: "comparing", done: state.cursor, total: state.total, unit: "files" };
    return state.cursor >= state.total ? ctx.done({ previewId: state.previewId, complete: true, total: state.total, counts: state.counts }, progress) : ctx.continue(state, progress);
  },
};

/** Compares up to one page of files with the destination and commits it with the summary; returns the files added. */
async function previewPage(state, ctx, client) {
  const { host } = ctx;
  const files = [];
  while (state.cursor + files.length < state.total && files.length < PREVIEW_PAGE && ctx.timeLeft() > 5_000 && ctx.outputLeft() > Buffer.byteLength(JSON.stringify(files)) + PREVIEW_BATCH_OUTPUT) {
    const batch = (await listEntries(host, state.setId, { from: state.cursor + files.length, limit: PREVIEW_BATCH })).slice(0, PREVIEW_BATCH);
    // Files Zoer Connect refuses (it would also refuse to compare them) are blocked without asking.
    const ordinary = batch.filter(f => f.path !== "database.sql" && !connectRefusal(f.path));
    const result = ordinary.length ? await client.request("/files/compare", "POST", { files: ordinary.map(f => ({ path: f.path })) }) : { files: [] };
    let resultIndex = 0; const before = files.length;
    for (const file of batch) {
      const entry = { path: file.path, bytes: file.bytes, sha256: file.sha256, state: "database" };
      if (file.path !== "database.sql" && connectRefusal(file.path)) Object.assign(entry, { state: "blocked", reason: NOT_ACCEPTED });
      else if (file.path !== "database.sql") {
        const r = result.files?.[resultIndex++];
        if (!r) break;
        if (r.path !== file.path || (!r.blocked && r.sha256 !== null && !/^[a-f0-9]{64}$/.test(r.sha256))) fail("Invalid comparison response.");
        entry.state = r.blocked ? "blocked" : r.sha256 === null ? "new" : r.sha256 === file.sha256 ? "unchanged" : "changed";
        if (!r.blocked) entry.expectedDestinationSha256 = r.sha256;
      }
      files.push(entry);
    }
    if (files.length === before) fail("Destination comparison made no progress.");
  }
  const counts = { ...state.counts };
  for (const file of files) counts[file.state]++;
  const next = { ...state, cursor: state.cursor + files.length, page: state.page + (files.length ? 1 : 0), counts };
  const complete = next.cursor >= next.total;
  const summary = { id: `preview:${state.previewId}`, kind: "preview", title: `Preview ${state.previewId.slice(0, 8)}`,
    data: { v: 1, previewId: state.previewId, siteId: state.siteId, setId: state.setId, pullId: state.pullId, generation: state.generation, createdAt: state.createdAt, expiresAt: state.expiresAt, cursor: next.cursor, total: next.total, pages: next.page, counts, complete } };
  // The page and the summary commit together, so a replayed slice rewrites the same page.
  await commitRecords(host, [...(files.length ? [{ id: `preview-page:${state.previewId}:${state.page}`, kind: "preview-page", title: `Preview page ${state.page}`, data: { v: 1, previewId: state.previewId, page: state.page, files } }] : []), summary]);
  Object.assign(state, next);
  return files.length;
}

/** The completed preview of `previewId` with every page's classification by path. */
async function loadPreview(host, previewId) {
  const summary = (await readRecord(host, `preview:${previewId}`))?.data;
  if (!summary) return null;
  const byPath = new Map();
  for (let page = 0; page < summary.pages; page += 20) {
    const ids = Array.from({ length: Math.min(20, summary.pages - page) }, (_, i) => `preview-page:${previewId}:${page + i}`);
    for (const record of await readRecords(host, ids)) for (const file of record.data?.files ?? []) byPath.set(file.path, file);
  }
  return { summary, byPath };
}

// ---------------------------------------------------------------------------------------------
// Push and replace
// ---------------------------------------------------------------------------------------------

function checkTarget(input, endpoint) {
  let target;
  try { target = normalizeConnectUrl(endpoint.origin); } catch { target = endpoint.origin; }
  if (input.confirmTarget !== target) fail("Confirm the exact destination address.");
}

export async function startPush(kind, input, ctx) {
  const { host, request, now } = ctx;
  const importId = input.importId ?? runHex(request);
  if (!HEX32.test(importId)) fail("A valid transfer request ID is required.");
  await assertPluginEngine(host, input.siteId);
  const endpoint = endpointOf(request, input.siteId);
  if (input.wordpressOnlyWriters !== true && input.replacementAccepted !== true) fail(kind === "replace" ? "Confirm the destination replacement policy." : "Choose a different source and confirm the destination replacement policy.");
  checkTarget(input, endpoint);
  const state = { v: 1, kind, siteId: input.siteId, importId, generation: endpoint.generation, phase: "creating", dryRun: input.dryRun === true, startedAt: new Date(now()).toISOString() };
  if (kind === "replace") {
    state.options = validateImportOptions(input.importOptions, { requireCustom: true });
    state.tables = validateTableSuffixes(input.tables) ?? null;
  } else {
    if (typeof input.setId !== "string") fail("Choose a verified local export or completed pull as the source.");
    const { pull } = await pullOfSet(host, input.setId);
    if (pull.siteId === input.siteId) fail("Choose a different source and confirm the destination replacement policy.");
    if (pull.options?.profile?.muplugins || pull.options?.profile?.core) fail("Import supports database, themes, plugins and media. Exclude core and must-use plugins.");
    state.setId = input.setId;
    state.options = input.importOptions === undefined ? legacyImportOptions() : validateImportOptions(input.importOptions);
    if (input.previewId !== undefined) {
      if (!HEX32.test(input.previewId)) fail("Preview is incomplete, expired or changed. Compare again.");
      if (!Array.isArray(input.selectedPaths) || !input.selectedPaths.length || input.selectedPaths.some(p => typeof p !== "string") || new Set(input.selectedPaths).size !== input.selectedPaths.length) fail("Select files or the database once each.");
      state.previewId = input.previewId;
    } else if (input.selectedPaths !== undefined) fail("File selection requires a completed preview.");
  }
  return state;
}

/** Selected source entries (database first) and the Zoer Connect import manifest, recomputed deterministically. */
async function buildManifest(state, input, status, ctx) {
  const { host } = ctx;
  const caps = capabilityFlags(status);
  if (state.kind === "replace") {
    return { manifest: { kind: "replace", id: state.importId, target: status.target, ...policy(status, input), options: replaceOptionsToPlugin(state.options, caps, state.tables ?? undefined) }, order: [], caps, warnings: [] };
  }
  const { pull } = await pullOfSet(host, state.setId);
  const entries = await listEntries(host, state.setId, { includeBlocks: true });
  let selected = entries.map((entry, index) => ({ ...entry, index }));
  let reviewed = null;
  if (state.previewId) {
    if (!status.capabilities?.selectivePush) fail("Destination no longer supports selective Push.");
    reviewed = await loadPreview(host, state.previewId);
    const s = reviewed?.summary;
    if (!s || s.setId !== state.setId || !s.complete || Date.parse(s.expiresAt) < ctx.now() || s.generation !== state.generation || s.siteId !== state.siteId) fail("Preview is incomplete, expired or changed. Compare again.");
    const byPath = new Map(selected.map(e => [e.path, e]));
    selected = input.selectedPaths.map(path => {
      const file = byPath.get(path), before = reviewed.byPath.get(path);
      if (!file || !before || before.state === "blocked" || before.sha256 !== file.sha256 || before.bytes !== file.bytes) fail("Selected artifact is unavailable or changed. Compare again.");
      return file;
    });
  }
  // Files Zoer Connect refuses would fail the whole import; they stay out of it, reported up front.
  const skipped = [];
  selected = selected.filter(f => { const reason = f.path === "database.sql" ? null : connectRefusal(f.path); if (reason) skipped.push({ path: f.path, reason }); return !reason; });
  const database = pull.options?.database;
  const partialDatabase = selected.some(f => f.path === "database.sql") && !!database && typeof database === "object" && Array.isArray(database.tables);
  const warnings = skipped.length ? [skippedWarning(skipped)] : [];
  const pluginOptions = importOptionsToPlugin(state.options, caps, { partialDatabase });
  const recorded = pull.source?.abspath;
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  const abspath = typeof recorded === "string" && /^\/[^\x00-\x1f\x7f]{1,1023}$/.test(recorded) && recorded.replace(/\/+$/, "").length >= 2 ? recorded.replace(/\/+$/, "") : undefined;
  if (pluginOptions?.replacements?.paths && !abspath) { pluginOptions.replacements.paths = false; warnings.push("The source export did not record its WordPress path, so path replacement was skipped. Start a new export to include it."); }
  const ordered = [...selected].sort((a, b) => Number(b.path === "database.sql") - Number(a.path === "database.sql"));
  for (const entry of ordered) {
    const limit = entry.path === "database.sql" ? (caps.largeTransfer === true ? 4 * GIB : 2 * GIB) : (caps.largeTransfer === true ? 4 * GIB : caps.chunkedFilePublication === true ? 2 * GIB : 32 * 1024 * 1024);
    if (entry.bytes > limit) fail("An individual selected file exceeds the destination limit. Update Zoer Connect to 0.5.0 for files up to 4 GiB.");
  }
  const blocks = (entry) => entry.bytes === 0 ? [] : entry.blockSha256;
  const db = ordered.find(f => f.path === "database.sql");
  const manifest = {
    id: state.importId, target: status.target, sourceUrl: pull.source.url, originalUrls: pull.source.originalUrls ?? [], sourcePrefix: pull.source.prefix, ...policy(status, input),
    database: db ? { bytes: db.bytes, sha256: db.sha256, chunkSha256: blocks(db) } : null,
    files: ordered.filter(f => f.path !== "database.sql").map(f => ({ path: f.path, bytes: f.bytes, sha256: f.sha256, ...(reviewed ? { expectedDestinationSha256: reviewed.byPath.get(f.path).expectedDestinationSha256 } : {}), ...(caps.chunkedFilePublication === true ? { chunkSha256: blocks(f) } : {}) })),
    resources: reviewed ? { ...pullProfile(pull.options.profile), plugins: false, themes: false } : pullProfile(pull.options.profile),
    ...(pluginOptions ? { options: pluginOptions } : {}), ...(pluginOptions?.replacements?.paths && abspath ? { sourcePath: abspath } : {}),
  };
  return { manifest, order: ordered.map(f => f.index), caps, warnings, skipped, sourceTables: Array.isArray(pull.source?.tables) ? pull.source.tables : null, totalBytes: ordered.reduce((sum, f) => sum + f.bytes, 0) };
}

/**
 * Source tables the destination lacks while "Create missing tables" is off: Zoer Connect refuses
 * such an import while scanning the database ("Every imported core or plugin table requires an
 * existing matching destination schema."). Read from /diagnostics; [] when it cannot be told
 * (no database, older plugins, no table list). Schema differences are only found by the import.
 */
async function missingDestinationTables(built, client) {
  if (!built.manifest.database || built.manifest.options?.createTables === true || !built.sourceTables?.length) return [];
  let diagnostics;
  try { diagnostics = await client.request("/diagnostics"); } catch { return []; }
  const tables = diagnostics?.database?.tables;
  if (!Array.isArray(tables)) return [];
  const present = new Set(tables.filter(t => t?.prefixed && typeof t.suffix === "string").map(t => t.suffix.toLowerCase()));
  // Zoer Connect never imports users and usermeta (the destination keeps its own).
  return built.sourceTables.filter(table => !["users", "usermeta"].includes(table) && !present.has(table.toLowerCase()));
}

const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
/** "2 files skipped: not accepted by Zoer Connect (wp-content/plugins/akismet/.htaccess, …)." */
function skippedWarning(skipped) {
  const examples = skipped.slice(0, 3).map(f => f.path).join(", ");
  return `${plural(skipped.length, "file")} skipped: ${NOT_ACCEPTED} (${examples}${skipped.length > 3 ? ", …" : ""}). The destination keeps its own copies.`.slice(0, 600);
}
/** Bounded list for the plan, the checkpoint and the result. */
const skippedSummary = (skipped, max) => ({ count: skipped.length, reason: NOT_ACCEPTED, files: skipped.slice(0, max).map(f => ({ path: f.path.slice(0, 300), reason: f.reason })) });

/** Maps a Zoer Connect import summary onto the local phase (applyRemotePhase). */
function applyRemotePhase(state, remote) {
  const phase = remote?.phase ?? remote?.status;
  if (phase === "uploading") state.phase = "uploading";
  else if (phase === "cancelled") state.phase = "rolled_back";
  else if (["review_required", "verification_required", "complete", "rolled_back"].includes(phase)) state.phase = phase;
  else if (state.phase === "review_required" || state.phase === "creating") state.phase = "importing";
  if (typeof remote?.cleanedUp === "boolean") state.cleanedUp = remote.cleanedUp;
  state.remotePhase = typeof phase === "string" ? phase.slice(0, 40) : state.remotePhase;
  if (remote?.stats && typeof remote.stats === "object") state.stats = compactStats(remote.stats);
}

/** Bounded copy of the remote statistics (numbers and short strings only). */
function compactStats(stats) {
  const out = {};
  for (const [key, value] of Object.entries(stats).slice(0, 40)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
    if (Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && value.length <= 80) out[key] = value;
    else if (value && typeof value === "object" && !Array.isArray(value)) out[key] = Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[A-Za-z0-9_]{1,40}$/.test(k) && Number.isFinite(v)).slice(0, 20));
  }
  return out;
}
const statsText = (stats) => Object.entries(stats ?? {}).filter(([, v]) => Number.isFinite(v)).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(", ");

function progressOf(state) {
  if (state.phase === "uploading") return { phase: "uploading", done: state.uploadedRaw ?? 0, total: state.totalBytes ?? 0, unit: "bytes" };
  return { phase: state.phase, ...(state.remotePhase ? { message: `Destination: ${state.remotePhase}` } : {}) };
}

/** Upload order (database first, then the selected entries in set order) without block digests. */
async function uploadOrder(state, input, ctx) {
  const entries = (await listEntries(ctx.host, state.setId)).map((entry, index) => ({ ...entry, index }));
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  // Same order as the manifest: the selection's order when a preview chose paths, else the set's.
  const selected = (state.previewId ? input.selectedPaths.map(path => byPath.get(path)).filter(Boolean) : entries).filter(entry => entry.path === "database.sql" || !connectRefusal(entry.path));
  return [...selected].sort((a, b) => Number(b.path === "database.sql") - Number(a.path === "database.sql")).map(entry => entry.index);
}

async function uploadSlice(state, input, ctx, client) {
  const { host } = ctx;
  const transferId = `push-${state.importId}`;
  const target = client.peer(`imports/${state.importId}/batch`);
  const order = state.order ?? await uploadOrder(state, input, ctx);
  while (ctx.timeLeft() > 5_000) {
    const call = state.batchUpload
      ? { transferId, setId: state.setId, target, resync: client.peer(`imports/${state.importId}?view=upload`), chunks: client.peer(`imports/${state.importId}/chunks`), protocol: "zbt1-v1", ...(state.remote ? { remote: state.remote } : {}), order }
      : { transferId, setId: state.setId, target: client.peer(`imports/${state.importId}/chunks`), protocol: "chunks-json-v1", order };
    // Every call repeats the upload order (Zoer checks it against the stored transfer), so a long
    // slice of small batches is bounded by its output budget, not only by time.
    if (!ctx.canSend("transfer.upload", call)) return false;
    let result;
    try {
      result = await host.call("transfer.upload", call);
    } catch (error) {
      if (error?.code === "transfer_integrity") throw new TransferError("Source artifact changed.", { code: error.code });
      if (error?.code === "transfer_exhausted") throw new TransferError(`Upload paused after repeated failures with every transfer method. ${error.message}`.slice(0, 300), { needsUser: true, code: error.code });
      throw error;
    }
    state.transfer = { transport: result.transport, batchBytes: result.batchBytes, ceiling: result.ceiling, requests: result.requests, wireBytes: result.wireBytes, rawBytes: result.rawBytes };
    state.uploadedRaw = result.rawBytes;
    delete state.remote; // the host holds the negotiated batch state after the first call
    if (result.complete) { state.phase = "importing"; return true; }
    if (result.transient) throw new TransferError(result.transient.message || "The destination is busy. Retrying shortly.", { transient: true, retryAfterMs: result.retryAfterMs });
    if (result.stopped) return false;
  }
  return false;
}

export async function stepPush(state, input, ctx) {
  const { host, request } = ctx;
  const client = connectClient(host, endpointOf(request, state.siteId), state.generation);
  if (state.phase === "creating" || state.phase === "submitting") {
    // Submitting rebuilds the manifest from the destination status seen while planning, so the
    // retried request is byte-identical (only a changed download can alter it; see the digest).
    const status = state.phase === "submitting" && state.destination ? state.destination : await client.request("/status");
    if (!status.permissions?.push || !status.capabilities?.databaseImport || typeof status.target !== "string") fail(state.kind === "replace" ? "This site needs a verified plugin supporting imports and Push permission." : "The destination needs a verified plugin supporting imports and Push permission.");
    const built = await buildManifest(state, input, status, ctx);
    const body = JSON.stringify(built.manifest);
    if (Buffer.byteLength(body) > MANIFEST_BODY_BYTES - 4096) fail("The import manifest exceeds the 8 MiB endpoint limit. Compare first and push a smaller selection.");
    // The manifest leaves the worker base64-encoded in one host call (counted as output).
    const manifestOutput = Buffer.byteLength(body) * 4 / 3 + 4096;
    if (manifestOutput > ctx.outputLimit - OUTPUT_RESERVE - 64 * 1024) fail("The import manifest is too large for one request from this worker. Compare first and push a smaller selection.");
    const digest = createHash("sha256").update(body).digest("hex");
    if (state.phase === "creating") {
      state.totalBytes = built.totalBytes ?? 0;
      state.fileCount = built.order.length;
      if (built.warnings.length) state.warnings = built.warnings;
      if (built.skipped?.length) state.skipped = skippedSummary(built.skipped, 20);
      if (state.dryRun) {
        const missingTables = await missingDestinationTables(built, client);
        if (missingTables.length) built.warnings.push(`The destination has no ${missingTables.length === 1 ? "table" : "tables"} for ${missingTables.slice(0, 10).join(", ")}${missingTables.length > 10 ? ", …" : ""}. Turn on “Create missing tables”, or Zoer Connect will refuse the import.`);
        return ctx.done({ importId: state.importId, kind: state.kind, status: "dry-run", phase: "planned",
          plan: { target: status.target, files: built.manifest.files?.length ?? 0, database: !!built.manifest.database, bytes: state.totalBytes, batchUpload: built.caps.batchUpload === true && built.order.length > 0,
            options: built.manifest.options ?? null, resources: built.manifest.resources ?? null, warnings: built.warnings, ...(built.skipped?.length ? { skipped: skippedSummary(built.skipped, 50) } : {}),
            ...(missingTables.length ? { missingTables: missingTables.slice(0, 100) } : {}) },
          summary: `Dry run: ${state.fileCount} artifacts (${state.totalBytes.toLocaleString("en-US")} bytes) would be sent to ${status.target}. Nothing was changed.` });
      }
      state.batchUpload = built.order.length > 0 && built.caps.batchUpload === true;
      if (state.batchUpload) state.remote = { batchUpload: true, ...(Array.isArray(status.batchTransports) ? { transports: status.batchTransports } : {}), deflate: built.caps.batchDeflate === true, ...(status.batchLimits && typeof status.batchLimits === "object" ? { limits: status.batchLimits } : {}) };
      if (built.order.length <= 4000) state.order = built.order; // larger orders are recomputed per slice
      // Checkpoint the import ID and the manifest's digest before anything is sent: whatever
      // happens to the slice that creates the import, a retry or resume posts the same manifest
      // for the same ID, which Zoer Connect answers with the existing import (the host engine
      // persisted its job before submitting, for the same reason).
      state.manifestSha256 = digest;
      state.destination = { target: status.target, ...(typeof status.migrationMode === "string" ? { migrationMode: status.migrationMode.slice(0, 40) } : {}),
        permissions: { push: status.permissions?.push === true }, capabilities: capabilityFlags(status) };
      state.phase = "submitting";
      return ctx.continue(state, { phase: "submitting", message: "Sending the import manifest to the destination." });
    }
    if (state.manifestSha256 && digest !== state.manifestSha256) fail("The download, the destination or the selection changed before the import was created. Start the push again.");
    const remote = await client.request("/imports", "POST", built.manifest);
    if (remote?.id !== state.importId) fail("Destination import identity mismatch.");
    applyRemotePhase(state, remote);
    state.phase = (remote.phase ?? remote.status) === "uploading" ? "uploading" : "importing";
    if (state.kind === "replace" || !built.order.length) state.phase = state.phase === "uploading" ? "importing" : state.phase;
    // The import exists: checkpoint it before uploading anything.
    return ctx.continue(state, progressOf(state));
  }
  if (["review_required", "verification_required"].includes(state.phase)) {
    // Resumed after the user acted through transfer.push.control: read where the import is now.
    applyRemotePhase(state, await client.request(`/imports/${state.importId}`));
  }
  if (state.phase === "uploading") {
    if (!(await uploadSlice(state, input, ctx, client))) return ctx.continue(state, progressOf(state));
  }
  while (["importing", "rolling_back"].includes(state.phase) && ctx.timeLeft() > 5_000) {
    const remote = await client.request(`/imports/${state.importId}/${state.phase === "rolling_back" ? "rollback" : "step"}`, "POST");
    applyRemotePhase(state, remote);
  }
  if (["importing", "rolling_back", "uploading"].includes(state.phase)) return ctx.continue(state, progressOf(state));
  if (state.phase === "review_required") return ctx.needsUser(state, `Review the import before it is activated.${state.stats ? ` ${statsText(state.stats)}` : ""}${state.skipped ? ` ${plural(state.skipped.count, "file")} skipped: ${NOT_ACCEPTED}.` : ""} Approve or roll back in WordPress Manager.`, progressOf(state));
  if (state.phase === "verification_required") return ctx.needsUser(state, "Verify the destination site, then finish or roll back the import in WordPress Manager.", progressOf(state));
  return ctx.done({ importId: state.importId, kind: state.kind, status: state.phase, phase: state.remotePhase ?? state.phase, fileCount: state.fileCount ?? 0, totalBytes: state.totalBytes ?? 0,
    ...(state.stats ? { stats: state.stats } : {}), ...(state.transfer ? { transfer: state.transfer } : {}), ...(state.warnings ? { warnings: state.warnings } : {}), ...(state.skipped ? { skipped: state.skipped } : {}), cleanedUp: state.cleanedUp === true,
    summary: state.phase === "complete" ? `Import complete on ${client.endpoint.origin}.` : `Import rolled back on ${client.endpoint.origin}; nothing was activated.` }, { phase: state.phase });
}

/** Cleanup slice after a cancel: roll the remote import back (best effort, bounded). */
export async function cancelPush(state, input, ctx) {
  // "submitting": the import may exist if the creating slice was lost; a rollback of a missing
  // import is a harmless 404.
  if (!state || state.phase === "creating" || TERMINAL.includes(state.phase)) return;
  const client = connectClient(ctx.host, endpointOf(ctx.request, state.siteId), state.generation);
  for (let calls = 0; calls < 10 && ctx.timeLeft() > 5_000; calls++) {
    const remote = await client.request(`/imports/${state.importId}/rollback`, "POST").catch(() => null);
    if (!remote || remote.rollbackRefused || ["rolled_back", "cancelled", "complete"].includes(remote.phase ?? remote.status)) return;
  }
}

/** Import phases before the fence: a rollback there only cancels (nothing live has changed). */
const PRE_FENCE = ["uploading", "reusing_artifacts", "checking_artifacts", "scanning_database", "mapping_authors", "snapshotting"];

/**
 * After a definite refusal, an import still before the fence is cancelled so it does not stay
 * staged on the site; one past the fence is left for the user to roll back or finish.
 */
async function cancelRefusedImport(state, input, ctx) {
  if (!state?.importId || !["uploading", "importing"].includes(state.phase)) return;
  const client = connectClient(ctx.host, endpointOf(ctx.request, state.siteId), state.generation);
  const current = await client.request(`/imports/${state.importId}`);
  if (!PRE_FENCE.includes(current?.phase ?? current?.status)) return;
  const remote = await client.request(`/imports/${state.importId}/rollback`, "POST");
  if (["cancelled", "rolled_back"].includes(remote?.phase ?? remote?.status)) state.cancelledImport = true;
}

export const pushSpec = (kind) => ({
  start: (input, ctx) => startPush(kind, input, ctx), step: stepPush, cancel: cancelPush, changed: CHANGED,
  definiteFailures: true,
  onDefiniteFailure: cancelRefusedImport,
  failureOutput: (state, input) => ({ importId: state?.importId ?? input.importId ?? null, kind, phase: state?.remotePhase ?? state?.phase ?? "creating",
    ...(state?.fileCount !== undefined ? { fileCount: state.fileCount, totalBytes: state.totalBytes ?? 0 } : {}), ...(state?.skipped ? { skipped: state.skipped } : {}),
    ...(state?.cancelledImport ? { cancelledImport: true } : {}) }),
});

// ---------------------------------------------------------------------------------------------
// Controls of a remote import (approve after review, finish after verification, roll back, clean up)
// ---------------------------------------------------------------------------------------------

export async function pushControl(input, { host, request }) {
  if (!HEX32.test(input.importId ?? "")) fail("A valid import ID is required.");
  await assertPluginEngine(host, input.siteId);
  const client = connectClient(host, endpointOf(request, input.siteId));
  const id = input.importId;
  const phaseOf = (remote) => remote?.phase ?? remote?.status;
  if (input.control === "approve") {
    const current = await client.request(`/imports/${id}`);
    if (phaseOf(current) !== "review_required") fail("This import is not waiting for review.");
    const remote = await client.request(`/imports/${id}/approve`, "POST");
    return { importId: id, control: "approve", phase: String(phaseOf(remote) ?? "importing"), summary: "Import approved. Resume the push to activate it." };
  }
  if (input.control === "finish") {
    const remote = await client.request(`/imports/${id}/finish`, "POST");
    if (phaseOf(remote) !== "complete") fail("Destination has not completed verification.");
    return { importId: id, control: "finish", phase: "complete", summary: "Import finished." };
  }
  if (input.control === "rollback") {
    let remote;
    try { remote = await client.request(`/imports/${id}/rollback`, "POST"); }
    catch (error) {
      const status = await client.request(`/imports/${id}`).catch(() => null);
      if (!status?.rollbackRefused) throw error;
      fail("The destination changed after this import. Rollback was refused before changing data.");
    }
    if (remote?.rollbackRefused) fail("The destination changed after this import. Rollback was refused before changing data.");
    // Step the rollback to its end here (bounded), so a finished push with no run to resume still rolls back.
    const deadline = Date.now() + 120_000;
    for (let calls = 0; calls < 60 && phaseOf(remote) === "rolling_back" && Date.now() < deadline; calls++) remote = await client.request(`/imports/${id}/rollback`, "POST");
    const phase = phaseOf(remote);
    return { importId: id, control: "rollback", phase: String(phase ?? "rolling_back"), summary: ["rolled_back", "cancelled"].includes(phase) ? "Import rolled back." : "Rolling back. Resume the push to finish the rollback." };
  }
  if (input.control === "cleanup") {
    const current = await client.request(`/imports/${id}`);
    if (!TERMINAL.includes(phaseOf(current))) fail("Clean up after the import completes, rolls back or is cancelled.");
    let cleanedUp = current?.cleanedUp === true;
    const deadline = Date.now() + 120_000;
    for (let calls = 0; calls < 60 && !cleanedUp && Date.now() < deadline; calls++) cleanedUp = (await client.request(`/imports/${id}/cleanup`, "POST"))?.cleanedUp !== false;
    return { importId: id, control: "cleanup", phase: String(phaseOf(current)), cleanedUp, summary: cleanedUp ? "Staged import files removed from the destination." : "Cleanup continues; run it again." };
  }
  fail("Choose approve, finish, rollback or cleanup.");
}
