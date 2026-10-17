/**
 * Portable site stack file (`zoer-wordpress.json`): a site's plugins and themes by where they come
 * from, not by Zoer IDs, so the same stack can be applied to another local site, kept in a
 * repository or shared as a link. Source shapes follow WordPress Playground blueprint resources
 * (`wordpress.org/plugins`, `url`, `git:directory`), so a blueprint export stays mechanical. What
 * an apply resolved (commit, version, digest) is kept separately as a `stack:<siteId>` record.
 */

export const STACK_FILE = "zoer-wordpress.json";
export const STACK_SCHEMA_VERSION = 1;
export const STACK_MAX_ENTRIES = 200;

export type StackKind = "plugin" | "theme";
export type WordPressOrgSource = { resource: "wordpress.org/plugins" | "wordpress.org/themes"; slug: string; version?: string };
export type UrlSource = { resource: "url"; url: string; sha256: string };
export type GitSource = { resource: "git:directory"; url: string; ref?: string; refType?: "branch" | "tag" | "commit"; path?: string };
export type StackSource = WordPressOrgSource | UrlSource | GitSource;
export interface StackEntry { slug: string; source: StackSource; activate?: boolean; requires?: string[] }
export interface StackFile { schemaVersion: 1; name?: string; wordpress?: { version?: string; php?: string }; plugins: StackEntry[]; themes: StackEntry[] }

const SLUG = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9._\/+-]{1,200}$/;
const PATH = /^[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*(\/[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*)*$/;

/** `https://host/owner/repo` (credential-free, no `.git`, query or fragment); SSH remotes become HTTPS. */
export function normalizeGitUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const scp = value.match(/^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(?!\/)(.+)$/);
  let url: URL;
  try { url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
  return /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)+$/.test(path) ? `https://${url.hostname.toLowerCase()}${path}` : null;
}
export const gitKey = (value: unknown) => normalizeGitUrl(value)?.toLowerCase() ?? null;

function httpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} needs a url.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label}: the url is invalid.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(`${label}: use an HTTPS link without credentials, query or fragment.`);
  return url.toString();
}

function source(value: any, kind: StackKind, label: string): StackSource {
  if (!value || typeof value !== "object") throw new Error(`${label} needs a source.`);
  if (value.resource === "wordpress.org/plugins" || value.resource === "wordpress.org/themes") {
    if (value.resource !== `wordpress.org/${kind}s`) throw new Error(`${label}: a ${kind} cannot come from ${value.resource}.`);
    if (typeof value.slug !== "string" || !SLUG.test(value.slug)) throw new Error(`${label}: invalid wordpress.org slug.`);
    if (value.version !== undefined && (typeof value.version !== "string" || !VERSION.test(value.version))) throw new Error(`${label}: invalid version.`);
    return { resource: value.resource, slug: value.slug, ...(value.version ? { version: value.version } : {}) };
  }
  if (value.resource === "url") {
    if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) throw new Error(`${label}: a ZIP link needs its sha256.`);
    return { resource: "url", url: httpsUrl(value.url, label), sha256: value.sha256 };
  }
  if (value.resource === "git:directory") {
    const url = normalizeGitUrl(value.url);
    if (!url) throw new Error(`${label}: use an HTTPS Git URL without credentials.`);
    if (value.ref !== undefined && (typeof value.ref !== "string" || !REF.test(value.ref))) throw new Error(`${label}: invalid ref.`);
    if (value.refType !== undefined && !["branch", "tag", "commit"].includes(value.refType)) throw new Error(`${label}: refType is branch, tag or commit.`);
    if (value.path !== undefined && value.path !== "." && (typeof value.path !== "string" || !PATH.test(value.path) || value.path.split("/").some((part: string) => part === "." || part === ".." || part === ".git"))) throw new Error(`${label}: path must be a folder inside the repository.`);
    return { resource: "git:directory", url, ...(value.ref ? { ref: value.ref } : {}), ...(value.refType ? { refType: value.refType } : {}), ...(value.path && value.path !== "." ? { path: value.path } : {}) };
  }
  throw new Error(`${label}: unsupported source ${JSON.stringify(value.resource ?? null)}.`);
}

function entries(value: unknown, kind: StackKind): StackEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${kind}s must be a list.`);
  const seen = new Set<string>();
  return value.map((item: any, index) => {
    const label = `${kind} ${typeof item?.slug === "string" ? item.slug : index + 1}`;
    if (!item || typeof item !== "object" || typeof item.slug !== "string" || !SLUG.test(item.slug)) throw new Error(`${label}: slug must be the installed folder name.`);
    if (item.slug === "zoer-connect") throw new Error("Zoer Connect is managed by Zoer and is not part of a stack file.");
    if (seen.has(item.slug)) throw new Error(`${label} is listed twice.`);
    seen.add(item.slug);
    const parsed = source(item.source, kind, label);
    if (parsed.resource.startsWith("wordpress.org/") && (parsed as WordPressOrgSource).slug !== item.slug) throw new Error(`${label}: the wordpress.org slug and folder differ.`);
    if (item.requires !== undefined && (!Array.isArray(item.requires) || item.requires.some((slug: unknown) => typeof slug !== "string" || !SLUG.test(slug)))) throw new Error(`${label}: requires lists plugin slugs.`);
    return { slug: item.slug, source: parsed, ...(item.activate === true ? { activate: true } : {}), ...(item.requires?.length ? { requires: [...item.requires] } : {}) };
  });
}

/** Parses and validates a stack file. Unknown top-level keys are ignored; entries are strict. */
export function parseStackFile(input: unknown): StackFile {
  let value: any = input;
  if (typeof input === "string") {
    if (input.length > 256 * 1024) throw new Error("Stack files are limited to 256 KiB.");
    try { value = JSON.parse(input); } catch { throw new Error("This is not valid JSON."); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A stack file is a JSON object.");
  if (value.schemaVersion !== STACK_SCHEMA_VERSION) throw new Error(`Unsupported schemaVersion ${JSON.stringify(value.schemaVersion ?? null)}; this version reads 1.`);
  const plugins = entries(value.plugins, "plugin"), themes = entries(value.themes, "theme");
  if (plugins.length + themes.length > STACK_MAX_ENTRIES) throw new Error(`Stack files list up to ${STACK_MAX_ENTRIES} plugins and themes.`);
  if (themes.filter(theme => theme.activate).length > 1) throw new Error("Only one theme can be activated.");
  const known = new Set(plugins.map(plugin => plugin.slug));
  for (const entry of [...plugins, ...themes]) for (const slug of entry.requires ?? []) if (!known.has(slug)) throw new Error(`${entry.slug} requires ${slug}, which is not in the stack file.`);
  const wordpress = value.wordpress && typeof value.wordpress === "object" ? {
    ...(typeof value.wordpress.version === "string" && VERSION.test(value.wordpress.version) ? { version: value.wordpress.version } : {}),
    ...(typeof value.wordpress.php === "string" && VERSION.test(value.wordpress.php) ? { php: value.wordpress.php } : {}),
  } : undefined;
  return { schemaVersion: 1, ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim().slice(0, 120) } : {}), ...(wordpress && Object.keys(wordpress).length ? { wordpress } : {}), plugins, themes };
}

export const stackText = (stack: StackFile) => `${JSON.stringify(stack, null, 2)}\n`;

// ---------------------------------------------------------------------------
// Export from a site

export interface InstalledExtension { slug: string; name?: string; version?: string; active?: boolean }
export interface RepositoryLinkInfo { repoId: string; name: string; slug: string; folder: string; kind: StackKind; gitUrl: string | null; ref?: { ref: string; refType: "branch" | "tag" | "commit" } | null }
export interface StackExport { stack: StackFile; notes: { slug: string; kind: StackKind; note: string }[] }

/**
 * Builds a stack file from a site's plugins and themes. Extensions developed from a repository with
 * a Git remote become `git:directory`; everything else is assumed to come from wordpress.org at its
 * installed version (the caller verifies those and lets the person correct the rest).
 */
export function exportStack(input: { name: string; plugins: InstalledExtension[]; themes: InstalledExtension[]; links: RepositoryLinkInfo[]; wordpress?: { version?: string; php?: string } }): StackExport {
  const notes: StackExport["notes"] = [];
  const build = (list: InstalledExtension[], kind: StackKind): StackEntry[] => list
    // Zoer Connect is managed by Zoer; Hello Dolly (`hello.php`) ships with WordPress itself, and wordpress.org names it `hello-dolly`.
    .filter(item => SLUG.test(item.slug) && item.slug !== "zoer-connect" && !(kind === "plugin" && item.slug === "hello" && (!item.name || /hello dolly/i.test(item.name))))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map(item => {
      const link = input.links.find(entry => entry.kind === kind && entry.slug === item.slug);
      const activate = item.active ? { activate: true as const } : {};
      if (link?.gitUrl) {
        const ref = link.ref ? { ref: link.ref.ref, refType: link.ref.refType } : {};
        return { slug: item.slug, source: { resource: "git:directory" as const, url: link.gitUrl, ...ref, ...(link.folder !== "." ? { path: link.folder } : {}) }, ...activate };
      }
      if (link) notes.push({ slug: item.slug, kind, note: `Developed from ${link.name}, which has no Git remote. Add a remote in Repos so other sites can find it; listed as wordpress.org for now.` });
      const version = item.version && VERSION.test(item.version) ? { version: item.version } : {};
      return { slug: item.slug, source: { resource: `wordpress.org/${kind}s` as const, slug: item.slug, ...version }, ...activate };
    });
  const themes = build(input.themes, "theme");
  // Only the active theme is activated (a child theme's parent is installed, not activated).
  return { stack: { schemaVersion: 1, name: input.name.slice(0, 120), ...(input.wordpress && Object.keys(input.wordpress).length ? { wordpress: input.wordpress } : {}), plugins: build(input.plugins, "plugin"), themes }, notes };
}

// ---------------------------------------------------------------------------
// Apply: compare with a site and resolve repositories

export interface RepositoryInfo { id: string; name: string; gitUrl?: string | null }
export type EntryState = "installed" | "different-version" | "inactive" | "missing";
export interface PlannedEntry {
  kind: StackKind; entry: StackEntry; state: EntryState; installedVersion?: string;
  /** git sources: the matching Repos repository, or null when it must be cloned first. */
  repository?: RepositoryInfo | null;
}

export function compareStack(stack: StackFile, site: { plugins: InstalledExtension[]; themes: InstalledExtension[] }, repositories: RepositoryInfo[]): PlannedEntry[] {
  const plan = (list: StackEntry[], installed: InstalledExtension[], kind: StackKind) => list.map((entry): PlannedEntry => {
    const current = installed.find(item => item.slug === entry.slug);
    const wanted = entry.source.resource.startsWith("wordpress.org/") ? (entry.source as WordPressOrgSource).version : undefined;
    const state: EntryState = !current ? "missing" : wanted && current.version !== wanted ? "different-version" : entry.activate && !current.active ? "inactive" : "installed";
    const repository = entry.source.resource === "git:directory" ? repositories.find(repo => gitKey(repo.gitUrl) === gitKey((entry.source as GitSource).url)) ?? null : undefined;
    return { kind, entry, state, ...(current?.version ? { installedVersion: current.version } : {}), ...(repository !== undefined ? { repository } : {}) };
  });
  // Required plugins first, then the rest, then themes (the activated theme last).
  const plugins = plan(stack.plugins, site.plugins, "plugin");
  const required = new Set([...stack.plugins, ...stack.themes].flatMap(entry => entry.requires ?? []));
  return [...plugins.filter(item => required.has(item.entry.slug)), ...plugins.filter(item => !required.has(item.entry.slug)), ...plan(stack.themes, site.themes, "theme").sort((a, b) => Number(!!a.entry.activate) - Number(!!b.entry.activate))];
}

/** `#/repos?clone=…&ref=…`: Zoer's Repos clone form, prefilled; the person still confirms it there. */
export function cloneLink(source: GitSource) {
  const params = new URLSearchParams({ clone: source.url });
  if (source.ref && source.refType !== "commit") params.set("ref", source.ref);
  return `/#/repos?${params.toString()}`;
}

/**
 * A GitHub link to a stack file (blob, raw or repository page): the repository URL, ref and path.
 * `https://github.com/o/r` → the repository root file; `…/blob/<ref>/<path>` and
 * `raw.githubusercontent.com/o/r/<ref>/<path>` name both. Refs with slashes are not supported.
 */
export function parseStackLink(value: string): { repository: string; ref: string | null; path: string } | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const file = (rest: string[]) => rest.length ? rest.join("/") : STACK_FILE;
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 4) return { repository: `https://github.com/${parts[0]}/${parts[1]}`, ref: parts[2]!, path: file(parts.slice(3)) };
  if (url.hostname === "github.com" && parts.length >= 2) {
    const repository = normalizeGitUrl(`https://github.com/${parts[0]}/${parts[1]}`);
    if (!repository) return null;
    if ((parts[2] === "blob" || parts[2] === "tree" || parts[2] === "raw") && parts.length >= 4) return { repository, ref: parts[3]!, path: parts[2] === "tree" ? [...parts.slice(4), STACK_FILE].join("/") : file(parts.slice(4)) };
    return parts.length === 2 ? { repository, ref: null, path: STACK_FILE } : null;
  }
  const generic = normalizeGitUrl(value.trim());
  return generic ? { repository: generic, ref: null, path: STACK_FILE } : null;
}

// ---------------------------------------------------------------------------
// WordPress Playground blueprint (v1) export

const wporgZip = (kind: StackKind, slug: string, version?: string) => `https://downloads.wordpress.org/${kind}/${slug}${version ? `.${version}` : ".latest-stable"}.zip`;

/** A Playground blueprint that installs the same stack. Pinned wordpress.org versions become ZIP links; ZIP digests are not checked by Playground. */
export function playgroundBlueprint(stack: StackFile) {
  const resource = (kind: StackKind, entry: StackEntry) => {
    const source = entry.source;
    if (source.resource === "url") return { resource: "url", url: source.url };
    if (source.resource === "git:directory") return { resource: "git:directory", url: source.url, ref: source.ref ?? "HEAD", ...(source.refType ? { refType: source.refType } : {}), ...(source.path ? { path: source.path } : {}) };
    return source.version ? { resource: "url", url: wporgZip(kind, source.slug, source.version) } : { resource: source.resource, slug: source.slug };
  };
  return {
    $schema: "https://playground.wordpress.net/blueprint-schema.json",
    landingPage: "/wp-admin/",
    ...(stack.wordpress ? { preferredVersions: { php: stack.wordpress.php ?? "latest", wp: stack.wordpress.version ?? "latest" } } : {}),
    steps: [
      { step: "login" },
      ...stack.plugins.map(entry => ({ step: "installPlugin", pluginData: resource("plugin", entry), options: { activate: !!entry.activate, targetFolderName: entry.slug } })),
      ...stack.themes.map(entry => ({ step: "installTheme", themeData: resource("theme", entry), options: { activate: !!entry.activate, targetFolderName: entry.slug } })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Lock record (what an apply resolved)

export const STACK_RECORD_KIND = "stack";
export interface StackLockEntry { kind: StackKind; slug: string; source: StackSource; result: "installed" | "already-installed" | "skipped" | "failed"; version?: string; commit?: string | null; digest?: string; sha256?: string; error?: string }
export interface StackLock { siteId: string; name?: string; appliedAt: string; origin: string; entries: StackLockEntry[] }
export const stackRecordId = (siteId: string) => `stack:${siteId}`;
