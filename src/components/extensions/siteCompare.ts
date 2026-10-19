import type { WordPressInstalledExtension, WordPressManagedSite } from "../../lib/api";

/** "not-reported": a host that doesn't report a version (Hostinger leaves WordPress and PHP out). */
export type CompareState = "only-live" | "only-local" | "version-differs" | "status-differs" | "same" | "not-reported";

export interface CompareRow {
  key: string;
  kind: "core" | "php" | "plugin" | "theme";
  name: string;
  live: string | null;
  local: string | null;
  state: CompareState;
}

export const COMPARE_STATE_LABELS: Record<CompareState, string> = {
  "only-live": "Only on live",
  "only-local": "Only on local",
  "version-differs": "Different version",
  "status-differs": "Active on one only",
  same: "Same",
  "not-reported": "Not reported",
};

/** Differences first, in the order a reviewer acts on them; "same" rows last. */
const STATE_ORDER: Record<CompareState, number> = { "version-differs": 0, "only-live": 1, "only-local": 2, "status-differs": 3, same: 4, "not-reported": 5 };

function active(status: string) {
  return status === "active" || status === "must-use" || status === "network-active" || status === "parent";
}

function describe(extension: WordPressInstalledExtension) {
  return `${extension.version || "unknown"}${active(extension.status) ? "" : ` · ${extension.status || "inactive"}`}`;
}

function versionRow(kind: "core" | "php", name: string, live: string | null, local: string | null): CompareRow | null {
  if (!live && !local) return null;
  // A version missing on one side means that host didn't report it, not that WordPress is absent.
  const state: CompareState = !live || !local ? "not-reported" : live === local ? "same" : "version-differs";
  return { key: kind, kind, name, live, local, state };
}

function extensionRows(kind: "plugin" | "theme", live: WordPressInstalledExtension[], local: WordPressInstalledExtension[]): CompareRow[] {
  const liveBySlug = new Map(live.map(item => [item.slug, item]));
  const localBySlug = new Map(local.map(item => [item.slug, item]));
  const slugs = [...new Set([...liveBySlug.keys(), ...localBySlug.keys()])];
  return slugs.map(slug => {
    const onLive = liveBySlug.get(slug);
    const onLocal = localBySlug.get(slug);
    const state: CompareState = !onLocal ? "only-live"
      : !onLive ? "only-local"
      : (onLive.version || "") !== (onLocal.version || "") ? "version-differs"
      : active(onLive.status) !== active(onLocal.status) ? "status-differs"
      : "same";
    return {
      key: `${kind}:${slug}`,
      kind,
      name: onLive?.name || onLocal?.name || slug,
      live: onLive ? describe(onLive) : null,
      local: onLocal ? describe(onLocal) : null,
      state,
    };
  });
}

/** What one side's plugins and themes queries returned. */
export interface ExtensionReport {
  site?: WordPressManagedSite | null;
  plugins?: WordPressInstalledExtension[] | null;
  themes?: WordPressInstalledExtension[] | null;
  errors?: string[] | null;
  failed?: boolean;
}

/**
 * Whether a side really listed its plugins and themes. Hosts answer `[]` with no error when they
 * can't list them (a Zoer Connect site without a Hostinger record, a Hostinger site Zoer can't
 * identify), and every WordPress site has at least one theme, so empty lists mean "not reported".
 */
export function extensionsReported(report: ExtensionReport | null | undefined): boolean {
  if (!report || report.failed || (report.errors?.length ?? 0) > 0) return false;
  if (report.site && report.site.capabilities?.extensions === false) return false;
  if (!Array.isArray(report.plugins) || !Array.isArray(report.themes)) return false;
  return report.plugins.length + report.themes.length > 0;
}

/**
 * Rows comparing a live site with a local copy: WordPress, PHP, then plugins and themes by slug.
 * Pass `null` lists for a side that didn't report them: no extension rows are built then, so
 * missing data is never shown as "only on" the other side.
 */
export function compareSites(input: {
  live: WordPressManagedSite;
  local: WordPressManagedSite;
  livePlugins: WordPressInstalledExtension[] | null;
  localPlugins: WordPressInstalledExtension[] | null;
  liveThemes: WordPressInstalledExtension[] | null;
  localThemes: WordPressInstalledExtension[] | null;
}): CompareRow[] {
  const versions = [
    versionRow("core", "WordPress", input.live.wordpressVersion, input.local.wordpressVersion),
    versionRow("php", "PHP", input.live.phpVersion, input.local.phpVersion),
  ].filter((row): row is CompareRow => !!row);
  const bothReported = input.livePlugins && input.localPlugins && input.liveThemes && input.localThemes;
  const extensions = !bothReported ? [] : [
    ...extensionRows("plugin", input.livePlugins!, input.localPlugins!),
    ...extensionRows("theme", input.liveThemes!, input.localThemes!),
  ].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return [...versions, ...extensions];
}

/** Rows that need a look: everything except matches and versions a host doesn't report. */
export function isDifference(row: CompareRow) {
  return row.state !== "same" && row.state !== "not-reported";
}

export function compareSummary(rows: CompareRow[]): Record<CompareState, number> {
  const counts: Record<CompareState, number> = { "only-live": 0, "only-local": 0, "version-differs": 0, "status-differs": 0, same: 0, "not-reported": 0 };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}
