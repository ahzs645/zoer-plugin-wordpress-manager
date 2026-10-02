/**
 * Zoer Connect 0.4 transfer types (WP Migrate parity contract, section B).
 * Names and shapes are shared with the backend; keep them in sync.
 */

export type DatabaseFilters = {
  tables: "all" | string[];
  postTypes: "all" | string[];
  excludeRevisions: boolean;
  excludeSpam: boolean;
  excludeTransients: boolean;
};
export type ResourceModeName = "all" | "active" | "selected" | "except";
export type ResourceMode = { mode: ResourceModeName; items: string[] };
export type ExportResources = { database: boolean; themes: boolean; plugins: boolean; media: boolean; muplugins: boolean; core: boolean };
export type MediaMode = { mode: "all" | "since" | "since-last"; since?: string };
export type ExportOptions = {
  resources: ExportResources;
  excludes: string[];
  database: DatabaseFilters;
  themes: ResourceMode;
  plugins: ResourceMode;
  media: MediaMode;
};
export type ReplacementRow = { find: string; replace: string; regex: boolean; caseSensitive: boolean };
export type ImportOptions = {
  replacements: { automatic: boolean; variants: boolean; paths: boolean; custom: ReplacementRow[] };
  replaceGuids: boolean;
  keepActivePlugins: boolean | null;
  keepActiveTheme: boolean | null;
  authorMapping: "administrator" | "match";
  createTables: boolean;
  fence: "early" | "activation";
  review: boolean;
  purgeCaches: boolean;
};
export type TransferAction = "pull" | "push" | "replace" | "backup" | "export";
export type TransferProfile = {
  id: string; name: string; action: TransferAction; siteId?: string; sourceSiteId?: string;
  exportOptions: ExportOptions; importOptions: ImportOptions; createdAt: string; updatedAt: string;
};
/** A recorded run from `GET /transfer-profiles/recent`. */
export type TransferRecentRun = {
  id: string; action: TransferAction; siteId?: string; sourceSiteId?: string; name?: string;
  exportOptions: ExportOptions; importOptions: ImportOptions; startedAt: string;
};

/** Capability booleans reported by `GET /status` (plugin 0.4.0, apiVersion 2). */
export const ZOER_CONNECT_CAPABILITIES = [
  "replacementRules", "replacementVariants", "reviewPause", "createTables", "authorMapping", "keepActivePlugins", "lateFence",
  "importPauseResume", "importCleanup", "importList", "siteReplace", "cachePurge", "databaseFilters", "resourceModes", "mediaSince",
  "diagnostics", "safeErrors",
] as const;
export type ZoerConnectCapability = typeof ZOER_CONNECT_CAPABILITIES[number];
export type ZoerConnectCapabilities = Partial<Record<ZoerConnectCapability | string, boolean>>;

export type ZoerConnectStatus = {
  storage?: { ready?: boolean; code?: string; message: string };
  version: string;
  apiVersion?: number;
  stagingReady: boolean;
  push: boolean;
  pull: boolean;
  publish: boolean;
  pagedExport?: boolean;
  migrationMode?: "shared-replacement" | "verified-workers" | string;
  capabilities?: ZoerConnectCapabilities;
};
export type ZoerConnectConnection = { url: string; testedAt: string; status: ZoerConnectStatus };

export type DiagnosticsTable = { name: string; suffix: string | null; prefixed: boolean; engine?: string; rows?: number; bytes?: number; primaryKey?: boolean; foreignKeys?: boolean; triggers?: boolean };
export type DiagnosticsWarning = { code: string; message: string };
export type WordPressDiagnostics = {
  wordpress?: { version?: string; prefix?: string; home?: string; siteurl?: string; abspath?: string; contentDir?: string; uploadsDir?: string; locale?: string; permalinkStructure?: string; blogPublic?: boolean };
  php?: { version?: string; memoryLimit?: string; maxExecutionTime?: number | string; postMaxSize?: string; uploadMaxFilesize?: string; extensions?: Record<string, boolean> };
  database?: { server?: string; version?: string; charset?: string; collate?: string; lowerCaseTableNames?: number; tables?: DiagnosticsTable[] };
  postTypes?: Array<{ name: string; label?: string; count?: number }>;
  themes?: Array<{ slug: string; name?: string; version?: string; active?: boolean; parent?: string | null }>;
  plugins?: Array<{ slug: string; file?: string; name?: string; version?: string; active?: boolean }>;
  muPlugins?: Array<{ file: string; name?: string }>;
  dropins?: string[];
  warnings?: DiagnosticsWarning[];
  pluginUpdate?: { current?: string; latest?: string | null };
};

export type PushJobStatus = "queued" | "running" | "paused" | "review" | "verification" | "complete" | "rolled_back" | "failed" | "cancelled";
export type PushSource = { kind: "local-export"; sourceSiteId: string; exportId: string } | { kind: "pull"; sourceSiteId: string; pullId: string };
export type ImportTableStat = { name: string; rows?: number; replacements?: number; created?: boolean; schemaReplaced?: boolean };
export type ImportSample = { table: string; column: string; before: string; after: string };
export type ImportStats = { replacements?: number; tables?: ImportTableStat[]; samples?: ImportSample[] };
export type WordPressPushJob = {
  id: string;
  kind: "push" | "replace";
  siteId: string;
  source?: { kind: string; siteId?: string; id?: string; name?: string } | null;
  phase: string;
  status: PushJobStatus;
  runner?: "running" | "idle";
  progress?: { uploadedBytes?: number; totalBytes?: number; filesUploaded?: number; fileCount?: number; tableIndex?: number; tableCount?: number; rowsRead?: number; percent?: number | null; requests?: number };
  /** Batched upload (Zoer Connect 0.4 `batchUpload`); absent for one-block-per-request uploads. */
  transfer?: { transport: "octet-stream" | "multipart" | "json" | "chunks"; batchBytes: number; ceiling: number | null; wireBytes: number } | null;
  stats?: ImportStats | null;
  review?: ImportStats | null;
  authors?: { matched: number; fallback: number } | null;
  options?: Partial<ImportOptions> | null;
  lastError?: { message: string; phase?: string; at?: string } | null;
  /** Non-fatal notes, e.g. an option the runner had to skip. */
  warnings?: string[];
  createdAt: string;
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
  cleanedUp?: boolean;
  target?: string;
  /** 0.3.x view fields, kept for records created before the server runner. */
  index?: number;
  fileCount?: number;
};
export type PushCommand = "run" | "pause" | "resume" | "approve" | "finish" | "rollback" | "cleanup" | "delete";

export type TransferHistoryKind = "pull" | "push" | "replace" | "local-copy";
export type TransferHistoryItem = {
  kind: TransferHistoryKind; id: string; siteId: string; siteName: string; sourceSiteId?: string; sourceName?: string;
  status: string; startedAt: string; finishedAt?: string | null; bytes?: number | null; summary: string;
  lastError?: string | { message: string; phase?: string } | null;
};
