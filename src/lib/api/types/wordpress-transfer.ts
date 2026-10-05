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
