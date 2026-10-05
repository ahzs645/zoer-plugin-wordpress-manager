// `copy.local` (Zoer Connect site → new or refreshed local DDEV copy) and `backup.restore-local`
// (five-part UpdraftPlus set → new local DDEV site) on S1 slices, S2 file sets, S3 uploads to a
// runtime peer (`files.stage.v1`), S8 command bundles (`runtime.exec.v1`), S9 site creation and
// S5 site addresses. The steps, checks and messages follow the legacy host engine
// (`wordpress-local-copy.ts`, `wordpress-copy-workflow.ts`, `wordpress-backup-restore.ts`).
import { assertPluginEngine, commitRecords, historyRecord, listKind, readRecord } from "./catalog.js";
import { EMPTY_SHA256, hasOnlyMacMetadataExclusions, isUploadPlaceholder } from "./files.js";
import { deleteSet, describeSet, listEntries, readText } from "./filesets.js";
import { defaultExportOptions } from "./options.js";
import { HEX32, pullOfSet, pullSpec, runHex } from "./pull.js";
import { fail, TransferError } from "./slices.js";
import { validateUpdraftSet } from "./updraft.js";

export const RUNTIME_ALIAS = "wordpress_site";
const FILE_BATCH = 2000;
const GENERIC = "Local copy could not advance. Resume continues the same destination; private artifacts are retained.";
/** Runtime peer batches: the bridge accepts ≤ 1 MiB of verified span data and ≤ 256 spans per call. */
export const STAGE_REMOTE = { batchUpload: true, transports: ["octet-stream"], deflate: false, limits: { blockBytes: 262144, maxBatchBytes: 1048576, maxJsonBatchBytes: 1048576, maxSpans: 256, deadlineMs: 5000 } };
const EXECUTABLE_UPLOAD = /^wp-content\/uploads\/.*\.(php\d*|phtml|phar|cgi|pl|sh)(\.|$)/i;

function runtime(host, operation, resourceId, args = {}) {
  return host.call("runtime.invoke", { alias: RUNTIME_ALIAS, operation, ...(resourceId ? { resourceId } : {}), args }).catch((error) => {
    if (error?.name !== "HostCallError" || error.code === "ZOER_PAUSED") throw error;
    if (["capability_denied", "resource_unbound", "invalid_request", "runtime_permission"].includes(error.code)) throw new TransferError(error.message, { code: error.code });
    throw new TransferError(error.message || "The DDEV bridge did not respond. Retry shortly.", { code: error.code, transient: true });
  });
}

/** Runs one bundle command with its plan; a failure parks the run so Resume retries the same step. */
export async function execCommand(host, resourceId, command, plan) {
  let result;
  try {
    result = await host.call("runtime.invoke", { alias: RUNTIME_ALIAS, operation: "runtime.exec.v1", resourceId,
      args: { command, files: [{ name: "plan.json", text: JSON.stringify(plan) }], outputs: [{ name: "result.json", maxBytes: 4096, optional: true }] } });
  } catch (error) {
    if (error?.name !== "HostCallError" || error.code === "ZOER_PAUSED") throw error;
    const reported = /ZOER_ERROR: ([^\n]{1,300})/.exec(error.message ?? "")?.[1]?.trim();
    if (["capability_denied", "runtime_permission", "invalid_request"].includes(error.code)) throw new TransferError(error.message, { code: error.code });
    throw new TransferError(reported ?? "Local copy operation failed. The partial destination and private staging are retained for inspection or retry.", { code: error.code || "execution_failed", needsUser: true });
  }
  const line = String(result?.stdoutTail ?? "").trim().split("\n").filter(Boolean).at(-1);
  try { return line ? JSON.parse(line) : {}; } catch { return {}; }
}

function validName(value, max) {
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) return null;
  return value.trim();
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

export async function startCopy(input, ctx) {
  const { host, request, now } = ctx;
  const copyId = input.copyId ?? runHex(request);
  if (!HEX32.test(copyId)) fail("A valid copy request ID is required.");
  await assertPluginEngine(host, input.siteId);
  const state = { v: 1, kind: "copy", copyId, siteId: input.siteId, phase: "pulling", dryRun: input.dryRun === true, fileOffset: 0, startedAt: new Date(now()).toISOString() };
  if (input.replaceSiteId !== undefined && input.replaceSiteId !== null) {
    if (typeof input.replaceSiteId !== "string" || !input.replaceSiteId.startsWith("ddev-")) fail("Choose a local DDEV copy to refresh.");
    if (state.dryRun) fail("A dry run creates its own scratch site; refresh an existing copy without a dry run.");
    const copies = (await listKind(host, "local-copy")).map(r => r.data).filter(d => d?.targetId === input.replaceSiteId && d.sourceSiteId === input.siteId && d.phase === "complete");
    if (!copies.length) fail("Only a completed local copy that Zoer created from this same site can be refreshed.");
    copies.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    state.replaceSiteId = input.replaceSiteId;
    state.siteName = copies[0].siteName ?? copies[0].name;
    const { resource } = await runtime(host, "runtime.inspect.v1", input.replaceSiteId);
    if (resource?.status !== "running") fail("Start the local copy before refreshing it.");
  } else {
    const name = validName(input.name, 60);
    if (!name) fail("Enter a local site name of up to 60 characters.");
    state.siteName = state.dryRun ? `zoer-dryrun-${copyId.slice(0, 8)}` : `${name}-${copyId.slice(0, 8)}`;
  }
  if (input.pullSetId !== undefined) {
    const { pull } = await pullOfSet(host, input.pullSetId);
    if (pull.siteId !== input.siteId) fail("The download belongs to another site.");
    state.setId = input.pullSetId;
    state.phase = "checking";
  } else {
    state.pull = await pullSpec("pull").start({ siteId: input.siteId, pullId: copyId, exportOptions: defaultExportOptions() }, ctx);
    state.pullOwned = true;
  }
  return state;
}

export async function startRestore(input, ctx) {
  const { now, request } = ctx;
  const restoreId = input.restoreId ?? runHex(request);
  if (!HEX32.test(restoreId)) fail("A valid restore request ID is required.");
  const name = validName(input.name, 100);
  if (!name) fail("Invalid backup site name.");
  const dryRun = input.dryRun === true;
  return { v: 1, kind: "restore", copyId: restoreId, setId: input.uploadSetId, name, siteName: dryRun ? `zoer-dryrun-${restoreId.slice(0, 8)}` : `${name.slice(0, 50)}-${restoreId.slice(0, 8)}`,
    phase: "checking", dryRun, fileOffset: 0, startedAt: new Date(now()).toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Checks before anything is created
// ---------------------------------------------------------------------------------------------

/** The legacy createLocalCopy checks: a complete database/themes/plugins/media pull, safe files only. */
async function checkCopySource(state, ctx) {
  const { host } = ctx;
  const { pull } = await pullOfSet(host, state.setId);
  const database = pull.options?.database;
  if (database && typeof database === "object" && Array.isArray(database.tables)) fail("Create a Pull with every database table before creating a local copy.");
  const profile = pull.options?.profile ?? {};
  if (!pull.source || !database || !["themes", "plugins", "media"].every(k => profile[k] === true) || !hasOnlyMacMetadataExclusions(profile.excludes ?? []) || profile.core || profile.muplugins) {
    fail("Create a complete database, themes, plugins and media Pull before creating a local copy. Only Mac metadata exclusions (**/.DS_Store and **/__MACOSX/) are supported.");
  }
  const entries = await listEntries(host, state.setId);
  let dbIndex = -1;
  for (const [index, f] of entries.entries()) {
    if (f.path === "database.sql") { dbIndex = index; continue; }
    if (!/^wp-content\/(themes|plugins|uploads)\//.test(f.path)) fail("The download contains unsupported files for a local copy.");
    if (EXECUTABLE_UPLOAD.test(f.path) && (f.bytes > 4096 || !isUploadPlaceholder(f.path, await readText(host, state.setId, f.path, 4096)))) fail("The download contains an executable upload that cannot be imported into a local copy.");
  }
  if (dbIndex < 0) fail("The database snapshot is missing.");
  Object.assign(state, { dbIndex, dbSha256: entries[dbIndex].sha256, prefix: pull.source.prefix, sourceUrl: pull.source.url, fileCount: entries.length - 1, pullId: pull.pullId });
}

/** Restore: the uploaded set must be one complete UpdraftPlus set (and, for a dry run, inspectable archives). */
async function checkRestoreSource(state, ctx) {
  const { host } = ctx;
  const set = await describeSet(host, state.setId);
  if (!set || set.status !== "sealed") fail("Upload all five backup files before restoring.");
  const entries = await listEntries(host, state.setId);
  const components = validateUpdraftSet(entries);
  state.order = components.map(c => c.entryIndex);
  state.components = components.map((c, position) => ({ component: c.component, size: c.size, sha256: c.sha256, source: String(position) }));
  if (!state.dryRun) return null;
  // Dry run: plan only. Archives are inspected host-side (S2), nothing is created or extracted.
  const plan = { components: [], warnings: [], files: 0, bytes: 0 };
  for (const c of components) {
    if (c.component === "database") { plan.components.push({ component: c.component, name: c.originalName, bytes: c.size }); continue; }
    const inspected = await host.call("archive.inspect", { source: { setId: state.setId, path: c.originalName }, maxEntries: 10000 });
    if (inspected.flags.encrypted || inspected.flags.symlinks || inspected.flags.traversal || inspected.flags.absolute) fail("Links, special files and encrypted archives are unsupported.");
    let files = 0, bytes = 0, skipped = 0;
    for (const entry of inspected.entries) {
      const parts = entry.path.replace(/\/+$/, "").split("/");
      if (entry.kind === "other" || entry.kind === "symlink") fail("Links, special files and encrypted archives are unsupported.");
      if (c.component !== "others" && parts[0] !== c.component) fail("Archive root does not match component.");
      if (entry.kind === "dir") continue;
      if (c.component === "others" && (["advanced-cache.php", "db.php", "object-cache.php", "sunrise.php", "maintenance.php", "mu-plugins", "cache", "updraft"].includes(parts[0]) || parts.at(-1) === ".htaccess")) { skipped++; continue; }
      if (c.component === "uploads" && /\.(php\d*|phtml|phar|cgi|pl|sh)(\.|$)/i.test(entry.path) && (parts.at(-1) !== "index.php" || entry.bytes > 256)) fail("Executable upload is unsupported.");
      if (entry.bytes > 64 * 1024 ** 2 || entry.bytes / Math.max(1, entry.compressedBytes) > 1000) fail("Archive exceeds expanded size or compression limits.");
      files++; bytes += entry.bytes;
    }
    if (inspected.totals.entries > inspected.entries.length) plan.warnings.push(`${c.component}: only the first ${inspected.entries.length.toLocaleString("en-US")} entries were inspected in the dry run.`);
    if (skipped) plan.warnings.push("Skipped local cache, drop-in, must-use plugin or backup file.");
    plan.components.push({ component: c.component, name: c.originalName, bytes: c.size, files, expandedBytes: bytes });
    plan.files += files; plan.bytes += bytes;
  }
  if (plan.bytes > 2 * 1024 ** 3) fail("Archive exceeds expanded size or compression limits.");
  plan.warnings.push("The database is converted and checked during the restore itself; the dry run does not read it.");
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------------------------

const PROGRESS_PHASES = { pulling: "pulling", checking: "checking", site: "creating site", backup: "recovery backup", prepare: "preparing", staging: "staging files", updraft: "preparing backup", database: "importing database", files: "placing files", finish: "verifying", archive: "archiving dry-run site", recording: "finishing" };
const progressOf = (state, extra = {}) => ({ phase: PROGRESS_PHASES[state.phase] ?? state.phase, ...extra });

async function ensureSite(state, ctx) {
  const { host } = ctx;
  if (state.replaceSiteId) state.targetId = state.replaceSiteId;
  if (!state.targetId) {
    const listed = await runtime(host, "runtime.list.v1", undefined, {});
    // A replayed slice finds the site it created before (by name, or by the DDEV ID derived from it).
    const slug = `ddev-${state.siteName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")}`;
    const existing = (listed?.resources ?? []).find(r => (r?.name === state.siteName || r?.id === slug) && r.state !== "archived");
    const resource = existing ?? (await runtime(host, "runtime.create.v1", undefined, { name: state.siteName, profile: "wordpress-ddev" })).resource;
    if (!resource?.id) fail("Local site is being provisioned. Retry to discover the reserved site.", { transient: true });
    state.targetId = resource.id;
  }
  const { resource } = await runtime(host, "runtime.inspect.v1", state.targetId);
  if (resource?.status !== "running") return false;
  if (!state.targetUrl) {
    const { route } = await host.call("routes.assign", { runtimeAlias: RUNTIME_ALIAS, resourceId: state.targetId, port: 80, name: state.siteName.slice(0, 100) });
    const url = String(route?.url ?? "").replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+/.test(url)) fail("Local site is being provisioned. Retry to discover the reserved site.", { transient: true });
    state.targetUrl = url;
  }
  return true;
}

async function stage(state, ctx) {
  const { host } = ctx;
  while (ctx.timeLeft() > 5_000) {
    let result;
    try {
      result = await host.call("transfer.upload", { transferId: `copy-${state.copyId}`, setId: state.setId,
        target: { runtime: { alias: RUNTIME_ALIAS, resourceId: state.targetId, operation: "files.stage.v1", args: { copyId: state.copyId } } },
        protocol: "zbt1-v1", remote: STAGE_REMOTE, ...(state.order ? { order: state.order } : {}) });
    } catch (error) {
      if (error?.code === "transfer_integrity") throw new TransferError("Downloaded artifact is incomplete.", { code: error.code, needsUser: true });
      if (error?.code === "transfer_exhausted") throw new TransferError(GENERIC, { code: error.code, needsUser: true });
      throw error;
    }
    state.staged = result.rawBytes;
    if (result.complete) return true;
    if (result.transient) throw new TransferError(result.transient.message || "The DDEV bridge is busy. Retrying shortly.", { transient: true, retryAfterMs: result.retryAfterMs });
    if (result.stopped) return false;
  }
  return false;
}

async function placeFiles(state, ctx) {
  const { host } = ctx;
  let entries = null;
  while (state.fileOffset < state.fileCount && ctx.timeLeft() > 30_000) {
    if (state.kind === "restore") {
      await execCommand(host, state.targetId, "wordpress.copy.files", { id: state.copyId, fromPrepared: true, offset: state.fileOffset, limit: FILE_BATCH });
    } else {
      entries ??= (await listEntries(host, state.setId)).map((f, index) => ({ ...f, index })).filter(f => f.path !== "database.sql");
      const batch = entries.slice(state.fileOffset, state.fileOffset + FILE_BATCH).map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, source: String(f.index) }));
      if (batch.some(f => f.bytes === 0 && f.sha256 !== EMPTY_SHA256)) fail("Downloaded artifact is incomplete.");
      await execCommand(host, state.targetId, "wordpress.copy.files", { id: state.copyId, files: batch });
    }
    state.fileOffset = Math.min(state.fileCount, state.fileOffset + FILE_BATCH);
  }
  return state.fileOffset >= state.fileCount;
}

/** Wraps the embedded pull's envelopes (and in-slice progress) so the copy can continue its own state machine. */
function nested(ctx) {
  return { ...ctx, progress: (progress) => ctx.progress({ ...progress, phase: `pulling: ${progress?.phase ?? "working"}` }), continue: (_s, progress, waitMs) => ({ kind: "continue", progress, waitMs }), done: (output) => ({ kind: "done", output }), needsUser: (_s, reason) => { throw new TransferError(reason, { needsUser: true }); } };
}

export async function stepCopy(state, input, ctx) {
  const { host } = ctx;
  if (state.phase === "pulling") {
    const outcome = await pullSpec("pull").step(state.pull, input, nested(ctx));
    if (outcome.kind === "continue") return ctx.continue(state, { ...outcome.progress, phase: `pulling: ${outcome.progress?.phase ?? "working"}` }, outcome.waitMs);
    state.setId = outcome.output.setId;
    delete state.pull;
    state.phase = "checking";
  }
  if (state.phase === "checking") {
    if (state.kind === "restore") {
      const plan = await checkRestoreSource(state, ctx);
      if (plan) return ctx.done({ restoreId: state.copyId, status: "dry-run", plan, summary: `Dry run: ${plan.files.toLocaleString("en-US")} files (${plan.bytes.toLocaleString("en-US")} bytes) would be restored into a new local site. Nothing was created.` });
    } else await checkCopySource(state, ctx);
    state.phase = "site";
  }
  if (state.phase === "site") {
    if (!(await ensureSite(state, ctx))) return ctx.continue(state, progressOf(state, { message: "Waiting for the local DDEV site to start." }), 10_000);
    state.phase = state.replaceSiteId ? "backup" : "prepare";
  }
  if (state.phase === "backup") {
    // Recovery point before any table or file of the existing copy changes.
    if (!state.backup) {
      let created;
      try { created = await runtime(host, "backup.create.v1", state.targetId, { name: `before-copy-${state.copyId.slice(0, 8)}` }); }
      catch { throw new TransferError("Could not take a recovery backup of the local copy. Nothing was replaced."); }
      state.backup = String(created?.backup?.id ?? created?.id ?? "created").slice(0, 200);
    }
    state.phase = "prepare";
  }
  if (state.phase === "prepare") {
    await execCommand(host, state.targetId, "wordpress.copy.prepare", { id: state.copyId });
    state.phase = "staging";
  }
  if (state.phase === "staging") {
    if (!(await stage(state, ctx))) return ctx.continue(state, progressOf(state, { done: state.staged ?? 0, unit: "bytes" }));
    state.phase = state.kind === "restore" ? "updraft" : "database";
  }
  if (state.phase === "updraft") {
    const summary = await execCommand(host, state.targetId, "wordpress.updraft.prepare", { id: state.copyId, components: state.components });
    if (!summary?.metadata || !/^[a-f0-9]{64}$/.test(summary.databaseSha256 ?? "")) fail("Backup preparation failed. Verify all files and retry.");
    Object.assign(state, { prefix: summary.metadata.prefix, sourceUrl: summary.metadata.sourceUrl, dbSha256: summary.databaseSha256, dbIndex: "extracted/database.sql", fileCount: Math.max(0, summary.fileCount - 1),
      warnings: (summary.warnings ?? []).slice(0, 10).map(w => String(w).slice(0, 240)), metadata: { wordpressVersion: summary.metadata.wordpressVersion, tables: summary.metadata.tables } });
    state.phase = "database";
  }
  if (state.phase === "database") {
    if (ctx.timeLeft() < 60_000) return ctx.continue(state, progressOf(state));
    await execCommand(host, state.targetId, "wordpress.copy.database", { id: state.copyId, prefix: state.prefix, sourceUrl: state.sourceUrl, targetUrl: state.targetUrl, databaseIndex: String(state.dbIndex), databaseSha256: state.dbSha256 });
    state.phase = "files";
  }
  if (state.phase === "files") {
    if (!(await placeFiles(state, ctx))) return ctx.continue(state, progressOf(state, { done: state.fileOffset, total: state.fileCount, unit: "files" }));
    state.phase = "finish";
  }
  if (state.phase === "finish") {
    await execCommand(host, state.targetId, "wordpress.copy.finish", { id: state.copyId, targetUrl: state.targetUrl, updateDb: state.kind === "restore" });
    state.phase = state.dryRun ? "archive" : "recording";
  }
  if (state.phase === "archive") {
    // Dry run: the verified scratch site goes to the Zoer trash; a pull made for it is not kept.
    await runtime(host, "runtime.archive.v1", state.targetId, {});
    if (state.pullOwned) {
      await deleteSet(host, state.setId);
      const record = await readRecord(host, `pull:${state.pullId ?? state.copyId}`);
      if (record) await commitRecords(host, [{ ...record, data: { ...record.data, status: "dry-run", setId: null } }]);
    }
    state.phase = "recording";
  }
  const finishedAt = new Date(ctx.now()).toISOString();
  const status = state.dryRun ? "dry-run" : "complete";
  const records = [historyRecord({ kind: state.kind === "restore" ? "restore" : "local-copy", id: state.copyId, siteId: state.targetId, siteName: state.siteName, ...(state.siteId ? { sourceSiteId: state.siteId } : {}), status, startedAt: state.startedAt, finishedAt,
    summary: state.dryRun ? `Dry run verified a scratch copy (${state.siteName}); it was moved to the trash.` : `${state.kind === "restore" ? "Backup restored" : "Local copy"} ready at ${state.targetUrl}`, runId: ctx.request.run?.id })];
  if (!state.dryRun) {
    records.push({ id: `local-copy:${state.copyId}`, kind: "local-copy", title: state.siteName, data: { v: 1, copyId: state.copyId, kind: state.kind, sourceSiteId: state.siteId ?? `backup:${state.copyId}`, pullId: state.pullId ?? null, setId: state.setId,
      targetId: state.targetId, targetUrl: state.targetUrl, name: state.siteName, siteName: state.siteName, phase: "complete", ...(state.replaceSiteId ? { replaceSiteId: state.replaceSiteId, backup: state.backup } : {}), ...(state.warnings ? { warnings: state.warnings } : {}),
      createdAt: state.startedAt, finishedAt, engine: "plugin" } });
    if (state.siteId) records.push({ id: `site-link:${state.targetId}`, kind: "site-link", title: state.siteName, data: { v: 1, targetSiteId: state.targetId, sourceSiteId: state.siteId, copyId: state.copyId, createdAt: finishedAt } });
  }
  await commitRecords(host, records);
  return ctx.done({ ...(state.kind === "restore" ? { restoreId: state.copyId } : { copyId: state.copyId }), status, targetId: state.targetId, targetUrl: state.dryRun ? null : state.targetUrl, siteName: state.siteName,
    ...(state.warnings ? { warnings: state.warnings } : {}), ...(state.metadata ? { metadata: state.metadata } : {}),
    summary: records[0].data.summary }, { phase: "done" });
}

/** Cleanup after a cancel while still pulling: the embedded pull's remote export and partial set go. */
export async function cancelCopy(state, input, ctx) {
  if (state?.phase === "pulling" && state.pull) await pullSpec("pull").cancel(state.pull, input, ctx);
}

export const copySpec = { start: startCopy, step: stepCopy, cancel: cancelCopy, changed: "This connection changed. Cancel the local copy and start a new one." };
export const restoreSpec = { start: startRestore, step: stepCopy };
