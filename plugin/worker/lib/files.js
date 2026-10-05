// WordPress-specific manifest checks that stay in the plugin (docs/plugin-shared-services.md
// section 14: root-file names and resource categories). The host applies the declared
// `site-export` file rules (S10) on top when the file set is created. These are the legacy host
// engine's checks (`validatePullFiles`, `checkSelection`, `isUploadPlaceholder`) with the same
// messages, so a refused manifest reads the same on both engines.
import { TransferError } from "./slices.js";

export const FILE_BYTES = 4 * 1024 ** 3;
const packagedMetadataFiles = new Set([
  ".editorconfig", ".gitattributes", ".gitignore", ".gitkeep", ".npmignore",
  ".nvmrc", ".node-version", ".deployignore", ".deepsource.toml", ".wp-env.json",
  ".prettierignore", ".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.js", ".prettierrc.cjs",
  ".eslintignore", ".eslintrc", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc.js", ".eslintrc.cjs",
  ".markdownlintignore", ".markdownlint.json", ".markdownlint.yaml", ".markdownlint.yml",
  ".phpcs.xml", ".phpcs.xml.dist", ".phpcs.dir.xml", ".phpcs.dir.phpcompatibility.xml", ".phpstorm.meta.php",
]);
const fail = (message) => { throw new TransferError(message); };

function allowedPart(part, index, parts, path) {
  if (!part || part === "." || part === "..") return false;
  if (!part.startsWith(".")) return true;
  const leaf = index === parts.length - 1;
  if (leaf && part === ".htaccess" && path.startsWith("wp-content/")) return true;
  if (/^wp-content\/(plugins|themes)\//.test(path)) return leaf ? packagedMetadataFiles.has(part) : part === ".trash" || part === ".github";
  return false;
}

/** One page (or the whole) export manifest; `seen` carries lower-cased paths across pages. */
export function validatePullFiles(files, seen = new Set()) {
  if (!Array.isArray(files) || files.length > 100000) fail("Invalid export manifest.");
  const result = files.map(f => {
    if (typeof f?.path === "string" && /(?:^|\/)\.DS_Store$|(?:^|\/)__MACOSX\//.test(f.path)) {
      fail("The export includes Mac metadata files. Add **/.DS_Store and **/__MACOSX/ to Exclude files (one per line), then start a new pull.");
    }
    // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
    if (!f || typeof f.path !== "string" || f.path.length > 512 || /[\\\x00-\x1f\x7f-\x9f]/.test(f.path)) fail("The export manifest contains an invalid file path.");
    if (!/^(?:database\.sql|wp-content\/(?:themes|plugins|uploads|mu-plugins)\/.+|wp-admin\/.+|wp-includes\/.+|[a-z][a-z0-9-]*\.php|readme\.html|license\.txt)$/.test(f.path)
      || f.path.split("/").some((p, index, parts) => !allowedPart(p, index, parts, f.path)) || /(?:^|\/)wp-config\.php$/i.test(f.path) || /^wp-content\/plugins\/zoer-connect(?:\/|$)/i.test(f.path)) fail(`The export contains an unsupported file path: ${f.path}.`);
    if (seen.has(f.path.toLowerCase())) fail(`The export contains duplicate file paths: ${f.path}.`);
    if (!Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > FILE_BYTES || !/^[a-f0-9]{64}$/.test(f.sha256)) fail(`The export has an invalid size or checksum for: ${f.path}.`);
    seen.add(f.path.toLowerCase());
    if (f.digestFormat !== undefined && f.digestFormat !== "sha256-blocks-v1") fail("Unsupported export digest format.");
    return { path: f.path, bytes: f.bytes, sha256: f.sha256, ...(f.digestFormat ? { digestFormat: f.digestFormat } : {}) };
  });
  for (const path of seen) { const parts = path.split("/"); parts.pop(); while (parts.length) { if (seen.has(parts.join("/"))) fail("Export file paths overlap."); parts.pop(); } }
  return result;
}

export function categoryOf(path) {
  return path === "database.sql" ? "database" : path.startsWith("wp-content/themes/") ? "themes" : path.startsWith("wp-content/plugins/") ? "plugins"
    : path.startsWith("wp-content/uploads/") ? "media" : path.startsWith("wp-content/mu-plugins/") ? "muplugins" : "core";
}

/** Every file must belong to a selected resource (checkSelection). */
export function checkSelection(files, options) {
  for (const file of files) {
    const category = categoryOf(file.path);
    if (!(category === "database" ? options.database : options.profile[category])) fail("The export includes an unselected resource.");
  }
}

/** Source identity of an export response (parsePullSource). */
export function parsePullSource(source) {
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  const validAbspath = (value) => typeof value === "string" && value.length <= 1024 && /^(?:\/|[A-Za-z]:[\\/])/.test(value) && !/[\x00-\x1f]/.test(value) && !value.split(/[\\/]/).includes("..");
  return { url: source.url, prefix: source.prefix,
    ...(Array.isArray(source.originalUrls) && source.originalUrls.every(u => typeof u === "string" && /^https?:\/\//.test(u) && u.length < 2048) ? { originalUrls: source.originalUrls } : {}),
    ...(validAbspath(source.abspath) ? { abspath: source.abspath.replace(/[\\/]+$/, "") || "/" } : {}),
    ...(Array.isArray(source.tables) && source.tables.length <= 1000 && source.tables.every(t => typeof t === "string" && /^[A-Za-z0-9_]{1,64}$/.test(t)) ? { tables: source.tables } : {}) };
}

export function parseSkipped(current) {
  if (!Array.isArray(current.skipped)) return { skipped: [], skippedCount: 0 };
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  const skipped = current.skipped.filter(s => typeof s?.path === "string" && s.path.length <= 512 && !/[\x00-\x1f]/.test(s.path) && typeof s.reason === "string" && /^[a-z-]{1,40}$/.test(s.reason)).slice(0, 200).map(s => ({ path: s.path, reason: s.reason }));
  return { skipped, skippedCount: Number.isSafeInteger(current.skippedCount) && current.skippedCount >= skipped.length ? current.skippedCount : skipped.length };
}

export function normalizeConnectUrl(value) {
  let url; try { url = new URL(String(value).trim()); } catch { fail("Enter valid connection info from WordPress."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || /%|\\/.test(url.pathname)) fail("Use an HTTPS site address without credentials, port, query or fragment.");
  return url.href.replace(/\/+$/, "");
}

/** These exact patterns omit Finder/ZIP metadata, not WordPress resources. */
export function hasOnlyMacMetadataExclusions(excludes) { return excludes.every(pattern => ["**/.DS_Store", "**/__MACOSX/"].includes(pattern)); }

/** Only known non-executing directory placeholders may be PHP in copied uploads. */
export function isUploadPlaceholder(path, content) {
  if (!/^wp-content\/uploads\/(?:[^/]+\/)*index\.php$/.test(path) || content.length > 4096) return false;
  const value = content.replaceAll("\r\n", "\n").trim().replace(/\n[\t ]*\?>$/, "");
  if (value.includes("?>")) return false;
  if (/^<\?php\s*(?:\/\/[^\n]*(?:\n|$)\s*)*$/.test(value)) return true;
  return /^<\?php\s+header\(\s*\$_SERVER\['SERVER_PROTOCOL'\]\s*\.\s*' 404 Not Found'\s*\);\s*header\(\s*'Status: 404 Not Found'\s*\);\s*$/.test(value);
}

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
