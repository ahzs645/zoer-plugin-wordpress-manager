import type { ReplacementRow, ResourceMode } from "../../../lib/api/types/wordpress-transfer";

/**
 * What a local copy or refresh takes from the live site and how it is imported (WP Migrate's pull
 * settings). The dialog edits these; `copyInput` turns them into `copy.local` input, and saved
 * presets store them as they are.
 */
export interface CopySettings {
  /** Replace the database (users, content, settings). */ database: boolean;
  /** Place theme and plugin files (and media, by `media`). */ files: boolean;
  media: "all" | "since-last" | "none";
  themes: ResourceMode;
  plugins: ResourceMode;
  /** Refresh: delete local files in placed theme/plugin folders that live no longer has. */ removeStale: boolean;
  /** Also place wp-content/languages (translations; Zoer Connect 0.9.0 on the live site). */ languages: boolean;
  excludeRevisions: boolean;
  excludeSpam: boolean;
  postTypes: "all" | string[];
  /** Refresh only; must include posts and options. */ tables: "all" | string[];
  /** Database-only refresh: keep matching local pages, templates and blocks. */ keepLocalDesign: boolean;
  /** Complete copies: which plugins are active afterwards. Defaults to the live site's; the outbound guard stays on either way. */
  activePlugins: "none" | "local" | "source";
  replacePaths: boolean;
  custom: ReplacementRow[];
  pace: "normal" | "gentle";
  /**
   * Accounts when the database is replaced: "local" keeps only the local administrator, "source"
   * copies the source's users beside it, "exact" copies exactly the source's users. Saved with a
   * preset so loading it restores the whole operation.
   */
  users: "local" | "source" | "exact";
}

export const ALL: ResourceMode = { mode: "all", items: [] };

export function defaultCopySettings(refresh: boolean): CopySettings {
  return { database: true, files: !refresh, media: "all", themes: ALL, plugins: ALL, removeStale: false, languages: false, excludeRevisions: false, excludeSpam: false, postTypes: "all", tables: "all",
    keepLocalDesign: true, activePlugins: "source", replacePaths: false, custom: [], pace: "normal", users: "local" };
}

export type CopyScope = "complete" | "database" | "files";

export function copyScope(settings: Pick<CopySettings, "database" | "files">): CopyScope | null {
  if (settings.database && settings.files) return "complete";
  if (settings.database) return "database";
  if (settings.files) return "files";
  return null;
}

const narrowed = (mode: ResourceMode) => mode.mode !== "all" && !(mode.mode === "except" && !mode.items.length);

/**
 * Why these settings cannot start, or null. Mirrors the worker's checks (plugin/worker/lib/copy.js
 * `copyOptions`) so the button explains itself before a run is refused.
 */
export function copySettingsProblem(settings: CopySettings, refresh: boolean): string | null {
  const scope = copyScope(settings);
  if (!scope) return "Choose the database, the files, or both.";
  if (!refresh && scope !== "complete") return "A new copy takes both the database and the files.";
  if (settings.files) for (const [kind, mode] of [["themes", settings.themes], ["plugins", settings.plugins]] as const) if (mode.mode === "selected" && !mode.items.length) return `Choose at least one of the ${kind}, or take all ${kind}.`;
  if (settings.database && Array.isArray(settings.postTypes) && !settings.postTypes.length) return "Choose at least one post type, or take all post types.";
  if (settings.database && Array.isArray(settings.tables)) {
    if (!refresh) return "A new copy needs every table.";
    if (!settings.tables.includes("posts") || (scope === "complete" && !settings.tables.includes("options"))) return scope === "complete" ? "Include the posts and options tables." : "Include the posts table.";
  }
  if (settings.database && settings.custom.some(row => !row.find)) return "Fill in or remove the empty find & replace rule.";
  if (settings.database && settings.custom.length > 40) return "Use at most 40 find & replace rules.";
  return null;
}

/** `copy.local` input fields for these settings (the scope, filters and import options; not the site IDs). */
export function copyInput(settings: CopySettings, refresh: boolean): Record<string, unknown> {
  const scope = copyScope(settings) ?? "complete";
  const input: Record<string, unknown> = {};
  if (refresh) input.scope = scope;
  if (settings.files) {
    // A new copy cannot ask for "new media since the last download": it has none yet.
    const media = !refresh && settings.media === "since-last" ? "all" : settings.media;
    if (media !== "all") input.media = media;
    if (narrowed(settings.themes)) input.themes = settings.themes;
    if (narrowed(settings.plugins)) input.plugins = settings.plugins;
    if (refresh && settings.removeStale) input.removeStale = true;
    if (settings.languages) input.languages = true;
  }
  if (settings.database) {
    const database: Record<string, unknown> = {};
    if (settings.excludeRevisions) database.excludeRevisions = true;
    if (settings.excludeSpam) database.excludeSpam = true;
    if (Array.isArray(settings.postTypes)) database.postTypes = settings.postTypes;
    if (refresh && Array.isArray(settings.tables)) database.tables = settings.tables;
    if (Object.keys(database).length) input.database = database;
    if (scope === "database") input.keepLocalDesign = settings.keepLocalDesign;
    if (scope === "complete" && settings.activePlugins !== "none" && (refresh || settings.activePlugins === "source")) input.activePlugins = settings.activePlugins;
    const custom = settings.custom.filter(row => row.find);
    if (settings.replacePaths || custom.length) input.replacements = { ...(settings.replacePaths ? { paths: true } : {}), ...(custom.length ? { custom } : {}) };
  }
  if (settings.pace === "gentle") input.pace = "gentle";
  return input;
}

/**
 * `copy.local` input for a copy from an existing download: the download keeps its own selection, so
 * the scope follows what it holds (a no-media download refreshes as "without-media") and only the
 * import options of `settings` apply.
 */
export function copyInputForDownload(settings: CopySettings, refresh: boolean, download: { options: { profile?: Record<string, unknown>; database?: unknown } | null }): Record<string, unknown> {
  const profile = download.options?.profile ?? {};
  const database = !!download.options?.database, files = profile.themes === true && profile.plugins === true, media = profile.media === true;
  const scope = database && files ? (media ? "complete" : "without-media") : database ? "database" : "files";
  const imported: CopySettings = { ...settings, database, files, media: media ? "all" : "none" };
  const base = copyInput(imported, refresh);
  const input: Record<string, unknown> = {};
  if (refresh) input.scope = scope;
  for (const key of ["removeStale", "keepLocalDesign", "activePlugins", "replacements"]) if (base[key] !== undefined) input[key] = base[key];
  return input;
}

/** One-line description of the settings, for the summary under the dialog title and preset lists. */
export function copySettingsSummary(settings: CopySettings, refresh: boolean): string {
  const scope = copyScope(settings);
  if (!scope) return "Nothing selected";
  const parts: string[] = [];
  parts.push(scope === "complete" ? "Database and files" : scope === "database" ? "Database only" : "Files only");
  if (settings.files) {
    parts.push(settings.media === "none" ? "no media" : settings.media === "since-last" && refresh ? "new media only" : "all media");
    for (const kind of ["themes", "plugins"] as const) if (narrowed(settings[kind])) parts.push(`${settings[kind].mode === "active" ? "active" : settings[kind].mode === "except" ? "most" : "selected"} ${kind}`);
    if (settings.languages) parts.push("translations");
    if (refresh && settings.removeStale) parts.push("deleted files removed");
  }
  if (settings.database) {
    if (settings.excludeRevisions || settings.excludeSpam) parts.push(["no revisions", "no spam"].filter((_, i) => i ? settings.excludeSpam : settings.excludeRevisions).join(", "));
    if (Array.isArray(settings.postTypes)) parts.push(`${settings.postTypes.length} post ${settings.postTypes.length === 1 ? "type" : "types"}`);
    if (refresh && Array.isArray(settings.tables)) parts.push(`${settings.tables.length} ${settings.tables.length === 1 ? "table" : "tables"}`);
    if (scope === "complete") parts.push(settings.activePlugins === "local" && refresh ? "local plugins stay active" : settings.activePlugins === "source" ? "live plugins active" : "plugins inactive");
    const rules = settings.custom.filter(row => row.find).length + (settings.replacePaths ? 1 : 0);
    if (rules) parts.push(`${rules} extra ${rules === 1 ? "replacement" : "replacements"}`);
  }
  if (settings.database && settings.users !== "local") parts.push(settings.users === "exact" ? "exactly the live site's users" : "live site's users copied");
  if (settings.pace === "gentle") parts.push("gentle pace");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Saved presets (`refresh-preset:<id>` catalog records)
// ---------------------------------------------------------------------------------------------

export interface CopyPreset { id: string; name: string; settings: CopySettings; updatedAt: string }

const modeOf = (value: unknown): ResourceMode => {
  const v = value as ResourceMode | undefined;
  return v && ["all", "active", "selected", "except"].includes(v.mode) && Array.isArray(v.items) ? { mode: v.mode, items: v.items.filter((item): item is string => typeof item === "string").slice(0, 500) } : ALL;
};
const listOf = (value: unknown, max: number): "all" | string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max) : "all";

/** A preset record, with every field checked (the catalog is the plugin's own, but stays untrusted input). */
export function parseCopyPreset(record: { id: string; kind: string; data: Record<string, unknown> }): CopyPreset | null {
  if (record.kind !== "refresh-preset" || !record.id.startsWith("refresh-preset:")) return null;
  const d = record.data, s = (d.settings ?? {}) as Record<string, unknown>;
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 60) return null;
  const base = defaultCopySettings(true);
  const bool = (key: keyof CopySettings) => typeof s[key] === "boolean" ? s[key] as boolean : base[key] as boolean;
  const custom = Array.isArray(s.custom) ? s.custom.filter((row): row is ReplacementRow => !!row && typeof row === "object" && typeof (row as ReplacementRow).find === "string" && typeof (row as ReplacementRow).replace === "string")
    .slice(0, 40).map(row => ({ find: row.find, replace: row.replace, regex: row.regex === true, caseSensitive: row.caseSensitive !== false })) : [];
  return { id: record.id, name: d.name.trim(), updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    settings: { ...base, database: bool("database"), files: bool("files"), removeStale: bool("removeStale"), languages: bool("languages"), excludeRevisions: bool("excludeRevisions"), excludeSpam: bool("excludeSpam"), keepLocalDesign: bool("keepLocalDesign"), replacePaths: bool("replacePaths"),
      media: ["all", "since-last", "none"].includes(s.media as string) ? s.media as CopySettings["media"] : "all",
      activePlugins: ["none", "local", "source"].includes(s.activePlugins as string) ? s.activePlugins as CopySettings["activePlugins"] : base.activePlugins,
      pace: s.pace === "gentle" ? "gentle" : "normal",
      // Presets saved before the account choice was stored keep the local administrator only.
      users: s.users === "source" || s.users === "exact" ? s.users : "local", themes: modeOf(s.themes), plugins: modeOf(s.plugins), postTypes: listOf(s.postTypes, 100), tables: listOf(s.tables, 500), custom } };
}

export function copyPresetRecord(id: string, name: string, settings: CopySettings, now = new Date()) {
  return { id: `refresh-preset:${id}`, kind: "refresh-preset", title: name, data: { v: 1, name, settings, updatedAt: now.toISOString() } };
}
