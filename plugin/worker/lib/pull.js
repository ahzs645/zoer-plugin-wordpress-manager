// `transfer.pull` (Zoer Connect site → file set) and `transfer.local-export` (DDEV site → file
// set) on S1 slices, S2 file sets, S3 downloads and S7b endpoint auth. The remote protocol and
// every check follow the legacy host engine (`WordPressPullStore.step` in Zoer
// `backend/src/wordpress-pull.ts`); bytes move host-side (`transfer.download`), never through the
// worker.
import { commitRecords, historyRecord, listKind, readRecord, recordFailedTransfer, selectionWords } from "./catalog.js";
import { checkSelection, normalizeConnectUrl, parsePullSource, parseSkipped, validatePullFiles } from "./files.js";
import { declareEntries, deleteSet, describeSet, setIdFor } from "./filesets.js";
import { assertExportCapabilities, pullOptionsFrom } from "./options.js";
import { fail, runtimeError, stopIfPaused, TransferError } from "./slices.js";
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
      throw runtimeError(error, "The local export worker could not complete this operation.");
    }
  };
  const normalize = (raw) => { const job = raw?.job ?? raw; if (job && ["pending", "running"].includes(job.status)) job.status = "preparing"; return job; };
  return {
    create: async (body) => normalize(await invoke("export.create.v1", localExportArgs(state, body))),
    step: async (id) => normalize(await invoke("export.step.v1", { exportId: id })),
    peer: (id) => ({ runtime: { alias: RUNTIME_ALIAS, resourceId: state.siteId, operation: "export.chunk.v1", args: { exportId: id } } }),
    protocol: "chunked-json-v1",
    /** Steps and chunk reads are runtime calls (the slice's runtime call budget). */
    runtime: true,
    remove: (id) => invoke("export.cancel.v1", { exportId: id }),
    // The bridge echoes the source URL it was given: the site's Zoer address, like the host engine
    // (checkpoints from before 0.7.1 sent none and accept the bridge's own address).
    sameSource: (url) => {
      if (!state.sourceUrl) return typeof url === "string" && /^https?:\/\//i.test(url) && url.length < 2048;
      try { return normalizeConnectUrl(String(url)) === state.sourceUrl; } catch { return false; }
    },
  };
}

/**
 * The full-snapshot filters: the DDEV bridge's export worker writes exactly the same SQL for
 * this object as for the host engine's `database: true` (transients and Zoer Connect secrets
 * skipped, every table and row kept). See `connect-export-worker.php` in Zoer's ddev-bridge.
 */
export const FULL_DATABASE_FILTERS = Object.freeze({ postTypes: null, excludeRevisions: false, excludeSpam: false, excludeTransients: true });

/**
 * `export.create.v1` args: the body the host engine's local-export route sends to the bridge
 * (`requestLocalExport` in Zoer `backend/src/wordpress-local-export.ts`: id, sourceUrl, profile,
 * database), shaped for the operation's input schema (`EXPORT_CREATE_INPUT_SCHEMA` in Zoer
 * `backend/src/connectors/ddev.ts`): filters are an object, false omits SQL.
 */
export function localExportArgs(state, body) {
  return { clientId: body.clientId, ...(state.sourceUrl ? { sourceUrl: state.sourceUrl } : {}), profile: body.profile, database: body.database === true ? { ...FULL_DATABASE_FILTERS } : body.database };
}

const sourceOf = (host, request, state) => state.kind === "local-export" ? localSource(host, state) : remoteSource(host, request, state);

/**
 * The DDEV site's Zoer address (its `wp` route, the host engine's `managedUrl`), sent as the
 * export's source URL like the host engine does. Without it the bridge falls back to the DDEV
 * router address, which carries a port and is refused ("Invalid source URL.").
 */
async function localSiteAddress(host, siteId, resource) {
  let route;
  try { ({ route } = await host.call("routes.assign", { runtimeAlias: RUNTIME_ALIAS, resourceId: siteId, port: 80, name: String(resource?.name || siteId).slice(0, 100) })); }
  catch (error) {
    if (error?.name !== "HostCallError" || error.code === "ZOER_PAUSED") throw error;
    throw new TransferError(error.message || "This local site has no Zoer address.", { code: error.code });
  }
  return normalizeConnectUrl(String(route?.url ?? ""));
}

// ---------------------------------------------------------------------------------------------
// Start: options, capability checks and the pull record skeleton.
// ---------------------------------------------------------------------------------------------

/** Pause between download requests at the "gentle" pace. */
const GENTLE_PAUSE_MS = 1_000;

/**
 * Newest successful, kept media download of the site (media "since-last"). Failed, cancelled,
 * deleted and dry-run downloads also have a finish time but never advance the baseline; an old
 * record without a status counts only when it kept a file set.
 */
export function mediaBaseline(records, siteId) {
  const kept = d => d.status === "ready" || (d.status === undefined && typeof d.setId === "string" && !!d.setId);
  const pulls = records.filter(d => d?.siteId === siteId && kept(d) && d.options?.profile?.media);
  pulls.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return pulls[0] ? String(pulls[0].createdAt).slice(0, 10) : null;
}

async function lastMediaDate(host, siteId) {
  return mediaBaseline((await listKind(host, "pull")).map(r => r.data), siteId);
}

export async function startPull(kind, input, ctx) {
  const { host, request } = ctx;
  if (typeof input.siteId !== "string" || !input.siteId) fail("Choose a site.");
  if (input.releaseSource === true) return startSourceRelease(kind, input, ctx);
  if (input.remove === true) return startRemoval(kind, input, ctx);
  const pullId = input.pullId ?? runHex(request);
  if (!HEX32.test(pullId)) fail("A valid transfer request ID is required.");
  if (input.snapshotMode !== undefined && input.snapshotMode !== "maintenance") fail("Choose a valid snapshot mode.");
  if (input.pace !== undefined && !["normal", "gentle"].includes(input.pace)) fail("Choose a normal or gentle transfer pace.");
  const media = input.exportOptions?.media?.mode === "since-last" ? await lastMediaDate(host, input.siteId) : null;
  const options = pullOptionsFrom(input.exportOptions, media);
  const state = { v: 1, kind, siteId: input.siteId, pullId, options, phase: "preparing", remoteCreated: false, setId: setIdFor(pullId), declared: 0, total: null, hasDatabase: false, bytes: 0, cursor: { index: 0, offset: 0 }, dryRun: input.dryRun === true, startedAt: new Date(ctx.now()).toISOString(), ...(input.pace === "gentle" ? { pace: "gentle" } : {}) };
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
    state.sourceUrl = await localSiteAddress(host, input.siteId, resource);
    state.paged = false;
    if (input.recover !== true && (await earlierStagings(host, state, ctx.now())).length) state.releaseEarlier = true;
  }
  if (input.recover === true) {
    const record = await readRecord(host, `pull:${pullId}`);
    const kept = record?.data;
    if (!kept || kept.siteId !== state.siteId || kept.kind !== kind || kept.pullId !== pullId || input.dryRun === true ||
        JSON.stringify(kept.options) !== JSON.stringify(options) || (kind === "pull" && kept.origin !== state.origin)) fail("Choose the original download and its unchanged connection to recover it.");
    const set = await describeSet(host, state.setId);
    if (!set || set.labels?.pullId !== pullId || set.labels?.siteId !== state.siteId || set.entryCount !== kept.fileCount || set.totalBytes !== kept.totalBytes) fail("The saved download is unavailable. Start a new pull.");
    // A killed worker can leave a fully verified set. Finalize its receipt without touching the source.
    if (set.status === "sealed") {
      state.phase = "recording"; state.result = "ready";
      state.total = kept.fileCount; state.bytes = kept.totalBytes; state.startedAt = kept.createdAt;
    }
    // Otherwise create() reuses the source's idempotent export; S3 reconciles its durable cursor.
  }
  return state;
}

// ---------------------------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------------------------

const progressOf = (state) => state.phase === "preparing"
  ? { phase: "preparing", ...(state.total ? { done: state.declared, total: state.total, unit: "files" } : {}), ...(preparationMessage(state.preparation) ? { message: preparationMessage(state.preparation) } : {}) }
  : state.phase === "sealing" ? { phase: "sealing", done: state.verified ?? 0, total: state.total, unit: "files", message: state.verifiedBytes !== undefined ? `Verifying downloaded files · ${state.verified ?? 0} / ${state.total} files` : "Verifying downloaded files", ...(state.verifiedBytes !== undefined ? { done: state.verifiedBytes, total: state.bytes, unit: "bytes" } : {}) }
    : { phase: state.phase, done: state.downloaded ?? 0, total: state.bytes, unit: "bytes" };

/** "Remote export: 120 files (database)": the files the source has listed so far, then its phase. */
export function preparationMessage(preparation) {
  if (!preparation) return undefined;
  const files = Number.isSafeInteger(preparation.files) && preparation.files > 0 ? `${preparation.files.toLocaleString("en-US")} ${preparation.files === 1 ? "file" : "files"}` : "";
  const phase = typeof preparation.phase === "string" && /^[A-Za-z0-9 _.-]{1,40}$/.test(preparation.phase) && preparation.phase !== "undefined" ? preparation.phase.replaceAll("_", " ") : "";
  if (!files && !phase) return undefined;
  return `Remote export: ${files || phase}${files && phase ? ` (${phase})` : ""}`;
}

function pullRecord(state, status, extra = {}) {
  return {
    id: `pull:${state.pullId}`, kind: "pull", title: `${state.kind === "local-export" ? "Local export" : "Pull"} ${state.pullId.slice(0, 8)}`,
    data: { v: 1, pullId: state.pullId, siteId: state.siteId, kind: state.kind, setId: status === "ready" ? state.setId : null, status, options: state.options,
      ...(state.origin ? { origin: state.origin } : {}), ...(state.kind === "pull" ? { paged: state.paged === true } : {}), fileCount: state.total ?? state.declared, totalBytes: state.bytes, createdAt: state.startedAt, engine: "plugin", ...extra },
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
/**
 * At most this many remote export steps per slice, within the pull's network budget (2,000
 * requests per slice) for Zoer Connect. DDEV bridge steps are runtime calls and also stop when
 * the slice's shared runtime call budget (`ctx.runtimeLeft()`) runs out.
 */
const PREPARE_MAX_STEPS = 200;
/** Output a declared manifest page of ≤ 500 files can take (the page request, its catalog call, framing). */
const MANIFEST_PAGE_OUTPUT = 512 * 1024;

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
  if (!state.paged && Number.isSafeInteger(current.fileCount) && current.fileCount > 0) {
    // Whole-manifest sources report a count too while preparing; shown on the run card.
    state.preparation = { phase: typeof current.phase === "string" ? current.phase.slice(0, 40) : "", files: current.fileCount };
  }
  if (state.paged) {
    state.preparation = { phase: String(current.phase), files: Number(current.fileCount) || 0, ...(current.sourcePaused === true ? { sourcePaused: true } : {}),
      ...(current.checkpoint && typeof current.checkpoint === "object" ? { checkpoint: Object.fromEntries(Object.entries(current.checkpoint).filter(([key, value]) => PREPARATION_KEYS.includes(key) && Number.isSafeInteger(value) && value >= 0 && value <= 64 * 1024 ** 3)) } : {}) };
  }
  return current;
}

/**
 * Steps the remote export until it is ready, its manifest is declared, or the slice budget (time
 * or step count) runs out; returns true once the export is ready and declared. At least one step
 * runs per slice.
 */
async function prepare(state, ctx, source) {
  const { host } = ctx;
  const id = state.pullId;
  let current, slowest = 0;
  for (let steps = 0; ; steps++) {
    if (steps > 0) {
      if (steps >= PREPARE_MAX_STEPS || ctx.timeLeft() <= PREPARE_TIME_LEFT_MS + slowest || (source.runtime && ctx.runtimeLeft() < 1)) return false;
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
    // Each page goes to the host in one `fileset.*` call: it must fit the slice's output budget.
    for (let first = true; state.declared < state.total && ctx.timeLeft() > PREPARE_TIME_LEFT_MS && ctx.outputLeft() > MANIFEST_PAGE_OUTPUT; first = false) {
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
      if (!(await declareEntries(host, set, files, state.declared, { canSend: ctx.canSend })).complete) return false;
      state.declared += files.length;
      state.bytes += files.reduce((sum, f) => sum + f.bytes, 0);
    }
    if (state.declared < state.total) return false;
  } else {
    const files = validatePullFiles(current.files);
    checkSelection(files, state.options);
    state.hasDatabase = files.some(f => f.path === "database.sql");
    // Large whole manifests are declared over several slices (each re-polls the ready export).
    if (!(await declareEntries(host, set, files, 0, { canSend: ctx.canSend })).complete) return false;
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
    // Each chunk read from a runtime peer (the DDEV bridge) is one runtime call.
    // "gentle" pace (shared live hosts): two chunks per request and a pause between requests.
    const maxChunks = state.pace === "gentle" ? Math.min(2, source.runtime ? ctx.runtimeLeft() : 2) : source.runtime ? Math.min(8, ctx.runtimeLeft()) : state.paged ? 32 : 8;
    if (maxChunks < 1) return false;
    let result;
    try {
      result = await host.call("transfer.download", { transferId: `pull-${state.pullId}`, setId: state.setId, source: source.peer(state.pullId), protocol: source.protocol, cursor: state.cursor, maxChunks });
    } catch (error) {
      if (error?.code === "transfer_integrity") throw new TransferError("Export file integrity check failed. Resume to retry this file.", { needsUser: true, code: error.code });
      throw error;
    }
    state.cursor = result.cursor;
    state.downloaded = (state.downloaded ?? 0) + (result.appendedBytes ?? 0);
    await ctx.progress(progressOf(state));
    if (result.complete) return true;
    if (result.transient) throw new TransferError(result.transient.message || "The source is busy. Retrying shortly.", { transient: true, retryAfterMs: result.retryAfterMs });
    if (result.stopped) return false;
    if (state.pace === "gentle") {
      if (ctx.timeLeft() < GENTLE_PAUSE_MS + 6_000) return false;
      await new Promise(resolve => setTimeout(resolve, GENTLE_PAUSE_MS));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Delete (`remove: true`): the file set, the record and the export on the source, like the host
// engine's delete (`WordPressPullStore.remove`), which also cancels the remote export so the
// site accepts the next one ("Cancel an existing export before starting another.").
// ---------------------------------------------------------------------------------------------

/**
 * The DDEV bridge keeps at most two source stagings per site. A new local export frees the earlier
 * verified ones itself, within its own run and lock; their sealed downloads stay usable. (Separate
 * release runs would each hold the site's lock and refuse the export started right after them.
 * WP Migrate likewise clears the previous migration's leftovers as part of starting the next.)
 * A staging that cannot be released is left for the bridge's own "cancel first" answer. A refused
 * runtime call need not return a fresh ticket, so the first refusal ends the releases.
 *
 * Which jobs: the bridge purges a job 24 hours after it starts, so only younger exports of the site
 * can hold a slot, newest first. Unfinished ones (a run that failed or was abandoned mid-download,
 * a dry run) are released too: this run holds the site's transfer lock, so no other export of the
 * site is still running. A verified one is released only while its sealed download exists.
 */
const BRIDGE_EXPORT_TTL_MS = 24 * 3_600_000;
async function earlierStagings(host, state, now) {
  return (await listKind(host, "pull")).filter(r => r.data?.kind === "local-export" && r.data.siteId === state.siteId && r.data.pullId !== state.pullId
    && !r.data.sourceReleasedAt && now - Date.parse(r.data.createdAt) < BRIDGE_EXPORT_TTL_MS)
    .sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)));
}
async function releaseEarlierStagings(host, state, now) {
  const released = [];
  for (const record of await earlierStagings(host, state, now)) {
    if (record.data.status === "ready" && (!record.data.setId || (await describeSet(host, record.data.setId))?.status !== "sealed")) continue;
    let refused = null;
    try { await localSource(host, { siteId: state.siteId }).remove(record.data.pullId); }
    catch (error) { if (error?.code === "ZOER_PAUSED") throw error; refused = error; }
    // A staging the bridge no longer has counts as released.
    if (!refused || gone(refused)) released.push({ ...record, data: { ...record.data, sourceReleasedAt: new Date(now).toISOString() } });
    if (refused) break;
  }
  if (released.length) await commitRecords(host, released);
}

/** Release only a verified local export's disposable bridge staging. The sealed download stays. */
async function startSourceRelease(kind, input, ctx) {
  if (kind !== "local-export" || input.remove === true || !HEX32.test(input.pullId ?? "")) fail("Choose a verified local export.");
  const record = await readRecord(ctx.host, `pull:${input.pullId}`);
  const data = record?.data;
  if (!data || data.kind !== kind || data.siteId !== input.siteId || data.status !== "ready" || !data.setId) fail("Choose a verified local export of this site.");
  const set = await describeSet(ctx.host, data.setId);
  if (set?.status !== "sealed") fail("Keep a verified download before releasing its source staging.");
  return { v: 1, kind, siteId: input.siteId, pullId: input.pullId, setId: data.setId, phase: "releasing-source" };
}

async function stepSourceRelease(state, ctx) {
  // Revalidate on replay and just before cancellation; never remove the file set or its record.
  await startSourceRelease(state.kind, state, ctx);
  const remote = await removeRemoteExport(state, ctx);
  if (!remote.removed) fail(remote.error || "The local source staging could not be released.");
  const record = await readRecord(ctx.host, `pull:${state.pullId}`);
  await commitRecords(ctx.host, [{ ...record, data: { ...record.data, sourceReleasedAt: new Date(ctx.now()).toISOString() } }]);
  return ctx.done({ pullId: state.pullId, status: "source-released", setId: state.setId, summary: "Temporary source staging released; the verified download is still available." }, { phase: "done" });
}

async function startRemoval(kind, input, ctx) {
  const { host } = ctx;
  if (!HEX32.test(input.pullId ?? "")) fail("A valid transfer request ID is required.");
  const data = (await readRecord(host, `pull:${input.pullId}`))?.data ?? null;
  if (data && data.siteId !== input.siteId) fail("This download belongs to another site.");
  if (data?.status === "downloading") fail("This transfer is still running. Cancel it instead.");
  return { v: 1, kind, siteId: input.siteId, pullId: input.pullId, phase: "removing", setId: typeof data?.setId === "string" ? data.setId : setIdFor(input.pullId),
    ...(typeof data?.paged === "boolean" ? { paged: data.paged } : {}), startedAt: new Date(ctx.now()).toISOString() };
}

// The DDEV bridge answers a purged job's ID with the missing file's ENOENT.
const gone = (error) => error?.status === 404 || error?.status === 410 || /\b(not found|expired|unknown export|ENOENT|no such file)\b/i.test(String(error?.message ?? ""));

/** Removes the source's export: `{ removed: true }`, or `{ removed: false, error }` to show the user. */
/**
 * Removes a finished pull's export from its source (best effort). A local copy uses it once its
 * download is sealed: older Zoer Connect sources accept only one export at a time, so a kept export
 * would refuse the next refresh ("Cancel an existing export before starting another").
 */
export async function releaseRemoteExport(state, ctx) {
  return state?.remoteCreated ? removeRemoteExport(state, ctx).catch(() => ({ removed: false })) : { removed: false };
}

async function removeRemoteExport(state, ctx) {
  try {
    if (state.kind === "local-export") {
      await localSource(ctx.host, state).remove(state.pullId);
      return { removed: true };
    }
    const endpoint = siteEndpoint(ctx.request, state.siteId);
    if (!endpoint) return { removed: false, error: "This site's connection was removed, so its export could not be removed. Add the site again, or remove the export in WordPress → Tools → Zoer Connect." };
    const client = connectClient(ctx.host, endpoint);
    // Records from before 0.7.1 do not say which export API served the pull: try both.
    for (const root of state.paged === true ? ["/exports/paged"] : state.paged === false ? ["/exports"] : ["/exports/paged", "/exports"]) {
      try { await client.request(`${root}/${state.pullId}`, "DELETE"); return { removed: true }; }
      catch (error) { if (!gone(error)) throw error; }
    }
    return { removed: true };
  } catch (error) {
    if (error?.code === "ZOER_PAUSED") throw error;
    if (gone(error)) return { removed: true };
    return { removed: false, error: String(error?.message || "The source did not answer.").slice(0, 300) };
  }
}

async function stepRemoval(state, ctx) {
  const { host } = ctx;
  await deleteSet(host, state.setId);
  const remote = await removeRemoteExport(state, ctx);
  await commitRecords(host, [], [`pull:${state.pullId}`]);
  return ctx.done({ pullId: state.pullId, kind: state.kind, status: "deleted", remoteRemoved: remote.removed, ...(remote.error ? { remoteError: remote.error } : {}),
    summary: remote.removed ? "Download deleted; the export on the site was removed." : `Download deleted, but the export on the site could not be removed: ${remote.error}` }, { phase: "done" });
}

export async function stepPull(state, input, ctx) {
  const { host } = ctx;
  if (state.phase === "releasing-source") return stepSourceRelease(state, ctx);
  if (state.phase === "removing") return stepRemoval(state, ctx);
  if (state.releaseEarlier) {
    // Its own slice: a refused runtime call may spend the ticket, so the export starts in the next.
    await releaseEarlierStagings(host, state, ctx.now());
    delete state.releaseEarlier;
    return ctx.continue(state, progressOf(state), 0);
  }
  const source = sourceOf(host, ctx.request, state);
  if (state.phase === "preparing") {
    // The slice ran out of time: continue at once (the host engine polls without a pause too).
    await prepare(state, ctx, source);
    // Persist the manifest and phase before downloading; each expensive phase gets a fresh slice.
    return ctx.continue(state, progressOf(state), 0);
  }
  if (state.phase === "downloading") {
    if (!(await download(state, ctx, source))) return ctx.continue(state, progressOf(state));
    state.phase = "sealing";
    return ctx.continue(state, { phase: "sealing", done: 0, total: state.total, unit: "files", message: "Verifying downloaded files" }, 0);
  }
  if (state.phase === "sealing") {
    if (state.dryRun) {
      // Dry run: verified download into a scratch set, never kept as a pull.
      await deleteSet(host, state.setId);
      await source.remove(state.pullId).catch(() => {});
      state.phase = "recording";
      state.result = "dry-run";
    } else {
      try {
        for (let batches = 0; ; batches++) {
          // Host batches persist their own cursor. Keep time for one 20-second batch and the envelope.
          if (batches > 0 && (ctx.timeLeft() <= 30_000 || batches >= 40)) return ctx.continue(state, progressOf(state), 0);
          stopIfPaused(ctx);
          const result = await host.call("fileset.seal", { setId: state.setId, bounded: true });
          if (result.set?.status === "sealed") break;
          if (!Number.isSafeInteger(result.verification?.done) || result.verification.done < 0 || result.verification.done > state.total) fail("File verification did not return progress.");
          state.verified = result.verification.done;
          if (Number.isSafeInteger(result.verification.bytes) && result.verification.bytes >= 0 && result.verification.bytes <= state.bytes) state.verifiedBytes = result.verification.bytes;
          await ctx.progress(progressOf(state));
        }
      }
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
    ...(state.options.profile?.mediaSince ? { mediaSince: state.options.profile.mediaSince } : {}),
    summary: (state.result === "dry-run" ? `Dry run verified ${state.total} files; nothing was kept.` : `${state.total} files verified and kept.`) + (state.options.profile?.mediaSince ? ` Media since ${state.options.profile.mediaSince}.` : "") }, { phase: "done", done: state.bytes, total: state.bytes, unit: "bytes" });
}

/** Cleanup slice after a cancel: the remote export and the local partial set go, like the host engine's cancel. */
export async function cancelPull(state, input, ctx) {
  if (!state || state.phase === "releasing-source") return;
  const { host } = ctx;
  if (state.phase !== "recording") await deleteSet(host, state.setId).catch(() => {});
  if (state.remoteCreated) await sourceOf(host, ctx.request, state).remove(state.pullId).catch(() => {});
  const record = await readRecord(host, `pull:${state.pullId}`).catch(() => null);
  if (record && record.data?.status === "downloading") await commitRecords(host, [pullRecord(state, "cancelled", { source: record.data.source, finishedAt: new Date(ctx.now()).toISOString() })]).catch(() => {});
}

/** History record of a failed pull or local export (also when it failed before its first checkpoint). */
/**
 * A failed run leaves nothing behind, like a cancelled one (cancelPull): the partial file set,
 * the export on the source (which would block the site's next export) and a record stuck at
 * "downloading", which becomes "failed" with the error.
 */
async function cleanUpFailedPull(state, ctx, error) {
  const { host } = ctx;
  if (state.phase !== "recording") await deleteSet(host, state.setId).catch(() => {});
  if (state.remoteCreated && !(state.dryRun && state.phase === "recording")) await removeRemoteExport(state, ctx).catch(() => null);
  const record = await readRecord(host, `pull:${state.pullId}`).catch(() => null);
  if (record?.data?.status === "downloading") {
    await commitRecords(host, [pullRecord(state, "failed", { source: record.data.source, skipped: record.data.skipped ?? [], skippedCount: record.data.skippedCount ?? 0,
      lastError: String(error?.message || "The transfer failed.").slice(0, 500), finishedAt: new Date(ctx.now()).toISOString() })]).catch(() => {});
  }
}

export async function failedPull(kind, state, input, ctx, error) {
  if (input.releaseSource === true || state?.phase === "releasing-source" || input.remove === true || state?.phase === "removing") return; // a delete is not a transfer
  if (state) await cleanUpFailedPull(state, ctx, error);
  const startedAt = state?.startedAt ?? new Date(ctx.now()).toISOString();
  const options = state?.options ?? (() => { try { return pullOptionsFrom(input.exportOptions); } catch { return null; } })();
  const files = state?.total ?? state?.declared ?? 0;
  await recordFailedTransfer(ctx.host, { kind, id: state?.pullId ?? (HEX32.test(input.pullId ?? "") ? input.pullId : runHex(ctx.request)), siteId: state?.siteId ?? input.siteId, startedAt,
    ...(state?.bytes ? { bytes: state.bytes } : {}), runId: ctx.request.run?.id,
    summary: `${kind === "local-export" ? "Local export: " : ""}${selectionWords(options)}${files ? ` · ${files.toLocaleString("en-US")} files` : ""}` }, error, ctx.now);
}

export const pullSpec = (kind) => ({
  recoverableInterruptions: true,
  start: (input, ctx) => startPull(kind, input, ctx),
  step: stepPull,
  cancel: cancelPull,
  failed: (state, input, ctx, error) => failedPull(kind, state, input, ctx, error),
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
