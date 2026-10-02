import type {
  TransferHistoryItem, ExportOptions, ImportOptions, PushJobStatus, ResourceMode, TransferAction, WordPressDiagnostics, WordPressPushJob,
} from "../../../lib/api/types/wordpress-transfer";
import { formatTransferBytes } from "../wordpressPullProgress";

export const ACTION_LABELS: Record<TransferAction, { title: string; description: string }> = {
  pull: { title: "Pull", description: "Download this site to the Zoer server to make or refresh a local copy." },
  push: { title: "Push", description: "Replace this site's content with a local DDEV export or another connected site." },
  replace: { title: "Find & Replace", description: "Run find & replace on this site's own database, with a review step." },
  backup: { title: "Backup", description: "Save a database-only snapshot on the Zoer server." },
  export: { title: "Export", description: "Pull the site, then download the database or an archive to this device." },
};

const PHASES: Record<string, string> = {
  queued: "Queued",
  creating: "Creating the destination import",
  snapshotting: "Snapshotting the database",
  uploading: "Uploading files",
  reusing_artifacts: "Reusing previously uploaded files",
  checking_artifacts: "Checking uploaded files",
  scanning_database: "Scanning the database",
  mapping_authors: "Matching authors",
  preparing_tables: "Preparing staging tables",
  reading_database: "Importing the database",
  verifying_tables: "Verifying staged tables",
  review_required: "Waiting for your review",
  reserving: "Pausing the site",
  preparing_files: "Preparing files",
  applying_files: "Applying files",
  activating_tables: "Activating tables",
  importing: "Importing",
  verification_required: "Waiting for verification",
  finishing: "Reopening the site",
  complete: "Complete",
  rolling_back: "Rolling back",
  rollback_reset: "Preparing the rollback",
  rollback_reset_files: "Preparing to restore files",
  rollback_preflight_tables: "Checking tables before rollback",
  rollback_preflight_files: "Checking files before rollback",
  rollback_tables: "Restoring tables",
  rollback_files: "Restoring files",
  rollback_ready: "Reopening the site after rollback",
  rollback_refusal_release: "Rollback refused; reopening the site",
  rolled_back: "Rolled back",
  cancelled: "Cancelled",
  failed: "Failed",
  paused: "Paused",
};

/** Human names for every plugin/runner phase; unknown phases are humanised instead of shown raw. */
export function phaseLabel(phase: string | null | undefined) {
  if (!phase) return "Starting";
  const known = PHASES[phase];
  if (known) return known;
  const words = phase.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Starting";
}

export const TERMINAL_PUSH_STATUSES: PushJobStatus[] = ["complete", "rolled_back", "failed", "cancelled"];
export function isTerminalPush(job: Pick<WordPressPushJob, "status">) { return ["complete", "rolled_back", "cancelled"].includes(job.status); }

export function pushStatusLabel(job: Pick<WordPressPushJob, "status" | "kind" | "runner">) {
  const noun = job.kind === "replace" ? "Find & replace" : "Push";
  switch (job.status) {
    case "queued": return `${noun} queued`;
    case "running": return job.runner === "idle" ? `${noun} waiting for the server` : `${noun} running`;
    case "paused": return `${noun} paused`;
    case "review": return "Review the changes before applying";
    case "verification": return "Check the site, then finish";
    case "complete": return `${noun} complete`;
    case "rolled_back": return `${noun} rolled back`;
    case "failed": return `${noun} failed`;
    case "cancelled": return `${noun} cancelled`;
    default: return noun;
  }
}

export function pushProgress(job: WordPressPushJob) {
  const p = job.progress ?? {};
  const bytes = p.uploadedBytes ?? 0, total = p.totalBytes ?? 0;
  const percent = typeof p.percent === "number" ? Math.max(0, Math.min(100, Math.round(p.percent)))
    : total > 0 ? Math.min(100, Math.floor(bytes / total * 100))
    : p.fileCount ? Math.min(100, Math.floor((p.filesUploaded ?? 0) / p.fileCount * 100)) : null;
  return { bytes, total: total || null, percent, tableIndex: p.tableIndex ?? null, tableCount: p.tableCount ?? null, rowsRead: p.rowsRead ?? null, filesUploaded: p.filesUploaded ?? null, fileCount: p.fileCount ?? null };
}

const TRANSPORT_LABELS: Record<string, string> = { "octet-stream": "binary", multipart: "multipart", json: "JSON", chunks: "single blocks" };
/** "12 requests · binary · 1.57 MB batches" for batched uploads; null otherwise. */
export function uploadTransferSummary(job: Pick<WordPressPushJob, "transfer" | "progress">) {
  const t = job.transfer;
  if (!t) return null;
  const requests = job.progress?.requests ?? 0;
  return `${requests.toLocaleString()} ${requests === 1 ? "request" : "requests"} · ${TRANSPORT_LABELS[t.transport] ?? t.transport} · ${formatTransferBytes(t.batchBytes)} batches`;
}

export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60), mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function jobElapsed(job: Pick<WordPressPushJob, "createdAt" | "startedAt" | "finishedAt">, now = Date.now()) {
  const start = Date.parse(job.startedAt || job.createdAt);
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export function completionSummary(job: WordPressPushJob) {
  const duration = formatDuration(jobElapsed(job));
  if (job.kind === "replace") {
    const count = (job.stats ?? job.review)?.replacements ?? 0;
    return `${count.toLocaleString()} replacement${count === 1 ? "" : "s"} in ${duration}`;
  }
  const total = job.progress?.totalBytes ?? job.progress?.uploadedBytes;
  return total ? `${formatTransferBytes(total)} in ${duration}` : `Finished in ${duration}`;
}

export function failureSummary(job: Pick<WordPressPushJob, "phase" | "lastError">) {
  const phase = job.lastError?.phase || job.phase;
  return `Failed during the ${phaseLabel(phase).toLowerCase()} stage`;
}

// ---------------------------------------------------------------------------
// One-line panel summaries (like WP Migrate's collapsed panels).

function list(items: string[]) { return items.filter(Boolean).join(", "); }
function count(n: number, noun: string) { return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`; }

export function databaseSummary(exportOptions: ExportOptions | null, importOptions?: ImportOptions | null) {
  const parts: string[] = [];
  if (exportOptions) {
    if (!exportOptions.resources.database) return "Database: not included";
    const db = exportOptions.database;
    parts.push(db.tables === "all" ? "all tables" : count(db.tables.length, "table"));
    if (db.postTypes !== "all") parts.push(count(db.postTypes.length, "post type"));
    if (db.excludeRevisions) parts.push("no revisions");
    if (db.excludeSpam) parts.push("no spam comments");
    if (db.excludeTransients) parts.push("no transients");
  }
  if (importOptions) {
    if (!importOptions.replaceGuids) parts.push("GUIDs kept");
    if (importOptions.authorMapping === "match") parts.push("authors matched");
    if (importOptions.keepActivePlugins === true) parts.push("keep destination plugins");
    if (importOptions.keepActivePlugins === false) parts.push("take source plugins");
    if (importOptions.keepActiveTheme === true) parts.push("keep destination theme");
    if (importOptions.keepActiveTheme === false) parts.push("take source theme");
    if (importOptions.createTables) parts.push("create missing tables");
  }
  return `Database: ${list(parts) || "defaults"}`;
}

function modeText(mode: ResourceMode) {
  switch (mode.mode) {
    case "active": return "active only";
    case "selected": return `${mode.items.length} selected`;
    case "except": return `all except ${mode.items.length}`;
    default: return "all";
  }
}

export function filesSummary(options: ExportOptions) {
  const r = options.resources, parts: string[] = [];
  if (r.themes) parts.push(`themes (${modeText(options.themes)})`);
  if (r.plugins) parts.push(`plugins (${modeText(options.plugins)})`);
  if (r.media) parts.push(options.media.mode === "since" ? `media since ${options.media.since || "…"}` : options.media.mode === "since-last" ? "media since last migration" : "media");
  if (r.muplugins) parts.push("MU plugins");
  if (r.core) parts.push("WordPress core");
  if (!parts.length) return "Files: none";
  const excludes = options.excludes.length ? `; ${count(options.excludes.length, "exclusion")}` : "";
  return `Files: ${list(parts)}${excludes}`;
}

export function replaceSummary(options: ImportOptions, { replaceOnly = false } = {}) {
  const rep = options.replacements, parts: string[] = [];
  if (!replaceOnly && rep.automatic) parts.push(rep.variants ? "URL + variants" : "URL");
  if (!replaceOnly && rep.automatic && rep.paths) parts.push("filesystem path");
  if (rep.custom.length) parts.push(count(rep.custom.length, "custom rule"));
  if (options.review) parts.push("review first");
  return `Find & Replace: ${list(parts) || "off"}`;
}

export function safetySummary(options: ImportOptions) {
  const parts = [options.fence === "activation" ? "site online while staging" : "site paused for the whole import"];
  if (options.purgeCaches) parts.push("purge caches after");
  return `Safety: ${list(parts)}`;
}

// ---------------------------------------------------------------------------
// Connection warnings.

export type ConnectionWarning = { code: string; message: string };
const WARNING_TEXT: Record<string, string> = {
  firewall_plugin: "A firewall plugin is active. If transfers are blocked, allow Zoer Connect's REST routes.",
  page_cache_plugin: "A page cache plugin is active. Purge caches after the migration (enabled by default).",
  object_cache_dropin: "A persistent object cache is installed. Stale cached options can survive an import until it is flushed.",
  mixed_case_tables: "Some table names use mixed case. Moving between servers with different lower_case_table_names settings can break them.",
  non_innodb: "Some tables are not InnoDB. Staging swaps are safest with InnoDB tables.",
  foreign_keys: "Some tables use foreign keys. Zoer does not recreate foreign key constraints.",
  triggers: "Some tables have triggers. Triggers are not transferred.",
  blog_private: "Search engines are discouraged on this site (Settings → Reading).",
  no_https: "This site does not use HTTPS.",
};

export function connectionWarnings(diagnostics: WordPressDiagnostics | null | undefined, { url, sourcePrefix }: { url?: string; sourcePrefix?: string | null } = {}) {
  const warnings = new Map<string, ConnectionWarning>();
  for (const warning of diagnostics?.warnings ?? []) warnings.set(warning.code, { code: warning.code, message: warning.message || WARNING_TEXT[warning.code] || warning.code });
  if (url && url.startsWith("http://") && !warnings.has("no_https")) warnings.set("no_https", { code: "no_https", message: WARNING_TEXT.no_https });
  if (diagnostics?.wordpress?.blogPublic === false && !warnings.has("blog_private")) warnings.set("blog_private", { code: "blog_private", message: WARNING_TEXT.blog_private });
  const prefix = diagnostics?.wordpress?.prefix;
  if (sourcePrefix && prefix && sourcePrefix !== prefix) warnings.set("prefix_mismatch", { code: "prefix_mismatch", message: `Table prefix differs: source uses ${sourcePrefix}, this site uses ${prefix}. Zoer renames tables and prefix-dependent options during import.` });
  return [...warnings.values()];
}

// ---------------------------------------------------------------------------
// Before/after highlighting for review samples.

export type DiffSegment = { text: string; changed: boolean };
/** Splits two strings into shared prefix, changed middle and shared suffix. */
export function diffSegments(before: string, after: string): { before: DiffSegment[]; after: DiffSegment[] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length, endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) { endB--; endA--; }
  const build = (text: string, end: number) => [
    { text: text.slice(0, start), changed: false },
    { text: text.slice(start, end), changed: true },
    { text: text.slice(end), changed: false },
  ].filter(segment => segment.text.length > 0);
  return { before: build(before, endB), after: build(after, endA) };
}

// ---------------------------------------------------------------------------
// History filters.

/** Matches transfers to or from a site, optionally of one kind. Empty values match everything. */
export function filterTransfers(items: TransferHistoryItem[], { siteId, kind }: { siteId: string; kind: string }) {
  return items.filter(item => (!siteId || item.siteId === siteId || item.sourceSiteId === siteId) && (!kind || item.kind === kind));
}

