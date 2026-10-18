// `copy.local` (Zoer Connect site → new or refreshed local DDEV copy) and `backup.restore-local`
// (five-part UpdraftPlus set → new local DDEV site) on S1 slices, S2 file sets, S3 uploads to a
// runtime peer (`files.stage.v1`), S8 command bundles (`runtime.exec.v1`), S9 site creation and
// S5 site addresses. The steps, checks and messages follow the legacy host engine
// (`wordpress-local-copy.ts`, `wordpress-copy-workflow.ts`, `wordpress-backup-restore.ts`).
import { commitRecords, historyRecord, listKind, readRecord, recordFailedTransfer } from "./catalog.js";
import { EMPTY_SHA256, hasOnlyMacMetadataExclusions, isUploadPlaceholder } from "./files.js";
import { deleteSet, describeSet, listEntries, readText } from "./filesets.js";
import { defaultExportOptions, validateExportOptions, validateReplacementRows } from "./options.js";
import { HEX32, pullOfSet, pullSpec, releaseRemoteExport, runHex } from "./pull.js";
import { fail, TransferError, UPLOAD_RUNTIME_REQUESTS } from "./slices.js";
import { validateUpdraftSet, validateHostingSet } from "./updraft.js";

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

/**
 * `users`: "local" keeps the copy's own accounts (default); "source" copies the source's users and user
 * meta and keeps the local administrator; "exact" copies them with no extra administrator (WP Migrate).
 */
function userMode(value) {
  if (value === undefined || value === null || value === "local") return "local";
  if (value === "source" || value === "exact") return value;
  fail("Choose whether to keep the local accounts or copy the source's users.");
}

/**
 * The importer's summary, reduced to the counts the run output and catalog record keep, and the
 * collations it converted because the local server lacks them (`from` → `to` in `tables` tables).
 */
export function databaseSummary(value) {
  if (!value || typeof value !== "object") return null;
  const count = (v) => Number.isSafeInteger(v) && v >= 0 ? v : null;
  const collation = (v) => typeof v === "string" && /^[A-Za-z0-9_]{1,64}$/.test(v);
  const users = value.users && typeof value.users === "object" ? value.users : {};
  const collations = (Array.isArray(value.collations) ? value.collations : []).filter(c => c && typeof c === "object" && collation(c.from) && collation(c.to)).slice(0, 20)
    .map(c => ({ from: c.from, to: c.to, tables: count(c.tables) }));
  return { tables: count(value.tables), rows: count(value.rows), replacements: count(value.replacements),
    users: { mode: ["source", "exact"].includes(users.mode) ? users.mode : "local", copied: count(users.copied), meta: count(users.meta), droppedMeta: count(users.droppedMeta), roles: users.roles === "source" ? "source" : "local", loginChanged: users.loginChanged === true },
    collations, ...(value.optionsPreserved === true ? { optionsPreserved: true, designPostsPreserved: count(value.designPostsPreserved) } : {}),
    ...(["local", "source"].includes(value.activePlugins) ? { activePlugins: value.activePlugins } : {}), ...(count(value.customRules) ? { customRules: count(value.customRules) } : {}), ...(value.pathReplaced === true ? { pathReplaced: true } : {}) };
}

function validName(value, max) {
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) return null;
  return value.trim();
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

/**
 * Refresh options (WP Migrate's pull settings): which files and rows a copy takes and what the import
 * does with them. Each is checked against the scope here, so a refresh never half-applies one.
 * - `media`: "all" | "since-last" (uploads changed since the newest download with media) | "none".
 * - `themes` / `plugins`: { mode: all|active|selected|except, items } — only those folders are placed.
 * - `removeStale`: after placing a theme or plugin folder, delete local files in it that the source no longer has.
 * - `database`: { excludeRevisions, excludeSpam, postTypes, tables } — tables only when refreshing.
 * - `activePlugins`: "none" (all inactive, default) | "local" (keep the copy's) | "source" (the source's).
 * - `replacements`: { paths, custom } — the source's file path → this site's, and custom find & replace rows.
 * - `pace`: "gentle" downloads in smaller requests with pauses (shared live hosts).
 * - `languages`: also place wp-content/languages (translations; Zoer Connect 0.8.1 on the source).
 */
export function copyOptions(input, scope, refresh, users = "local") {
  const files = scope !== "database", database = scope !== "files";
  const opts = {};
  if (input.media !== undefined) {
    if (!["all", "since-last", "none"].includes(input.media)) fail("Choose all media, media new since the last download, or no media.");
    if (!files || (scope === "without-media" && input.media !== "none")) fail("This refresh does not copy media; choose its scope instead.");
    if (input.media === "since-last" && !refresh) fail("New media since the last download applies to refreshing an existing local copy.");
  }
  opts.media = scope === "without-media" || !files ? "none" : input.media ?? "all";
  for (const kind of ["themes", "plugins"]) {
    if (input[kind] === undefined) continue;
    if (!files) fail(`A database-only refresh does not copy ${kind}.`);
    opts[kind] = input[kind];
  }
  if (input.removeStale !== undefined) {
    if (typeof input.removeStale !== "boolean") fail("Choose whether to remove files the source no longer has.");
    if (input.removeStale && (!refresh || !files)) fail("Removing deleted files applies to refreshing an existing copy's themes and plugins.");
    if (input.removeStale) opts.removeStale = true;
  }
  if (input.database !== undefined) {
    if (!database) fail("A files-only refresh does not change the database.");
    const d = input.database;
    if (!d || typeof d !== "object" || Array.isArray(d)) fail("Choose valid database filters.");
    if (d.tables !== undefined && d.tables !== "all") {
      if (!refresh) fail("Choosing tables applies to refreshing an existing local copy; a new copy needs every table.");
      if (!Array.isArray(d.tables) || !d.tables.includes("posts") || (scope !== "database" && !d.tables.includes("options"))) fail(scope === "database" ? "Include the posts table." : "Include the posts and options tables.");
      if (users !== "local" && !(d.tables.includes("users") && d.tables.includes("usermeta"))) fail("Copying the live site's accounts needs the users and usermeta tables.");
    }
    if (Array.isArray(d.postTypes) && scope === "database" && input.keepLocalDesign === true) fail("Keeping local pages and blocks needs every post type; turn one of them off.");
    opts.database = { tables: d.tables ?? "all", postTypes: d.postTypes ?? "all", excludeRevisions: d.excludeRevisions === true, excludeSpam: d.excludeSpam === true, excludeTransients: true };
  }
  if (input.activePlugins !== undefined) {
    if (!["none", "local", "source"].includes(input.activePlugins)) fail("Choose which plugins are active after the copy.");
    if ((scope === "database" || scope === "files") && input.activePlugins !== "local") fail("This refresh keeps the local site's active plugins.");
    if (input.activePlugins === "local" && !refresh) fail("A new copy has no plugin activation of its own to keep.");
    if (scope !== "database" && scope !== "files") opts.activePlugins = input.activePlugins;
  }
  if (input.replacements !== undefined) {
    if (!database) fail("A files-only refresh has no database to search and replace.");
    const r = input.replacements;
    if (!r || typeof r !== "object" || Array.isArray(r)) fail("Choose valid find & replace options.");
    if (r.paths !== undefined && typeof r.paths !== "boolean") fail("Choose whether to replace the source's file path.");
    const custom = validateReplacementRows(r.custom ?? [], 40);
    if (r.paths || custom.length) opts.replacements = { paths: r.paths === true, custom };
  }
  if (input.pace !== undefined) {
    if (!["normal", "gentle"].includes(input.pace)) fail("Choose a normal or gentle transfer pace.");
    if (input.pace === "gentle") opts.pace = "gentle";
  }
  if (input.languages !== undefined) {
    if (typeof input.languages !== "boolean") fail("Choose whether to copy the translations folder.");
    if (input.languages && !files) fail("A database-only refresh does not copy translations.");
    if (input.languages) opts.languages = true;
  }
  return opts;
}

/** The pull a copy makes for itself (the selections `copyOptions` chose; validated like any Pull). */
export function copyExportOptions(scope, opts, mediaSince = undefined) {
  const exportOptions = defaultExportOptions();
  const r = exportOptions.resources;
  r.database = scope !== "files";
  r.themes = r.plugins = scope !== "database";
  r.media = scope !== "database" && opts.media !== "none";
  // A known date is sent as "since"; without one (no earlier download with media) all media.
  if (opts.media === "since-last" && mediaSince) exportOptions.media = { mode: "since", since: mediaSince };
  if (opts.database) exportOptions.database = opts.database;
  if (opts.themes) exportOptions.themes = opts.themes;
  if (opts.plugins) exportOptions.plugins = opts.plugins;
  if (opts.languages) r.languages = true;
  return validateExportOptions(exportOptions);
}

export async function startCopy(input, ctx) {
  const { host, request, now } = ctx;
  const copyId = input.copyId ?? runHex(request);
  if (!HEX32.test(copyId)) fail("A valid copy request ID is required.");
  const state = { v: 1, kind: "copy", copyId, siteId: input.siteId, phase: "pulling", dryRun: input.dryRun === true, users: userMode(input.users), fileOffset: 0, startedAt: new Date(now()).toISOString() };
  if (input.scope !== undefined && !["complete", "database", "without-media", "files"].includes(input.scope)) fail("Choose a complete, database-only, no-media or files-only refresh.");
  if (input.keepLocalDesign !== undefined && typeof input.keepLocalDesign !== "boolean") fail("Choose whether to keep local pages and blocks.");
  const scope = input.scope ?? "complete";
  const refresh = input.replaceSiteId !== undefined && input.replaceSiteId !== null;
  if (scope !== "complete" && !refresh) fail(scope === "database" ? "Database-only refresh requires an existing linked local copy." : scope === "files" ? "A files-only refresh requires an existing linked local copy." : "A no-media refresh requires an existing linked local copy.");
  if (scope !== "complete") state.scope = scope;
  if (scope === "database") state.keepLocalDesign = input.keepLocalDesign === true;
  else if (input.keepLocalDesign === true) fail("Keeping local pages and blocks requires a database-only refresh.");
  if (scope === "files" && state.users !== "local") fail("A files-only refresh does not change user accounts.");
  const opts = copyOptions(input, scope, refresh, state.users);
  state.options = opts;
  if (refresh) {
    if (typeof input.replaceSiteId !== "string" || !input.replaceSiteId.startsWith("ddev-")) fail("Choose a local DDEV copy to refresh.");
    if (state.dryRun) fail("A dry run creates its own scratch site; refresh an existing copy without a dry run.");
    const copies = (await listKind(host, "local-copy")).map(r => r.data).filter(d => d?.targetId === input.replaceSiteId && d.sourceSiteId === input.siteId && d.phase === "complete");
    if (!copies.length) fail("Only a completed local copy that Zoer created from this same site can be refreshed.");
    copies.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    state.replaceSiteId = input.replaceSiteId;
    state.siteName = copies[0].siteName ?? copies[0].name;
    // "New media since the last download" counts from this copy's own last download with media
    // (not another copy's or a separate pull); a copy with none takes all media.
    if (opts.media === "since-last") {
      const last = copies.find(copyHadMedia);
      state.mediaSince = last ? String(last.createdAt).slice(0, 10) : null;
    }
    const { resource } = await runtime(host, "runtime.inspect.v1", input.replaceSiteId);
    if (resource?.status !== "running") fail("Start the local copy before refreshing it.");
  } else {
    const name = validName(input.name, 60);
    if (!name) fail("Enter a local site name of up to 60 characters.");
    state.siteName = state.dryRun ? `zoer-dryrun-${copyId.slice(0, 8)}` : `${name}-${copyId.slice(0, 8)}`;
  }
  if (input.pullSetId !== undefined) {
    // An existing download carries its own selections: only the import options apply to it.
    if (["media", "themes", "plugins", "database", "pace", "languages"].some(key => input[key] !== undefined)) fail("Choose files and tables when pulling; an existing download keeps the selection it was made with.");
    const { pull } = await pullOfSet(host, input.pullSetId);
    if (pull.siteId !== input.siteId) fail("The download belongs to another site.");
    state.setId = input.pullSetId;
    state.phase = "checking";
  } else {
    state.pull = await pullSpec("pull").start({ siteId: input.siteId, pullId: copyId, exportOptions: copyExportOptions(scope, opts, state.mediaSince), ...(opts.pace ? { pace: opts.pace } : {}) }, ctx);
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
    phase: "checking", dryRun, users: userMode(input.users), fileOffset: 0, startedAt: new Date(now()).toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Checks before anything is created
// ---------------------------------------------------------------------------------------------

/** A completed local-copy record whose download included media. */
function copyHadMedia(record) {
  const scope = record?.scope ?? "complete";
  return (scope === "complete" || scope === "files") && record?.options?.media !== "none";
}

/** Theme or plugin selection other than "all" (as `exportOptionsToPull` sends it). */
const narrowed = (mode) => !!mode && mode.mode !== "all" && !(mode.mode === "except" && !mode.items?.length);

/**
 * The legacy createLocalCopy checks: the pull holds what this copy's scope and options take (a
 * complete database/themes/plugins/media pull by default), safe files only. A pull the copy made
 * itself may carry its own filters; an existing download must be a plain one for its scope.
 */
async function checkCopySource(state, ctx) {
  const { host } = ctx;
  const { pull } = await pullOfSet(host, state.setId);
  const opts = state.options ?? {};
  const scope = state.scope ?? "complete";
  const owned = state.pullOwned === true;
  const database = pull.options?.database;
  const profile = pull.options?.profile ?? {};
  const wantDatabase = scope !== "files", wantFiles = scope !== "database";
  const wantMedia = wantFiles && scope !== "without-media" && (opts.media ?? "all") !== "none";
  if (!pull.source || (wantDatabase ? !database : !!database)) fail(wantDatabase ? "The database snapshot is missing." : "A files-only refresh needs a download without the database.");
  if (database && typeof database === "object") {
    if (Array.isArray(database.tables) && !(owned && Array.isArray(opts.database?.tables))) fail("Create a Pull with every database table before creating a local copy.");
    if (database.postTypes && !(owned && Array.isArray(opts.database?.postTypes))) fail(scope === "database" ? "Choose a database-only Pull with all post types for this refresh." : "Choose all database tables, themes and plugins without media for this refresh.");
  }
  if (profile.languages && !(owned && opts.languages)) fail("Create a Pull without the translations folder before creating a local copy.");
  if (profile.core || profile.muplugins || !hasOnlyMacMetadataExclusions(profile.excludes ?? [])) fail("Create a complete database, themes, plugins and media Pull before creating a local copy. Only Mac metadata exclusions (**/.DS_Store and **/__MACOSX/) are supported.");
  if (["themes", "plugins"].some(kind => (profile[kind] === true) !== wantFiles) || (profile.media === true) !== wantMedia) {
    fail(scope === "database" ? "Choose a database-only Pull with all post types for this refresh." : scope === "without-media" ? "Choose all database tables, themes and plugins without media for this refresh." : scope === "files" ? "Choose themes and plugins without the database for this refresh." : "Create a complete database, themes, plugins and media Pull before creating a local copy. Only Mac metadata exclusions (**/.DS_Store and **/__MACOSX/) are supported.");
  }
  for (const kind of ["themes", "plugins"]) if (profile[`${kind}Mode`] && profile[`${kind}Mode`] !== "all" && !(owned && narrowed(opts[kind]))) fail(`Create a Pull with all ${kind} before creating a local copy.`);
  if (profile.mediaSince && !(owned && opts.media === "since-last")) fail("Create a Pull with all media before creating a local copy.");
  const entries = await listEntries(host, state.setId);
  if (scope === "database" && (entries.length !== 1 || entries[0].path !== "database.sql")) fail("Database-only refresh cannot place source files on the local site.");
  let dbIndex = -1;
  for (const [index, f] of entries.entries()) {
    if (f.path === "database.sql") { if (!wantDatabase) fail("A files-only refresh cannot import a database."); dbIndex = index; continue; }
    if (!wantMedia && f.path.startsWith("wp-content/uploads/")) fail("A no-media refresh cannot place upload files.");
    if (!/^wp-content\/(themes|plugins|uploads)\//.test(f.path) && !(opts.languages && f.path.startsWith("wp-content/languages/"))) fail("The download contains unsupported files for a local copy.");
    if (EXECUTABLE_UPLOAD.test(f.path) && (f.bytes > 4096 || !isUploadPlaceholder(f.path, await readText(host, state.setId, f.path, 4096)))) fail("The download contains an executable upload that cannot be imported into a local copy.");
  }
  if (wantDatabase && dbIndex < 0) fail("The database snapshot is missing.");
  Object.assign(state, { dbIndex, ...(dbIndex >= 0 ? { dbSha256: entries[dbIndex].sha256 } : {}), prefix: pull.source.prefix, sourceUrl: pull.source.url, fileCount: entries.length - (dbIndex >= 0 ? 1 : 0), pullId: pull.pullId,
    ...(pull.source.abspath ? { sourceAbspath: pull.source.abspath } : {}) });
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  if (opts.replacements?.paths && !(typeof state.sourceAbspath === "string" && /^\/[^\x00-\x1f\x7f]{1,1023}$/.test(state.sourceAbspath) && state.sourceAbspath.replace(/\/+$/, "").length >= 2)) fail("The source did not report a usable file path, so it cannot be replaced. Turn path replacement off or update Zoer Connect on the source.");
}

/** Restore: the uploaded set must be one complete UpdraftPlus set (and, for a dry run, inspectable archives). */
async function checkRestoreSource(state, ctx) {
  const { host } = ctx;
  const set = await describeSet(host, state.setId);
  if (!set || set.status !== "sealed") fail("Upload and verify all backup files before restoring.");
  const entries = await listEntries(host, state.setId);
  state.backupFormat = entries.some(e => /\.(tar|sql)\.gz$/i.test(e.path)) ? "hostinger" : "updraft";
  const components = state.backupFormat === "hostinger" ? validateHostingSet(entries) : validateUpdraftSet(entries);
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
    if (state.backupFormat === "hostinger") {
      const inspectedEntries = inspected.entries.map(e => ({ ...e, path: e.path.replace(/^\.\//, "") }));
      if (inspected.totals.bytes > 2 * 1024 ** 3) fail("Archive exceeds expanded size limits.");
      const roots = inspectedEntries.filter(e => e.kind === "file" && /(?:^|\/)wp-includes\/version\.php$/.test(e.path)).map(e => e.path.replace(/wp-includes\/version\.php$/, ""));
      if (roots.length > 1) fail("Choose an archive containing exactly one WordPress installation.");
      if (!roots.length && inspected.totals.entries <= inspected.entries.length) fail("WordPress core was not found in the website archive.");
      const root = roots[0];
      for (const entry of inspectedEntries) {
        if (entry.kind === "other" || entry.kind === "symlink") fail("Links and special files are unsupported.");
        if (!root || entry.kind === "dir" || !entry.path.startsWith(`${root}wp-content/`)) continue;
        if (entry.bytes > 64 * 1024 ** 2) fail("Archive exceeds expanded size limits.");
        if (/^wp-content\/uploads\//.test(entry.path.slice(root.length)) && /\.(php\d*|phtml|phar|cgi|pl|sh)(\.|$)/i.test(entry.path) && (entry.path.split("/").at(-1) !== "index.php" || entry.bytes > 256)) fail("Executable upload is unsupported.");
        files++; bytes += entry.bytes;
      }
      plan.components.push({ component: c.component, name: c.originalName, bytes: c.size, files, expandedBytes: bytes });
      plan.files += files; plan.bytes += bytes;
      plan.warnings.push("The restore validates every member, the single WordPress root and the SQL dump, and omits core, configuration, caches and must-use plugins.");
      if (inspected.totals.entries > inspected.entries.length) plan.warnings.push(`Only the first ${inspected.entries.length.toLocaleString("en-US")} archive entries were listed; file counts are partial.`);
      continue;
    }
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
  plan.users = state.users ?? "local";
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
  // Each batch to the runtime peer is a runtime call (the slice's shared runtime call budget).
  while (ctx.timeLeft() > 5_000 && ctx.runtimeLeft() >= UPLOAD_RUNTIME_REQUESTS) {
    const call = { transferId: `copy-${state.copyId}`, setId: state.setId,
      target: { runtime: { alias: RUNTIME_ALIAS, resourceId: state.targetId, operation: "files.stage.v1", args: { copyId: state.copyId } } },
      protocol: "zbt1-v1", remote: STAGE_REMOTE, ...(state.order ? { order: state.order } : {}) };
    if (!ctx.canSend("transfer.upload", call)) return false;
    let result;
    try {
      result = await host.call("transfer.upload", call);
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
  while (state.fileOffset < state.fileCount && ctx.timeLeft() > 30_000 && ctx.runtimeLeft() >= 1) {
    if (state.kind === "restore") {
      await execCommand(host, state.targetId, "wordpress.copy.files", { id: state.copyId, fromPrepared: true, offset: state.fileOffset, limit: FILE_BATCH });
    } else {
      entries ??= (await listEntries(host, state.setId)).map((f, index) => ({ ...f, index })).filter(f => f.path !== "database.sql");
      const batch = entries.slice(state.fileOffset, state.fileOffset + FILE_BATCH).map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, source: String(f.index) }));
      if (batch.some(f => f.bytes === 0 && f.sha256 !== EMPTY_SHA256)) fail("Downloaded artifact is incomplete.");
      const plan = { id: state.copyId, files: batch };
      // The plan travels as JSON text inside the call (escaped again): it must fit the output budget.
      if (ctx.outputLeft() < 2 * Buffer.byteLength(JSON.stringify(plan)) + 8192) break;
      await execCommand(host, state.targetId, "wordpress.copy.files", plan);
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
    // The verified download is on Zoer now; free the source for the next pull or refresh.
    await releaseRemoteExport(state.pull, ctx);
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
      const backupId = created?.manifest?.id ?? created?.backup?.id ?? created?.id;
      if (typeof backupId !== "string" || !backupId || backupId.length > 200 || /[\r\n]/.test(backupId)) fail("The recovery backup did not return its ID. Nothing was replaced.");
      state.backup = backupId;
    }
    state.phase = "prepare";
  }
  if (state.phase === "prepare") {
    await execCommand(host, state.targetId, "wordpress.copy.prepare", { id: state.copyId });
    state.phase = "staging";
  }
  if (state.phase === "staging") {
    if (!(await stage(state, ctx))) return ctx.continue(state, progressOf(state, { done: state.staged ?? 0, unit: "bytes" }));
    state.phase = state.kind === "restore" ? "updraft" : state.scope === "files" ? "files" : "database";
  }
  if (state.phase === "updraft") {
    const summary = await execCommand(host, state.targetId, state.backupFormat === "hostinger" ? "wordpress.hostinger.prepare" : "wordpress.updraft.prepare", { id: state.copyId, components: state.components });
    if (!summary?.metadata || !/^[a-f0-9]{64}$/.test(summary.databaseSha256 ?? "")) fail("Backup preparation failed. Verify all files and retry.");
    Object.assign(state, { prefix: summary.metadata.prefix, sourceUrl: summary.metadata.sourceUrl, dbSha256: summary.databaseSha256, dbIndex: "extracted/database.sql", fileCount: Math.max(0, summary.fileCount - 1),
      warnings: (summary.warnings ?? []).slice(0, 10).map(w => String(w).slice(0, 240)), metadata: { wordpressVersion: summary.metadata.wordpressVersion, tables: summary.metadata.tables } });
    state.phase = "database";
  }
  if (state.phase === "database") {
    if (ctx.timeLeft() < 60_000) return ctx.continue(state, progressOf(state));
    const opts = state.options ?? {};
    const imported = await execCommand(host, state.targetId, "wordpress.copy.database", { id: state.copyId, prefix: state.prefix, sourceUrl: state.sourceUrl, targetUrl: state.targetUrl, databaseIndex: String(state.dbIndex), databaseSha256: state.dbSha256, users: state.users ?? "local",
      ...(state.scope === "database" ? { scope: "database", keepLocalDesign: state.keepLocalDesign === true } : {}),
      ...(opts.activePlugins && opts.activePlugins !== "none" ? { activePlugins: opts.activePlugins } : {}),
      ...(opts.replacements ? { replacements: { custom: opts.replacements.custom, ...(opts.replacements.paths ? { sourcePath: state.sourceAbspath } : {}) } } : {}) });
    state.database = databaseSummary(imported?.summary);
    state.phase = state.scope === "database" ? "finish" : "files";
  }
  if (state.phase === "files") {
    if (!(await placeFiles(state, ctx))) return ctx.continue(state, progressOf(state, { done: state.fileOffset, total: state.fileCount, unit: "files" }));
    state.phase = "finish";
  }
  if (state.phase === "finish") {
    const finished = await execCommand(host, state.targetId, "wordpress.copy.finish", { id: state.copyId, targetUrl: state.targetUrl, updateDb: state.kind === "restore", ...(state.scope === "database" || state.scope === "files" ? { scope: state.scope } : {}), ...(state.options?.removeStale ? { prune: true } : {}) });
    if (state.options?.removeStale) state.pruned = Number.isSafeInteger(finished?.pruned) && finished.pruned >= 0 ? finished.pruned : 0;
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
  const copied = state.database && state.database.users.mode !== "local" && state.database.users.copied !== null ? ` with ${state.database.users.copied.toLocaleString("en-US")} source users` : "";
  const records = [historyRecord({ kind: state.kind === "restore" ? "restore" : "local-copy", id: state.copyId, siteId: state.targetId, siteName: state.siteName, ...(state.siteId ? { sourceSiteId: state.siteId } : {}), status, startedAt: state.startedAt, finishedAt,
    summary: copySummary(state, copied), runId: ctx.request.run?.id })];
  if (!state.dryRun) {
    records.push({ id: `local-copy:${state.copyId}`, kind: "local-copy", title: state.siteName, data: { v: 1, copyId: state.copyId, kind: state.kind, sourceSiteId: state.siteId ?? `backup:${state.copyId}`, pullId: state.pullId ?? null, setId: state.setId,
      targetId: state.targetId, targetUrl: state.targetUrl, name: state.siteName, siteName: state.siteName, phase: "complete", users: state.users ?? "local", ...(state.database ? { database: state.database } : {}),
      ...(state.replaceSiteId ? { replaceSiteId: state.replaceSiteId, backup: state.backup } : {}), ...(state.warnings ? { warnings: state.warnings } : {}),
      ...(state.scope ? { scope: state.scope, ...(state.scope === "database" ? { keepLocalDesign: state.keepLocalDesign === true } : {}) } : {}),
      ...(state.options && Object.keys(state.options).some(key => key !== "media" || state.options.media !== "all") ? { options: state.options } : {}), ...(state.pruned !== undefined ? { pruned: state.pruned } : {}),
      createdAt: state.startedAt, finishedAt, engine: "plugin" } });
    if (state.siteId) records.push({ id: `site-link:${state.targetId}`, kind: "site-link", title: state.siteName, data: { v: 1, targetSiteId: state.targetId, sourceSiteId: state.siteId, copyId: state.copyId, createdAt: finishedAt } });
  }
  await commitRecords(host, records);
  return ctx.done({ ...(state.kind === "restore" ? { restoreId: state.copyId } : { copyId: state.copyId }), status, targetId: state.targetId, targetUrl: state.dryRun ? null : state.targetUrl, siteName: state.siteName,
    ...(state.warnings ? { warnings: state.warnings } : {}), ...(state.metadata ? { metadata: state.metadata } : {}), ...(state.database ? { database: state.database } : {}),
    summary: records[0].data.summary }, { phase: "done" });
}

/** The history line of a finished copy, refresh or restore. */
export function copySummary(state, copied = "") {
  if (state.dryRun) return `Dry run verified a scratch copy (${state.siteName})${copied}; it was moved to the trash.`;
  const opts = state.options ?? {};
  const notes = [];
  if (state.scope === "without-media" || (opts.media === "none" && state.scope !== "database" && state.scope !== "files")) notes.push("existing media retained");
  if (opts.media === "since-last") notes.push(state.mediaSince ? `only media new since ${state.mediaSince} downloaded` : "all media downloaded (no earlier download of this copy had media)");
  for (const kind of ["themes", "plugins"]) if (narrowed(opts[kind])) notes.push(`${opts[kind].mode === "active" ? "active" : "selected"} ${kind} only`);
  if (opts.languages) notes.push("translations included");
  if (state.pruned) notes.push(`${state.pruned.toLocaleString("en-US")} deleted ${state.pruned === 1 ? "file" : "files"} removed`);
  if (opts.activePlugins === "local") notes.push("local plugin activation kept");
  if (opts.activePlugins === "source") notes.push("source plugins activated");
  const tail = notes.length ? `; ${notes.join(", ")}.` : "";
  if (state.scope === "database") return `Local database refreshed at ${state.targetUrl}${copied}; code and settings retained${tail || "."}`.replace(/\.\.$/, ".");
  if (state.scope === "files") return `Local themes and plugins refreshed at ${state.targetUrl}; database and settings retained${tail || "."}`.replace(/\.\.$/, ".");
  return `${state.kind === "restore" ? "Backup restored" : "Local copy"} ready at ${state.targetUrl}${copied}${tail}`;
}

/** Cleanup after a cancel while still pulling: the embedded pull's remote export and partial set go. */
export async function cancelCopy(state, input, ctx) {
  if (state?.phase === "pulling" && state.pull) await pullSpec("pull").cancel(state.pull, input, ctx);
}

/** History record of a failed local copy or backup restore (named like the host engine's local copies). */
export async function failedCopy(kind, state, input, ctx, error) {
  const id = state?.copyId ?? ((kind === "restore" ? input.restoreId : input.copyId) ?? runHex(ctx.request));
  if (!HEX32.test(id)) return;
  const name = state?.siteName ?? input.name ?? id.slice(0, 8);
  const siteId = state?.targetId ?? (kind === "restore" ? `backup:${id}` : input.siteId);
  await recordFailedTransfer(ctx.host, { kind: kind === "restore" ? "restore" : "local-copy", id, siteId, siteName: name, ...(kind === "restore" ? {} : { sourceSiteId: state?.siteId ?? input.siteId }),
    startedAt: state?.startedAt ?? new Date(ctx.now()).toISOString(), runId: ctx.request.run?.id,
    summary: kind === "restore" ? `Backup restore ${name}` : `${state?.replaceSiteId ?? input.replaceSiteId ? "Refreshed local copy" : "Local copy"} ${name}` }, error, ctx.now);
}

export const copySpec = { recoverableInterruptions: true, start: startCopy, step: stepCopy, cancel: cancelCopy, failed: (state, input, ctx, error) => failedCopy("copy", state, input, ctx, error), changed: "This connection changed. Cancel the local copy and start a new one." };
export const restoreSpec = { start: startRestore, step: stepCopy, failed: (state, input, ctx, error) => failedCopy("restore", state, input, ctx, error) };
