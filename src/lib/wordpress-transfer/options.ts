import type {
  DatabaseFilters, ExportOptions, ExportResources, ImportOptions, ReplacementRow, ResourceMode, TransferAction,
  ZoerConnectCapabilities, ZoerConnectCapability,
} from "../api/types/wordpress-transfer";
import { validateReplacementRow } from "./replacementRegex";

export const REQUIRES_040 = "Requires Zoer Connect 0.4.0 on the destination";
export const REQUIRES_040_SOURCE = "Requires Zoer Connect 0.4.0 on this site";
export const TRANSFER_ACTIONS: TransferAction[] = ["pull", "push", "replace", "backup", "export"];
export const MAX_CUSTOM_REPLACEMENTS = 50;

export function defaultDatabaseFilters(): DatabaseFilters {
  return { tables: "all", postTypes: "all", excludeRevisions: false, excludeSpam: false, excludeTransients: true };
}
/** Filters that reproduce a 0.3.x full database export. */
export function legacyDatabaseFilters(): DatabaseFilters { return defaultDatabaseFilters(); }

export function defaultResources(action: TransferAction): ExportResources {
  if (action === "backup") return { database: true, themes: false, plugins: false, media: false, muplugins: false, core: false };
  return { database: true, themes: true, plugins: true, media: true, muplugins: false, core: false };
}

export function defaultExportOptions(action: TransferAction = "pull"): ExportOptions {
  return {
    resources: defaultResources(action),
    excludes: [],
    database: defaultDatabaseFilters(),
    themes: { mode: "all", items: [] },
    plugins: { mode: "all", items: [] },
    media: { mode: "all" },
  };
}

/** UI defaults for new runs (contract section B). */
export function defaultImportOptions(): ImportOptions {
  return {
    replacements: { automatic: true, variants: true, paths: true, custom: [] },
    replaceGuids: true, keepActivePlugins: null, keepActiveTheme: null, authorMapping: "match",
    createTables: false, fence: "activation", review: false, purgeCaches: true,
  };
}
/** The values that reproduce 0.3.14 behaviour; used when the destination lacks a capability. */
export function legacyImportOptions(): ImportOptions {
  return {
    replacements: { automatic: true, variants: false, paths: false, custom: [] },
    replaceGuids: true, keepActivePlugins: null, keepActiveTheme: null, authorMapping: "administrator",
    createTables: false, fence: "early", review: false, purgeCaches: false,
  };
}

export function hasCapability(capabilities: ZoerConnectCapabilities | undefined | null, capability: ZoerConnectCapability) {
  return capabilities?.[capability] === true;
}

type ImportGate = { label: string; capability: ZoerConnectCapability; active: (o: ImportOptions) => boolean; reset: (o: ImportOptions) => ImportOptions };
const importGates: ImportGate[] = [
  { label: "URL variants", capability: "replacementVariants", active: o => o.replacements.variants, reset: o => ({ ...o, replacements: { ...o.replacements, variants: false } }) },
  { label: "Filesystem path replacement", capability: "replacementRules", active: o => o.replacements.paths, reset: o => ({ ...o, replacements: { ...o.replacements, paths: false } }) },
  { label: "Custom find & replace rows", capability: "replacementRules", active: o => o.replacements.custom.length > 0 || !o.replacements.automatic, reset: o => ({ ...o, replacements: { ...o.replacements, automatic: true, custom: [] } }) },
  { label: "Keep GUIDs unchanged", capability: "replacementRules", active: o => !o.replaceGuids, reset: o => ({ ...o, replaceGuids: true }) },
  { label: "Active plugin / theme choice", capability: "keepActivePlugins", active: o => o.keepActivePlugins !== null || o.keepActiveTheme !== null, reset: o => ({ ...o, keepActivePlugins: null, keepActiveTheme: null }) },
  { label: "Author mapping", capability: "authorMapping", active: o => o.authorMapping === "match", reset: o => ({ ...o, authorMapping: "administrator" }) },
  { label: "Create missing tables", capability: "createTables", active: o => o.createTables, reset: o => ({ ...o, createTables: false }) },
  { label: "Review before applying", capability: "reviewPause", active: o => o.review, reset: o => ({ ...o, review: false }) },
  { label: "Keep site online while staging", capability: "lateFence", active: o => o.fence === "activation", reset: o => ({ ...o, fence: "early", review: false }) },
  { label: "Purge page caches", capability: "cachePurge", active: o => o.purgeCaches, reset: o => ({ ...o, purgeCaches: false }) },
];

/**
 * Downgrades every option the destination cannot honour to its 0.3.14 value, so the backend never
 * receives (and rejects) an unsupported non-default. Returns the labels that were turned off.
 */
export function applyImportCapabilities(options: ImportOptions, capabilities: ZoerConnectCapabilities | undefined | null) {
  let next = enforceReviewFence(options);
  const downgraded: string[] = [];
  for (const gate of importGates) {
    if (!hasCapability(capabilities, gate.capability) && gate.active(next)) { next = gate.reset(next); downgraded.push(gate.label); }
  }
  return { options: next, downgraded };
}

/** Same for export filters when the pull source is a remote plugin (local DDEV sources support all of them). */
export function applyExportCapabilities(options: ExportOptions, capabilities: ZoerConnectCapabilities | undefined | null, local = false) {
  if (local) return { options, downgraded: [] as string[] };
  const downgraded: string[] = [];
  let next = options;
  const db = options.database;
  const defaults = legacyDatabaseFilters();
  if (!hasCapability(capabilities, "databaseFilters") && (db.tables !== "all" || db.postTypes !== "all" || db.excludeRevisions || db.excludeSpam || db.excludeTransients !== defaults.excludeTransients)) {
    next = { ...next, database: defaults }; downgraded.push("Database filters");
  }
  if (!hasCapability(capabilities, "resourceModes") && (next.themes.mode !== "all" || next.plugins.mode !== "all")) {
    next = { ...next, themes: { mode: "all", items: [] }, plugins: { mode: "all", items: [] } }; downgraded.push("Theme and plugin selection");
  }
  if (!hasCapability(capabilities, "mediaSince") && next.media.mode !== "all") { next = { ...next, media: { mode: "all" } }; downgraded.push("Media date filter"); }
  return { options: next, downgraded };
}

/** A review pause needs the late fence: the plugin rejects review with fence "early". */
export function enforceReviewFence(options: ImportOptions): ImportOptions {
  return options.review && options.fence !== "activation" ? { ...options, fence: "activation" } : options;
}

/** Resources a given action may transfer. MU plugins and core are download-only. */
export function resourcesForAction(action: TransferAction, resources: ExportResources): ExportResources {
  if (action === "backup") return defaultResources("backup");
  if (action === "push") return { ...resources, muplugins: false, core: false };
  return resources;
}

export function exportOptionsForAction(action: TransferAction, options: ExportOptions): ExportOptions {
  const resources = resourcesForAction(action, options.resources);
  return {
    ...options, resources,
    themes: resources.themes ? options.themes : { mode: "all", items: [] },
    plugins: resources.plugins ? options.plugins : { mode: "all", items: [] },
    media: resources.media ? options.media : { mode: "all" },
    excludes: action === "backup" ? [] : options.excludes,
  };
}

/** Default Find & Replace scope: every prefixed table except users and usermeta. */
export function defaultReplaceTables(suffixes: string[]) { return suffixes.filter(suffix => suffix !== "users" && suffix !== "usermeta"); }

/** The options a replace-only job sends: custom rows only, always reviewed with the late fence. */
export function replaceJobOptions(options: ImportOptions, purgeSupported: boolean): ImportOptions {
  return {
    ...options,
    replacements: { automatic: false, variants: false, paths: false, custom: options.replacements.custom },
    keepActivePlugins: null, keepActiveTheme: null, authorMapping: "administrator", createTables: false,
    review: true, fence: "activation", purgeCaches: purgeSupported && options.purgeCaches,
  };
}

export function parseExcludes(text: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 100);
}

export function importOptionsErrors(options: ImportOptions, { requireCustom = false } = {}) {
  const errors: string[] = [];
  if (options.review && options.fence !== "activation") errors.push("Review before applying requires keeping the site online while staging.");
  if (options.replacements.custom.length > MAX_CUSTOM_REPLACEMENTS) errors.push(`Use at most ${MAX_CUSTOM_REPLACEMENTS} custom replacement rows.`);
  options.replacements.custom.forEach((row, index) => {
    const result = validateReplacementRow(row);
    if (!result.ok) errors.push(`Row ${index + 1}: ${result.error}`);
  });
  if (requireCustom && !options.replacements.custom.length) errors.push("Add at least one find & replace row.");
  return errors;
}

export function exportOptionsErrors(options: ExportOptions) {
  const errors: string[] = [];
  const r = options.resources;
  if (!Object.values(r).some(Boolean)) errors.push("Select at least one resource.");
  if (r.database && Array.isArray(options.database.tables) && !options.database.tables.length) errors.push("Select at least one database table.");
  if (r.database && Array.isArray(options.database.postTypes) && !options.database.postTypes.length) errors.push("Select at least one post type.");
  for (const kind of ["themes", "plugins"] as const) {
    const mode = options[kind];
    if (r[kind] && (mode.mode === "selected" || mode.mode === "except") && !mode.items.length) errors.push(`Choose at least one ${kind === "themes" ? "theme" : "plugin"} for “${mode.mode === "selected" ? "Selected" : "All except"}”.`);
  }
  if (r.media && options.media.mode === "since" && !/^\d{4}-\d{2}-\d{2}$/.test(options.media.since ?? "")) errors.push("Choose the date media should be copied from.");
  return errors;
}

// ---------------------------------------------------------------------------
// Normalisation (profiles and recent runs may come from an older or newer client).

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
const listOrAll = (value: unknown): "all" | string[] => Array.isArray(value) ? strings(value) : "all";
const triState = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;

function normalizeMode(value: unknown): ResourceMode {
  if (!isRecord(value)) return { mode: "all", items: [] };
  const mode = ["all", "active", "selected", "except"].includes(value.mode as string) ? value.mode as ResourceMode["mode"] : "all";
  return { mode, items: strings(value.items) };
}

export function normalizeExportOptions(value: unknown, action: TransferAction = "pull"): ExportOptions {
  const defaults = defaultExportOptions(action);
  if (!isRecord(value)) return defaults;
  const r = isRecord(value.resources) ? value.resources : {};
  const db = isRecord(value.database) ? value.database : {};
  const media = isRecord(value.media) ? value.media : {};
  const mediaMode = ["all", "since", "since-last"].includes(media.mode as string) ? media.mode as ExportOptions["media"]["mode"] : "all";
  return exportOptionsForAction(action, {
    resources: Object.fromEntries(Object.entries(defaults.resources).map(([key, fallback]) => [key, bool(r[key], fallback)])) as ExportResources,
    excludes: strings(value.excludes).slice(0, 100),
    database: {
      tables: listOrAll(db.tables), postTypes: listOrAll(db.postTypes),
      excludeRevisions: bool(db.excludeRevisions, false), excludeSpam: bool(db.excludeSpam, false), excludeTransients: bool(db.excludeTransients, true),
    },
    themes: normalizeMode(value.themes),
    plugins: normalizeMode(value.plugins),
    media: mediaMode === "since" && typeof media.since === "string" ? { mode: "since", since: media.since } : { mode: mediaMode === "since" ? "all" : mediaMode },
  });
}

function normalizeRow(value: unknown): ReplacementRow | null {
  if (!isRecord(value) || typeof value.find !== "string") return null;
  return { find: value.find, replace: typeof value.replace === "string" ? value.replace : "", regex: bool(value.regex, false), caseSensitive: bool(value.caseSensitive, true) };
}

export function normalizeImportOptions(value: unknown): ImportOptions {
  const defaults = defaultImportOptions();
  if (!isRecord(value)) return defaults;
  const rep = isRecord(value.replacements) ? value.replacements : {};
  const custom = Array.isArray(rep.custom) ? rep.custom.map(normalizeRow).filter((row): row is ReplacementRow => row !== null).slice(0, MAX_CUSTOM_REPLACEMENTS) : [];
  return enforceReviewFence({
    replacements: { automatic: bool(rep.automatic, true), variants: bool(rep.variants, defaults.replacements.variants), paths: bool(rep.paths, defaults.replacements.paths), custom },
    replaceGuids: bool(value.replaceGuids, true),
    keepActivePlugins: "keepActivePlugins" in value ? triState(value.keepActivePlugins) : defaults.keepActivePlugins,
    keepActiveTheme: "keepActiveTheme" in value ? triState(value.keepActiveTheme) : defaults.keepActiveTheme,
    authorMapping: value.authorMapping === "administrator" || value.authorMapping === "match" ? value.authorMapping : defaults.authorMapping,
    createTables: bool(value.createTables, false),
    fence: value.fence === "early" || value.fence === "activation" ? value.fence : defaults.fence,
    review: bool(value.review, false),
    purgeCaches: bool(value.purgeCaches, defaults.purgeCaches),
  });
}

/** What a stored pull contains, for the backups list. Handles 0.3 and 0.4 option shapes. */
export function pullContents(options: unknown): { database: boolean; files: boolean; label: string } {
  let database = false; let files: string[] = [];
  if (isRecord(options)) {
    if (isRecord(options.resources)) {
      database = options.resources.database === true;
      files = Object.entries(options.resources).filter(([key, on]) => key !== "database" && on === true).map(([key]) => key);
    } else {
      database = options.database === true || isRecord(options.database);
      const profile = isRecord(options.profile) ? options.profile : {};
      files = ["themes", "plugins", "media", "muplugins", "core"].filter(key => profile[key] === true);
    }
  }
  const complete = database && ["themes", "plugins", "media"].every(key => files.includes(key));
  const label = complete ? "Complete site" : database && !files.length ? "Database only" : !database && files.length ? "Files only" : database ? "Database + selected files" : "Unknown contents";
  return { database, files: files.length > 0, label };
}

/** True when a stored pull includes MU plugins or core, which are download-only. */
export function pullIncludesDownloadOnly(options: unknown) {
  if (!isRecord(options)) return false;
  const source = isRecord(options.resources) ? options.resources : isRecord(options.profile) ? options.profile : {};
  return source.muplugins === true || source.core === true;
}

/** A stored export limited to chosen tables needs a destination that accepts partial databases. */
export function pullHasTableSubset(options: unknown) {
  return isRecord(options) && isRecord(options.database) && Array.isArray(options.database.tables)
    || isRecord(options) && isRecord(options.options) && isRecord(options.options.database) && Array.isArray(options.options.database.tables);
}

export function compareVersions(a: string, b: string) {
  const pa = a.split(/[.-]/).map(x => Number.parseInt(x, 10) || 0), pb = b.split(/[.-]/).map(x => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

