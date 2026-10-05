/**
 * Catalog records written by the transfer workers (plugin/worker/lib/catalog.js) or migrated from
 * Zoer's legacy host engine (`wordpress-manager.transfers-to-plugin`, `engine: "legacy"` /
 * `"legacy-migrated"`), and the history list that merges them with `runs.recent`. Pure; parsing
 * never trusts shapes.
 */
import { pullContents, pullIncludesDownloadOnly } from "../../../lib/wordpress-transfer/options";
import { ENGINE_ACTIONS, isTerminalStatus, runInput, runTransferId, type RecentRun } from "./runState";

type Raw = { id?: unknown; kind?: unknown; data?: unknown; updated_at?: unknown };
const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown) => typeof value === "string" ? value : undefined;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

// ---------------------------------------------------------------------------
// pull:<pullId>

export type PullRecordStatus = "downloading" | "ready" | "dry-run" | "cancelled";
export interface PullRecord {
  pullId: string;
  siteId: string;
  kind: "pull" | "local-export";
  setId: string | null;
  status: PullRecordStatus | string;
  options: { profile?: Record<string, unknown>; database?: unknown } | null;
  origin?: string;
  source?: { url?: string; prefix?: string; abspath?: string } | null;
  skippedCount?: number;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  finishedAt?: string;
  engine: string;
}

export function parsePullRecord(record: Raw): PullRecord | null {
  const data = obj(record.data);
  if (record.kind !== "pull" || !data) return null;
  const pullId = str(data.pullId), siteId = str(data.siteId), createdAt = str(data.createdAt);
  if (!pullId || !siteId || !createdAt) return null;
  const setId = str(data.setId) && /^fs_[a-f0-9]{32}$/.test(String(data.setId)) ? String(data.setId) : null;
  const source = obj(data.source);
  return {
    pullId, siteId, kind: data.kind === "local-export" ? "local-export" : "pull", setId,
    // Migrated legacy pulls are finished by definition; Zoer marks them ready, earlier migrations did not.
    status: str(data.status) ?? (data.engine === "legacy-migrated" ? "ready" : "downloading"),
    options: obj(data.options) as PullRecord["options"],
    ...(str(data.origin) ? { origin: str(data.origin) } : {}),
    source: source ? { url: str(source.url), prefix: str(source.prefix), abspath: str(source.abspath) } : null,
    ...(num(data.skippedCount) !== undefined ? { skippedCount: num(data.skippedCount) } : {}),
    fileCount: num(data.fileCount) ?? 0, totalBytes: num(data.totalBytes) ?? 0, createdAt,
    ...(str(data.finishedAt) ? { finishedAt: str(data.finishedAt) } : {}),
    engine: str(data.engine) ?? "plugin",
  };
}

/** A verified pull that can be pushed or downloaded. */
export const isReadyPull = (pull: PullRecord) => pull.status === "ready" && !!pull.setId;

/** Push sources for a destination: ready pulls and local exports of every other site, newest first. */
export function pushSources(pulls: PullRecord[], destinationSiteId: string) {
  return pulls.filter(pull => isReadyPull(pull) && pull.siteId !== destinationSiteId && !pullIncludesDownloadOnly(pull.options))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const pullHasDatabase = (pull: Pick<PullRecord, "options">) => pullContents(pull.options).database;

// ---------------------------------------------------------------------------
// local-copy:<copyId>

export interface LocalCopyRecord { copyId: string; kind: "copy" | "restore"; sourceSiteId?: string; targetId: string; targetUrl?: string; name?: string; siteName?: string; phase: string; replaceSiteId?: string; createdAt?: string; finishedAt?: string }

export function parseLocalCopyRecord(record: Raw): LocalCopyRecord | null {
  const data = obj(record.data);
  if (record.kind !== "local-copy" || !data) return null;
  const copyId = str(data.copyId), targetId = str(data.targetId);
  if (!copyId || !targetId) return null;
  return {
    copyId, kind: data.kind === "restore" ? "restore" : "copy", targetId, phase: str(data.phase) ?? "",
    sourceSiteId: str(data.sourceSiteId), targetUrl: str(data.targetUrl), name: str(data.name), siteName: str(data.siteName),
    replaceSiteId: str(data.replaceSiteId), createdAt: str(data.createdAt), finishedAt: str(data.finishedAt),
  };
}

/** Complete local copies of `sourceSiteId` (one per target, newest first): copies and migrated legacy copies. */
export function existingCopies(copies: LocalCopyRecord[], sourceSiteId: string) {
  const byTarget = new Map<string, LocalCopyRecord>();
  for (const copy of copies) {
    if (copy.kind !== "copy" || copy.phase !== "complete" || copy.sourceSiteId !== sourceSiteId) continue;
    const seen = byTarget.get(copy.targetId);
    if (!seen || String(copy.finishedAt ?? copy.createdAt ?? "") > String(seen.finishedAt ?? seen.createdAt ?? "")) byTarget.set(copy.targetId, copy);
  }
  return [...byTarget.values()].sort((a, b) => String(b.finishedAt ?? b.createdAt ?? "").localeCompare(String(a.finishedAt ?? a.createdAt ?? "")));
}

/** Earlier complete copies of `sourceSiteId` that `copy.local { replaceSiteId }` may refresh (one per target). */
export function refreshCandidates(copies: LocalCopyRecord[], sourceSiteId: string) {
  const byTarget = new Map<string, LocalCopyRecord>();
  for (const copy of copies) {
    if (copy.kind !== "copy" || copy.phase !== "complete" || copy.sourceSiteId !== sourceSiteId || !copy.targetId.startsWith("ddev-")) continue;
    const seen = byTarget.get(copy.targetId);
    if (!seen || String(copy.finishedAt ?? copy.createdAt ?? "") > String(seen.finishedAt ?? seen.createdAt ?? "")) byTarget.set(copy.targetId, copy);
  }
  return [...byTarget.values()].sort((a, b) => String(b.finishedAt ?? "").localeCompare(String(a.finishedAt ?? "")));
}

// ---------------------------------------------------------------------------
// preview:<previewId> and preview-page:<previewId>:<n>

export type PreviewState = "new" | "changed" | "unchanged" | "blocked" | "database";
export interface PreviewFile { path: string; bytes: number; sha256?: string; state: PreviewState; expectedDestinationSha256?: string | null; /** Why a blocked file is blocked, e.g. "not accepted by Zoer Connect". */ reason?: string }
export interface PreviewSummary { previewId: string; siteId: string; setId: string; total: number; pages: number; complete: boolean; expiresAt: string; counts: Record<PreviewState, number> }

const PREVIEW_STATES: PreviewState[] = ["new", "changed", "unchanged", "blocked", "database"];

export function parsePreviewSummary(record: Raw): PreviewSummary | null {
  const data = obj(record.data);
  if (record.kind !== "preview" || !data) return null;
  const previewId = str(data.previewId), siteId = str(data.siteId), setId = str(data.setId), expiresAt = str(data.expiresAt);
  if (!previewId || !siteId || !setId || !expiresAt) return null;
  const counts = obj(data.counts) ?? {};
  return { previewId, siteId, setId, expiresAt, total: num(data.total) ?? 0, pages: num(data.pages) ?? 0, complete: data.complete === true,
    counts: Object.fromEntries(PREVIEW_STATES.map(state => [state, num(counts[state]) ?? 0])) as Record<PreviewState, number> };
}

/** Files of the preview's pages in page order, ignoring pages of other previews. */
export function previewFiles(records: Raw[], previewId: string): PreviewFile[] {
  const pages = records.flatMap(record => {
    const data = obj(record.data);
    if (record.kind !== "preview-page" || !data || data.previewId !== previewId || !Array.isArray(data.files)) return [];
    return [{ page: num(data.page) ?? 0, files: data.files as unknown[] }];
  }).sort((a, b) => a.page - b.page);
  const out: PreviewFile[] = [];
  for (const { files } of pages) for (const raw of files) {
    const file = obj(raw);
    const path = str(file?.path), state = str(file?.state) as PreviewState | undefined;
    if (!file || !path || !state || !PREVIEW_STATES.includes(state)) continue;
    const reason = str(file.reason);
    out.push({ path, bytes: num(file.bytes) ?? 0, state, sha256: str(file.sha256), expectedDestinationSha256: str(file.expectedDestinationSha256) ?? null, ...(reason ? { reason: reason.slice(0, 120) } : {}) });
  }
  return out;
}

export const previewExpired = (summary: Pick<PreviewSummary, "expiresAt">, now = Date.now()) => Date.parse(summary.expiresAt) <= now;

/** Paths selected by default: new and changed files (the database needs an explicit choice). */
export function defaultSelection(files: PreviewFile[]) {
  return files.filter(file => file.state === "new" || file.state === "changed").map(file => file.path);
}

export const MAX_SELECTED_PATHS = 20_000;

// ---------------------------------------------------------------------------
// History: transfer-history records merged with runs.recent

export type EngineHistoryKind = "pull" | "local-export" | "local-copy" | "restore" | "push" | "replace";
export interface EngineHistoryItem {
  key: string;
  kind: EngineHistoryKind;
  id: string;
  siteId: string;
  siteName?: string;
  sourceSiteId?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  bytes?: number;
  summary: string;
  error?: string;
  engine: "plugin" | "legacy";
  runId?: string;
  active: boolean;
}

export const ENGINE_HISTORY_LABELS: Record<EngineHistoryKind, string> = { pull: "Pull", "local-export": "Local export", "local-copy": "Local copy", restore: "Backup restore", push: "Push", replace: "Find & Replace" };
const HISTORY_KINDS = Object.keys(ENGINE_HISTORY_LABELS) as EngineHistoryKind[];

export function parseHistoryRecord(record: Raw): EngineHistoryItem | null {
  const data = obj(record.data);
  if (record.kind !== "transfer-history" || !data) return null;
  const kind = str(data.kind) as EngineHistoryKind | undefined, id = str(data.id), siteId = str(data.siteId), startedAt = str(data.startedAt);
  if (!kind || !HISTORY_KINDS.includes(kind) || !id || !siteId || !startedAt) return null;
  const lastError = typeof data.lastError === "string" ? data.lastError : str(obj(data.lastError)?.message);
  return {
    key: `${kind}:${id}`, kind, id, siteId, siteName: str(data.siteName), sourceSiteId: str(data.sourceSiteId),
    status: str(data.status) ?? "complete", startedAt, finishedAt: str(data.finishedAt), bytes: num(data.bytes),
    summary: str(data.summary) ?? "", ...(lastError ? { error: lastError } : {}),
    engine: data.engine === "legacy" ? "legacy" : "plugin", active: false,
  };
}

const RUN_KINDS: Record<string, EngineHistoryKind> = {
  [ENGINE_ACTIONS.pull]: "pull", [ENGINE_ACTIONS.localExport]: "local-export", [ENGINE_ACTIONS.push]: "push",
  [ENGINE_ACTIONS.replace]: "replace", [ENGINE_ACTIONS.copy]: "local-copy", [ENGINE_ACTIONS.restore]: "restore",
};

/** A history row for a run (pushes and replaces are never catalog records; others until their record lands). */
export function runHistoryItem(run: RecentRun): EngineHistoryItem | null {
  const kind = RUN_KINDS[run.actionId];
  if (!kind) return null;
  const input = runInput(run);
  const id = runTransferId(run);
  const siteId = str(input.siteId) ?? "";
  const active = !isTerminalStatus(run.status);
  // A push the site refused ends "succeeded" with a failure result; its last progress says so.
  const refused = run.status === "succeeded" && run.resumable?.progress?.phase === "failed";
  const status = refused ? "failed" : run.status === "succeeded" ? (input.dryRun === true ? "dry-run" : "complete") : active ? (run.resumable?.state ?? run.status) : run.status;
  const label = ENGINE_HISTORY_LABELS[kind];
  const summary = refused ? `${label} refused by the site.` : run.status === "succeeded" ? `${label} finished${input.dryRun === true ? " (dry run)" : ""}.` : active ? `${label} in progress.` : `${label} ${run.status === "cancelled" ? "cancelled" : "stopped"}.`;
  const error = refused ? run.resumable?.progress?.message : run.error;
  return {
    key: `${kind}:${id}`, kind, id, siteId, sourceSiteId: str(input.sourceSiteId), status, startedAt: run.createdAt,
    finishedAt: run.finishedAt, summary, ...(error ? { error } : {}), engine: "plugin", runId: run.runId, active,
  };
}

/** History records win over runs for the same transfer, except while the run is still active. Newest first. */
export function mergeEngineHistory(records: EngineHistoryItem[], runs: RecentRun[]): EngineHistoryItem[] {
  const merged = new Map<string, EngineHistoryItem>();
  for (const record of records) merged.set(record.key, record);
  for (const run of runs) {
    const item = runHistoryItem(run);
    if (!item) continue;
    const existing = merged.get(item.key);
    if (!existing || item.active) merged.set(item.key, existing ? { ...existing, ...item, siteName: existing.siteName } : item);
    else if (!existing.runId) merged.set(item.key, { ...existing, runId: item.runId });
  }
  return [...merged.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function filterEngineHistory(items: EngineHistoryItem[], { siteId, kind, canonicalId = id => id }: { siteId: string; kind: string; canonicalId?: (id: string) => string }) {
  const site = siteId ? canonicalId(siteId) : "";
  return items.filter(item => (!kind || item.kind === kind) && (!site || canonicalId(item.siteId) === site || (item.sourceSiteId && canonicalId(item.sourceSiteId) === site)));
}

/** Empty-state text of the transfer history (a site's History disclosure, or the all-sites list). */
export function historyEmptyText({ siteScoped, anyHistory }: { siteScoped: boolean; anyHistory: boolean }) {
  if (siteScoped) return "No transfers of this site yet. Finished, failed and cancelled transfers are listed here.";
  return anyHistory ? "No transfers match these filters." : "No transfers yet.";
}

/** The hint beside a site's collapsed History heading: how many entries, or that there are none. */
export function historySummaryHint({ loading, count }: { loading: boolean; count: number }) {
  if (loading) return "";
  return count ? `${count.toLocaleString("en-US")} ${count === 1 ? "transfer" : "transfers"}` : "None yet";
}

// ---------------------------------------------------------------------------
// site-link:<targetSiteId>  (local copy → the site it was copied from)

export interface SiteLinkRecord { targetSiteId: string; sourceSiteId: string }

export function parseSiteLink(record: Raw): SiteLinkRecord | null {
  const data = obj(record.data);
  if (record.kind !== "site-link" || !data) return null;
  const targetSiteId = str(data.targetSiteId), sourceSiteId = str(data.sourceSiteId);
  if (!targetSiteId || !sourceSiteId || targetSiteId === sourceSiteId) return null;
  return { targetSiteId, sourceSiteId };
}

/**
 * Sites with `sourceSiteId` filled from `site-link` records where Zoer's site list has none (since
 * Zoer P4 it is always null; before, the host knew only legacy copies). A link counts only when both
 * sites are listed.
 */
export function withSiteLinks<T extends { id: string; sourceSiteId?: string | null }>(sites: T[], links: SiteLinkRecord[]): T[] {
  if (!links.length) return sites;
  const ids = new Set(sites.map(site => site.id));
  const sourceOf = new Map(links.filter(link => ids.has(link.sourceSiteId)).map(link => [link.targetSiteId, link.sourceSiteId]));
  return sites.map(site => !site.sourceSiteId && sourceOf.has(site.id) ? { ...site, sourceSiteId: sourceOf.get(site.id)! } : site);
}

// ---------------------------------------------------------------------------
// deployment:<id> and recovery-point:<id>  (migrated from Zoer's wordpress-manager.json, non-secret fields)

const DEPLOYMENT_TYPES = ["full-site", "site-create", "extension-change"] as const;
const DEPLOYMENT_STATUSES = ["queued", "preparing", "uploading", "importing", "verifying", "verification_required", "succeeded", "failed", "outcome_unknown"] as const;
const nullable = (value: unknown) => str(value) ?? null;

export interface DeploymentRecord {
  id: string; type: typeof DEPLOYMENT_TYPES[number]; sourceSiteId: string | null; targetSiteId: string | null; connectionId: string | null; domain: string | null;
  status: typeof DEPLOYMENT_STATUSES[number]; step: string; createdAt: string; updatedAt: string; completedAt: string | null; error: string | null; details: Record<string, unknown>;
}

export function parseDeploymentRecord(record: Raw): DeploymentRecord | null {
  const data = obj(record.data);
  if (record.kind !== "deployment" || !data) return null;
  const id = str(data.id), createdAt = str(data.createdAt);
  const type = DEPLOYMENT_TYPES.find(value => value === data.type), status = DEPLOYMENT_STATUSES.find(value => value === data.status);
  if (!id || !createdAt || !type || !status) return null;
  return {
    id, type, status, createdAt, updatedAt: str(data.updatedAt) ?? createdAt, step: str(data.step) ?? "",
    sourceSiteId: nullable(data.sourceSiteId), targetSiteId: nullable(data.targetSiteId), connectionId: nullable(data.connectionId), domain: nullable(data.domain),
    completedAt: nullable(data.completedAt), error: nullable(data.error), details: obj(data.details) ?? {},
  };
}

/** Zoer's deployment receipts plus migrated catalog receipts it no longer lists (Zoer's entry wins). Newest first. */
export function mergeDeployments<T extends { id: string; updatedAt: string }>(host: T[], catalog: T[]): T[] {
  const ids = new Set(host.map(item => item.id));
  return [...host, ...catalog.filter(item => !ids.has(item.id))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface RecoveryPointRecord { id: string; connectionId: string; domain: string; label: string; method: "hostinger-hpanel"; verifiedAt: string; createdAt: string }

export function parseRecoveryPointRecord(record: Raw): RecoveryPointRecord | null {
  const data = obj(record.data);
  if (record.kind !== "recovery-point" || !data) return null;
  const id = str(data.id), connectionId = str(data.connectionId), domain = str(data.domain), verifiedAt = str(data.verifiedAt);
  if (!id || !connectionId || !domain || !verifiedAt) return null;
  return { id, connectionId, domain, label: str(data.label) ?? domain, method: "hostinger-hpanel", verifiedAt, createdAt: str(data.createdAt) ?? verifiedAt };
}

/** Recovery points of one Hostinger website (connection + domain), newest first, one per ID. */
export function recoveryPointsFor<T extends { id: string; connectionId: string; domain: string; verifiedAt: string }>(points: T[], site: { connectionId?: string | null; domain?: string | null }) {
  const domain = site.domain?.toLowerCase();
  const seen = new Set<string>();
  return points.filter(point => point.connectionId === site.connectionId && point.domain.toLowerCase() === domain && !seen.has(point.id) && (seen.add(point.id), true))
    .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
}

/** The catalog record for a recovery point Zoer just recorded, so this page lists it (Zoer's site details do not). */
export function recoveryPointRecord(point: RecoveryPointRecord) {
  return { id: `recovery-point:${point.id}`, kind: "recovery-point", title: (point.label || point.domain).slice(0, 300),
    data: { id: point.id, connectionId: point.connectionId, domain: point.domain, label: point.label, method: point.method, verifiedAt: point.verifiedAt, createdAt: point.createdAt, engine: "host" } };
}
