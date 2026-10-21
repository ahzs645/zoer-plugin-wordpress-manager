// Shared by the native workspace and isolated transfer worker. No site-specific rules.
export const CODE_EXCLUDES = ["**/.DS_Store", "**/__MACOSX/", "**/.git/", "**/.ddev/", "**/.zoer/", "**/.env*", "**/node_modules/", "**/__pycache__/", "**/*.sql", "**/*.sql.gz"];

/** Start with explicit extension choices; never infer that every installed plugin is publishable. */
export function codeExportOptions(options) {
  // Disabled resources still pass through shared export validation. Give them a neutral
  // selection; their false resource flag keeps them out of the actual export profile.
  const selected = (value, enabled) => enabled
    ? { mode: "selected", items: value?.mode === "selected" ? [...value.items] : [] }
    : { mode: "all", items: [] };
  return { ...options, resources: { database: false, themes: options.resources.themes, plugins: options.resources.plugins, media: false, muplugins: false, core: false },
    themes: selected(options.themes, options.resources.themes), plugins: selected(options.plugins, options.resources.plugins), excludes: [...new Set([...options.excludes, ...CODE_EXCLUDES])] };
}

/** A code publication requires a source exported without data or environment resources. */
export function codeExportIssue(options) {
  const p = options?.profile;
  if (!p || options.database !== false || p.media !== false || p.muplugins !== false || p.core !== false) return "Prepare a code-only export with database, media, core and must-use plugins excluded.";
  if (!p.themes && !p.plugins) return "Choose at least one theme or plugin to publish.";
  for (const kind of ["themes", "plugins"]) {
    if (p[kind] && (p[kind + "Mode"] !== "selected" || !Array.isArray(p[kind + "Items"]) || !p[kind + "Items"].length)) return "Choose specific themes and plugins, then prepare a new code export.";
  }
  return null;
}

/** Path exclusions are enforced again at the worker boundary, including after resume. */
export function codePathReason(path, profile) {
  if (typeof path !== "string") return "Invalid code path";
  const match = /^wp-content\/(themes|plugins)\/([A-Za-z0-9][A-Za-z0-9._-]{0,199})\/(.+)$/.exec(path);
  if (!match) return "Database, media and environment files stay on the destination";
  const parts = path.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || p.startsWith(".") || /[\\\x00-\x1f\x7f]/.test(p))) return "Hidden or unsafe development file";
  if (parts.some(p => /^(?:node_modules|__pycache__|__MACOSX)$/i.test(p))) return "Development dependencies or metadata";
  if (/(?:^|\/)(?:wp-config\.php|.*\.(?:sql(?:\.gz)?|sqlite(?:3)?|db|bak|log|zip|tar(?:\.gz)?|tgz|7z))$/i.test(path)) return "Configuration, database, backup or archive file";
  if (profile && (!profile[match[1]] || profile[match[1] + "Mode"] !== "selected" || !profile[match[1] + "Items"]?.includes(match[2]))) return "Outside the selected themes and plugins";
  return null;
}

/**
 * Report the kind of problem, never the matching credential or source content. Pushes copy files
 * byte for byte (only the database gets URL replacement), so every push checks source addresses;
 * `credentials: false` skips the credential check outside code updates.
 */
export function codeContentIssue(text, source, target, { credentials = true } = {}) {
  if (credentials && /\b(?:sk_(?:test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(text)) return "A credential literal was found; keep credentials in destination settings";
  let targetHost;
  try { targetHost = new URL(target).hostname.toLowerCase(); } catch { return "The destination address is invalid"; }
  for (const value of [source?.url, ...(source?.originalUrls ?? [])]) {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      if (hostname && hostname !== targetHost && text.toLowerCase().includes(hostname)) return "A source-site hostname is embedded in this file; make the URL portable before exporting";
    } catch { /* Source metadata is optional; it never grants another destination. */ }
  }
  if (typeof source?.abspath === "string" && source.abspath.length > 3 && text.includes(source.abspath)) return "A source filesystem path is embedded in this file; make the path portable before exporting";
  return null;
}
