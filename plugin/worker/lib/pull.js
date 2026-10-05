// `transfer.pull` (Zoer Connect site → file set) and `transfer.local-export` (DDEV site → file
// set) on S1 slices, S2 file sets, S3 downloads and S7b endpoint auth. The remote protocol and
// every check follow the legacy host engine (`WordPressPullStore.step` in Zoer
// `backend/src/wordpress-pull.ts`); bytes move host-side (`transfer.download`), never through the
// worker.
import { assertPluginEngine, commitRecords, historyRecord, listKind, readRecord } from "./catalog.js";
import { checkSelection, normalizeConnectUrl, parsePullSource, parseSkipped, validatePullFiles } from "./files.js";
import { declareEntries, deleteSet, describeSet, setIdFor } from "./filesets.js";
import { assertExportCapabilities, pullOptionsFrom } from "./options.js";
import { fail, stopIfPaused, TransferError } from "./slices.js";
import { connectClient, parseStatus, siteEndpoint } from "./zoer-connect.js";

export const HEX32 = /^[a-f0-9]{32}$/;
const PREPARATION_KEYS = ["table", "tables", "rows", "rowsPart", "bytes", "fileBytes", "fileOffset"];
const RUNTIME_ALIAS = "wordpress_site";

/** A 32-hex ID from the run (stable across slices) when the caller gave none. */
export function runHex(request) {
  const hex = String(request.run?.id ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");
  return (hex + "0".repeat(32)).slice(0, 32);
}

// ---------------------------------------------------------------------------------------------
// Sources: a Zoer Connect endpoint, or a DDEV site through the bridge's export operations.
// ---------------------------------------------------------------------------------------------

function remoteSource(host, request, state) {
  const endpoint = siteEndpoint(request, state.siteId);
  if (!endpoint) fail("This site's connection was removed. Add the site again in WordPress Manager.", { code: "endpoint_unbound" });
  const client = connectClient(host, endpoint, state.generation ?? endpoint.generation);
  const root = state.paged ? "/exports/paged" : "/exports";
  return {
    client,
    create: (body) => client.request(root, "POST", body),
    step: (id) => client.request(`${root}/${id}/step`, "POST"),
    manifest: (id, offset) => client.request(`${root}/${id}/manifest?offset=${offset}`),
    peer: (id) => client.peer(state.paged ? `exports/paged/${id}/batch` : `exports/${id}/chunks`),
    protocol: state.paged ? "chunk-batch-json-v1" : "chunked-json-v1",
    remove: (id) => client.request(`${root}/${id}`, "DELETE"),
    sameSource: (url) => { try { return normalizeConnectUrl(String(url).replace(/\/+$/, "")) === normalizeConnectUrl(endpoint.origin); } catch { return false; } },
  };
}

function localSource(host, state) {
  const invoke = async (operation, args) => {
    try { return await host.call("runtime.invoke", { alias: RUNTIME_ALIAS, operation, resourceId: state.siteId, args }); }
    catch (error) {
      if (error?.name !== "HostCallError" || error.code === "ZOER_PAUSED") throw error;
      if (["capability_denied", "resource_unbound", "invalid_request", "runtime_permission"].includes(error.code)) throw new TransferError(error.message, { code: error.code });
      throw new TransferError("The local export worker could not complete this operation. Retrying.", { code: error.code, transient: true });
    }
  };
  const normalize = (raw) => { const job = raw?.job ?? raw; if (job && ["pending", "running"].includes(job.status)) job.status = "preparing"; return job; };
  return {
    create: async (body) => normalize(await invoke("export.create.v1", { clientId: body.clientId, profile: body.profile, database: body.database })),
    step: async (id) => normalize(await invoke("export.step.v1", { exportId: id })),
    peer: (id) => ({ runtime: { alias: RUNTIME_ALIAS, resourceId: state.siteId, operation: "export.chunk.v1", args: { exportId: id } } }),
    protocol: "chunked-json-v1",
    remove: (id) => invoke("export.cancel.v1", { exportId: id }),
    // The bridge is Zoer's own DDEV agent: it names the site's canonical home.
    sameSource: (url) => typeof url === "string" && /^https?:\/\//i.test(url) && url.length < 2048,
  };
}

const sourceOf = (host, request, state) => state.kind === "local-export" ? localSource(host, state) : remoteSource(host, request, state);

// ---------------------------------------------------------------------------------------------
// Start: options, capability checks and the pull record skeleton.
// ---------------------------------------------------------------------------------------------

/** Newest ready media pull of the site (media "since-last"). */
async function lastMediaDate(host, siteId) {
  const pulls = (await listKind(host, "pull")).map(r => r.data).filter(d => d?.siteId === siteId && d.status !== "dry-run" && d.finishedAt && d.options?.profile?.media);
  pulls.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return pulls[0] ? String(pulls[0].createdAt).slice(0, 10) : null;
}

export async function startPull(kind, input, ctx) {
  const { host, request } = ctx;
  if (typeof input.siteId !== "string" || !input.siteId) fail("Choose a site.");
  const pullId = input.pullId ?? runHex(request);
  if (!HEX32.test(pullId)) fail("A valid transfer request ID is required.");
  await assertPluginEngine(host, input.siteId);
  if (input.snapshotMode !== undefined && input.snapshotMode !== "maintenance") fail("Choose a valid snapshot mode.");
  const media = input.exportOptions?.media?.mode === "since-last" ? await lastMediaDate(host, input.siteId) : null;
  const options = pullOptionsFrom(input.exportOptions, media);
  const state = { v: 1, kind, siteId: input.siteId, pullId, options, phase: "preparing", remoteCreated: false, setId: setIdFor(pullId), declared: 0, total: null, hasDatabase: false, bytes: 0, cursor: { index: 0, offset: 0 }, dryRun: input.dryRun === true, startedAt: new Date(ctx.now()).toISOString() };
  if (kind === "pull") {
    const endpoint = siteEndpoint(request, input.siteId);
    if (!endpoint) fail("This site's connection was removed. Add the site again in WordPress Manager.", { code: "endpoint_unbound" });
    state.generation = endpoint.generation;
    const status = parseStatus(endpoint.origin, await connectClient(host, endpoint).request("/status"));
    const caps = status.capabilities ?? {};
    const pull = status.permissions?.pull === true && caps.pull === true;
    if (!pull) fail("This plugin cannot export. Install a verified version supporting Pull, enable Pull in WordPress, and test the connection.");
    if (status.stagingReady !== true) fail(typeof status.storage?.message === "string" && status.storage.message.length <= 500 ? status.storage.message : "Private storage is unavailable on the source. Open WordPress → Tools → Zoer Connect to configure storage before pulling.");
    assertExportCapabilities(options, caps, "the source");
    const maintenance = input.snapshotMode === "maintenance";
    if (maintenance && (input.sourceQuiescenceAccepted !== true || !options.database || status.permissions?.push !== true || caps.resumableDatabaseExport !== true || options.profile.core)) {
      fail("Confirm source writers are stopped, enable Push and Pull, and complete request protection in Zoer Connect 0.5.0 before pausing the source.");
    }
    state.paged = caps.pagedExport === true && options.profile.core !== true;
    if (caps.blockDigestExport === true && options.profile.core !== true) state.largeTransfer = true;
    if (maintenance) state.snapshotMode = "maintenance";
    state.origin = endpoint.origin;
  } else {
    const { resource } = await host.call("runtime.invoke", { alias: RUNTIME_ALIAS, operation: "runtime.inspect.v1", resourceId: input.siteId, args: {} });
    if (resource?.status !== "running") fail("Choose a running managed DDEV source.");
    state.paged = false;
  }
  return state;
}

// ---------------------------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------------------------

const progressOf = (state) => state.phase === "preparing"
  ? { phase: "preparing", ...(state.total ? { done: state.declared, total: state.total, unit: "files" } : {}), ...(state.preparation?.phase ? { message: `Remote export: ${state.preparation.phase}` } : {}) }
  : { phase: state.phase, done: state.downloaded ?? 0, total: state.bytes, unit: "bytes" };

function pullRecord(state, status, extra = {}) {
  return {
    id: `pull:${state.pullId}`, kind: "pull", title: `${state.kind === "local-export" ? "Local export" : "Pull"} ${state.pullId.slice(0, 8)}`,
    data: { v: 1, pullId: state.pullId, siteId: state.siteId, kind: state.kind, setId: status === "ready" ? state.setId : null, status, options: state.options,
      ...(state.origin ? { origin: state.origin } : {}), fileCount: state.total ?? state.declared, totalBytes: state.bytes, createdAt: state.startedAt, engine: "plugin", ...extra },
  };
}

/**
 * Preparation budget. A further remote export step starts only while the slice has more than
 * the paged-manifest loop's 10 s left (after `SLICE_RESERVE_MS`) plus the slowest step seen in
 * this slice, so a slow source step still returns before the deadline. Steps follow each other
 * with no pause, like the host engine's runner (`WordPressPullRunner` steps a preparing pull
 * back to back; it only holds between steps for transient-failure backoff, which S1 retries do).
 */
const PREPARE_TIME_LEFT_MS = 10_000;

/** One remote job answer while preparing: create once, then poll; identity and status are checked. */
async function pollExport(state, source) {
  const id = state.pullId;
  let current;
  if (!state.remoteCreated) {
    // Creation is submitted once; afterwards the job is only polled (the DDEV bridge restarts a failed export on POST).
    const body = { ...state.options, clientId: id, ...(state.largeTransfer ? { largeTransfer: true } : {}), ...(state.snapshotMode ? { snapshotMode: state.snapshotMode, sourceQuiescenceAccepted: true } : {}) };
    current = await source.create(body);
    current = current?.job ?? current;
    if (current?.id !== id) fail("Remote export identity mismatch.");
    state.remoteCreated = true;
    if (current.status !== "ready") { current = await source.step(id); current = current?.job ?? current; }
  } else {
    current = await source.step(id); current = current?.job ?? current;
  }
  if (current?.id !== id || !["preparing", "ready"].includes(current.status)) fail("Remote export is incomplete or unavailable.");
  if (state.paged) {
    state.preparation = { phase: String(current.phase), files: Number(current.fileCount) || 0, ...(current.sourcePaused === true ? { sourcePaused: true } : {}),
      ...(current.checkpoint && typeof current.checkpoint === "object" ? { checkpoint: Object.fromEntries(Object.entries(current.checkpoint).filter(([key, value]) => PREPARATION_KEYS.includes(key) && Number.isSafeInteger(value) && value >= 0 && value <= 64 * 1024 ** 3)) } : {}) };
  }
  return current;
}

/**
 * Steps the remote export until it is ready, its manifest is declared, or the slice budget runs
 * out; returns true once the export is ready and declared. At least one step runs per slice.
 */
async function prepare(state, ctx, source) {
  const { host } = ctx;
  const id = state.pullId;
  let current, slowest = 0;
  for (let first = true; ; first = false) {
    if (!first) {
      if (ctx.timeLeft() <= PREPARE_TIME_LEFT_MS + slowest) return false;
      stopIfPaused(ctx);
    }
    const started = ctx.now();
    current = await pollExport(state, source);
    slowest = Math.max(slowest, ctx.now() - started);
    if (current.status === "ready") break;
    await ctx.progress(progressOf(state));
  }
  if (!(await validateSource(state, current, source))) fail("Export source information does not match this connection.");
  const set = { setId: state.setId, name: `${state.kind === "local-export" ? "Local export" : "Pull"} ${state.siteId}`.slice(0, 120), rules: "site-export", labels: { kind: state.kind, siteId: state.siteId, pullId: id } };
  if (state.paged) {
    if (!Number.isSafeInteger(current.fileCount) || current.fileCount < 0 || current.fileCount > 100000) fail("Invalid manifest size.");
    if (state.total !== null && state.total !== current.fileCount) fail("Export manifest changed.");
    state.total = current.fileCount;
    const seen = new Set();
    // Pages of ≤ 500 files until the manifest is declared or the slice runs out of time. Like the
    // host engine, the export is polled again before every further page (it must stay ready).
    for (let first = true; state.declared < state.total && ctx.timeLeft() > PREPARE_TIME_LEFT_MS; first = false) {
      if (!first) {
        stopIfPaused(ctx);
        const again = await source.step(id);
        const job = again?.job ?? again;
        if (job?.id !== id || job.status !== "ready") fail("Remote export is incomplete or unavailable.");
        if (job.fileCount !== state.total) fail("Export manifest changed.");
      }
      const page = await source.manifest(id, state.declared);
      if (page?.id !== id || page.offset !== state.declared || page.total !== current.fileCount || !Array.isArray(page.files) || page.files.length > 500 || !page.files.length || state.declared + page.files.length > current.fileCount) fail("Invalid manifest page.");
      const files = validatePullFiles(page.files, seen);
      checkSelection(files, state.options);
      if (files.some(f => f.path === "database.sql")) state.hasDatabase = true;
      await declareEntries(host, set, files, state.declared);
      state.declared += files.length;
      state.bytes += files.reduce((sum, f) => sum + f.bytes, 0);
    }
    if (state.declared < state.total) return false;
  } else {
    const files = validatePullFiles(current.files);
    checkSelection(files, state.options);
    state.hasDatabase = files.some(f => f.path === "database.sql");
    await declareEntries(host, set, files, 0);
    state.total = state.declared = files.length;
    state.bytes = files.reduce((sum, f) => sum + f.bytes, 0);
  }
  if (state.options.database && !state.hasDatabase) fail("The database snapshot is missing.");
  if (!state.total) await declareEntries(host, set, [], 0);
  // Source and skipped list go to the catalog (the checkpoint stays small).
  const { skipped, skippedCount } = parseSkipped(current);
  await commitRecords(host, [pullRecord(state, "downloading", { source: parsePullSource(current.source), skipped, skippedCount })]);
  state.phase = "downloading";
  return true;
}

async function validateSource(state, current, source) {
  const src = current.source;
  return !!src && typeof src.url === "string" && source.sameSource(src.url) && typeof src.prefix === "string" && /^[A-Za-z0-9_]{1,48}$/.test(src.prefix);
}

/** Downloads with `transfer.download` until complete or the slice ends. */
async function download(state, ctx, source) {
  const { host } = ctx;
  while (ctx.timeLeft() > 5_000) {
    let result;
    try {
      result = await host.call("transfer.download", { transferId: `pull-${state.pullId}`, setId: state.setId, source: source.peer(state.pullId), protocol: source.protocol, cursor: state.cursor, maxChunks: state.paged ? 32 : 8 });
    } catch (error) {
      if (error?.code === "transfer_integrity") throw new TransferError("Export file integrity check failed. Resume to retry this file.", { needsUser: true, code: error.code });
      throw error;
    }
    state.cursor = result.cursor;
    state.downloaded = (state.downloaded ?? 0) + (result.appendedBytes ?? 0);
    if (result.complete) return true;
    if (result.transient) throw new TransferError(result.transient.message || "The source is busy. Retrying shortly.", { transient: true, retryAfterMs: result.retryAfterMs });
    if (result.stopped) return false;
  }
  return false;
}

export async function stepPull(state, input, ctx) {
  const { host } = ctx;
  const source = sourceOf(host, ctx.request, state);
  if (state.phase === "preparing") {
    // The slice ran out of time: continue at once (the host engine polls without a pause too).
    if (!(await prepare(state, ctx, source))) return ctx.continue(state, progressOf(state), 0);
  }
  if (state.phase === "downloading") {
    if (!(await download(state, ctx, source))) return ctx.continue(state, progressOf(state));
    state.phase = "sealing";
  }
  if (state.phase === "sealing") {
    if (state.dryRun) {
      // Dry run: verified download into a scratch set, never kept as a pull.
      await deleteSet(host, state.setId);
      await source.remove(state.pullId).catch(() => {});
      state.phase = "recording";
      state.result = "dry-run";
    } else {
      try { await host.call("fileset.seal", { setId: state.setId }); }
      catch (error) {
        if (error?.code === "fileset_integrity") throw new TransferError("Downloaded file changed while it was verified. Resume to retry.", { needsUser: true, code: error.code });
        if (error?.code !== "fileset_sealed") throw error; // a replayed slice: already sealed
      }
      state.phase = "recording";
      state.result = "ready";
    }
  }
  const finishedAt = new Date(ctx.now()).toISOString();
  const record = await readRecord(host, `pull:${state.pullId}`);
  const kept = record?.data ?? {};
  await commitRecords(host, [
    pullRecord(state, state.result, { source: kept.source, skipped: kept.skipped ?? [], skippedCount: kept.skippedCount ?? 0, finishedAt }),
    historyRecord({ kind: state.kind, id: state.pullId, siteId: state.siteId, status: state.result, startedAt: state.startedAt, finishedAt, bytes: state.bytes,
      summary: `${state.result === "dry-run" ? "Dry run: " : ""}${state.total} files (${state.bytes.toLocaleString("en-US")} bytes) ${state.kind === "local-export" ? "exported" : "pulled"}`, runId: ctx.request.run?.id }),
  ]);
  return ctx.done({ pullId: state.pullId, kind: state.kind, status: state.result, setId: state.result === "ready" ? state.setId : null, fileCount: state.total, totalBytes: state.bytes,
    skippedCount: kept.skippedCount ?? 0, source: kept.source ? { url: kept.source.url, prefix: kept.source.prefix } : null,
    summary: state.result === "dry-run" ? `Dry run verified ${state.total} files; nothing was kept.` : `${state.total} files verified and kept.` }, { phase: "done", done: state.bytes, total: state.bytes, unit: "bytes" });
}

/** Cleanup slice after a cancel: the remote export and the local partial set go, like the host engine's cancel. */
export async function cancelPull(state, input, ctx) {
  if (!state) return;
  const { host } = ctx;
  if (state.phase !== "recording") await deleteSet(host, state.setId).catch(() => {});
  if (state.remoteCreated) await sourceOf(host, ctx.request, state).remove(state.pullId).catch(() => {});
  const record = await readRecord(host, `pull:${state.pullId}`).catch(() => null);
  if (record && record.data?.status === "downloading") await commitRecords(host, [pullRecord(state, "cancelled", { source: record.data.source, finishedAt: new Date(ctx.now()).toISOString() })]).catch(() => {});
}

export const pullSpec = (kind) => ({
  start: (input, ctx) => startPull(kind, input, ctx),
  step: stepPull,
  cancel: cancelPull,
  changed: "This connection changed. Cancel the old pull and start a new one.",
});

/** Pull metadata of a sealed set, from its catalog record (push sources, local copies). */
export async function pullOfSet(host, setId) {
  const set = await describeSet(host, setId);
  if (!set || set.status !== "sealed") fail("Choose a verified local export or completed pull as the source.");
  const pullId = set.labels?.pullId;
  const record = pullId ? await readRecord(host, `pull:${pullId}`) : null;
  const data = record?.data;
  // Migrated host-engine pulls carry `status: "ready"` too; older migration records may lack it.
  if (!data || data.setId !== setId || (data.status ?? (data.engine === "legacy-migrated" ? "ready" : null)) !== "ready") fail("Choose a verified local export or completed pull as the source.");
  return { set, pull: data };
}
