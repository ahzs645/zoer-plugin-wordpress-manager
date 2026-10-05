/**
 * Transfer-panel inventories without Zoer's legacy transfer routes (0.8.0):
 *
 * - a Zoer Connect site: `site.test { diagnostics: true }` reads the site's own `/diagnostics`
 *   (previously proxied by Zoer's legacy transfer routes);
 * - a local DDEV site: three bounded `wpcli.read` runs (`db tables`, `plugin list`, `theme list`)
 *   instead of the DDEV bridge inventory behind Zoer's legacy local-export routes.
 *   Post types are not in the bridge's read-only WP-CLI allowlist, so local sources list none.
 */
import type { WordPressDiagnostics } from "../api/types/wordpress-transfer";

type Row = Record<string, unknown>;
const rows = (text: string): Row[] => {
  try { const parsed: unknown = JSON.parse(text); return Array.isArray(parsed) ? parsed.filter((row): row is Row => !!row && typeof row === "object") : []; }
  catch { return []; }
};
const str = (value: unknown) => typeof value === "string" && value ? value : undefined;

/** The WordPress table prefix: the longest `<prefix>` with both `<prefix>options` and `<prefix>posts`. */
export function tablePrefix(tables: string[]): string | null {
  const names = new Set(tables);
  const candidates = tables.filter(name => name.endsWith("options")).map(name => name.slice(0, -"options".length)).filter(prefix => names.has(`${prefix}posts`));
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Diagnostics from `wp db tables`, `wp plugin list --format=json` and `wp theme list --format=json` output. */
export function parseLocalInventory(output: { tables: string; plugins: string; themes: string }): WordPressDiagnostics {
  const tables = output.tables.split(/\r?\n/).map(line => line.trim()).filter(line => /^[^\s,]+$/.test(line));
  const prefix = tablePrefix(tables);
  return {
    ...(prefix !== null ? { wordpress: { prefix } } : {}),
    database: { tables: tables.map(name => {
      const prefixed = prefix !== null && name.startsWith(prefix) && name.length > prefix.length;
      return { name, prefixed, suffix: prefixed ? name.slice(prefix!.length) : null };
    }) },
    // Must-use plugins and drop-ins are not in wp-content/plugins, which the plugin picker selects from.
    plugins: rows(output.plugins).filter(row => row.status !== "must-use" && row.status !== "dropin" && str(row.name))
      .map(row => ({ slug: str(row.name)!, name: str(row.title), version: str(row.version), active: row.status === "active" || row.status === "active-network" })),
    themes: rows(output.themes).filter(row => str(row.name))
      .map(row => ({ slug: str(row.name)!, name: str(row.title), version: str(row.version), active: row.status === "active" })),
  };
}

export const LOCAL_INVENTORY_COMMANDS = {
  tables: ["db", "tables", "--all-tables-with-prefix"],
  plugins: ["plugin", "list", "--format=json", "--fields=name,title,status,version"],
  themes: ["theme", "list", "--format=json", "--fields=name,title,status,version"],
} as const;
