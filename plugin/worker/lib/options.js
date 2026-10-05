// Zoer Connect 0.4 transfer options (export selections, import options, replace-only options).
// Port of Zoer `backend/src/wordpress-transfer-options.ts` (legacy host engine) with identical
// validation, defaults and messages, so both engines send the same bodies to Zoer Connect.
import { TransferError } from "./slices.js";

const fail = (message) => { throw new TransferError(message); };
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const bool = (value, label) => typeof value === "boolean" ? value : fail(`Choose a valid ${label} option.`);
const TABLE_SUFFIX = /^[A-Za-z0-9_]{1,64}$/, POST_TYPE = /^[a-z0-9_-]{1,20}$/, SLUG = /^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function list(value, pattern, max, label) {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== "string" || !pattern.test(item))) fail(`Choose valid ${label}.`);
  return [...new Set(value)];
}

export function defaultDatabaseFilters() { return { tables: "all", postTypes: "all", excludeRevisions: false, excludeSpam: false, excludeTransients: true }; }
export function defaultExportOptions() {
  return { resources: { database: true, themes: true, plugins: true, media: true, muplugins: false, core: false }, excludes: [], database: defaultDatabaseFilters(), themes: { mode: "all", items: [] }, plugins: { mode: "all", items: [] }, media: { mode: "all" } };
}
/** Protocol defaults: the 0.3.14 behaviour an older Zoer Connect applies without options. */
export function legacyImportOptions() {
  return { replacements: { automatic: true, variants: false, paths: false, custom: [] }, replaceGuids: true, keepActivePlugins: null, keepActiveTheme: null, authorMapping: "administrator", createTables: false, fence: "early", review: false, purgeCaches: false };
}

export function validateExcludes(value) {
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  if (!Array.isArray(value) || value.length > 100 || value.some(x => typeof x !== "string" || !x || x.length > 512 || /[\\\x00-\x1f[\]]/.test(x) || x.split("/").includes(".."))) fail("Choose valid export resources and exclusions.");
  return value;
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) fail("Choose a valid media date (YYYY-MM-DD).");
  return value;
}
function mode(value, label) {
  if (!isObject(value) || !["all", "active", "selected", "except"].includes(value.mode)) fail(`Choose which ${label} to include.`);
  const items = list(value.items ?? [], SLUG, 500, `${label} slugs`);
  if (value.mode === "selected" && !items.length) fail(`Choose at least one of the ${label} to include.`);
  return { mode: value.mode, items: value.mode === "selected" || value.mode === "except" ? items : [] };
}

export function validateExportOptions(value) {
  if (!isObject(value) || !isObject(value.resources)) fail("Choose valid export resources.");
  const resources = {};
  for (const key of ["database", "themes", "plugins", "media", "muplugins", "core"]) resources[key] = bool(value.resources[key], "resource");
  if (!Object.values(resources).includes(true)) fail("Select at least one resource.");
  const db = value.database ?? defaultDatabaseFilters();
  if (!isObject(db)) fail("Choose valid database filters.");
  const database = {
    tables: db.tables === "all" || db.tables === undefined ? "all" : list(db.tables, TABLE_SUFFIX, 500, "database tables"),
    postTypes: db.postTypes === "all" || db.postTypes === undefined || db.postTypes === null ? "all" : list(db.postTypes, POST_TYPE, 100, "post types"),
    excludeRevisions: db.excludeRevisions === undefined ? false : bool(db.excludeRevisions, "revision"),
    excludeSpam: db.excludeSpam === undefined ? false : bool(db.excludeSpam, "spam comment"),
    excludeTransients: db.excludeTransients === undefined ? true : bool(db.excludeTransients, "transient"),
  };
  if (resources.database && Array.isArray(database.tables) && !database.tables.length) fail("Select at least one database table.");
  if (resources.database && Array.isArray(database.postTypes) && !database.postTypes.length) fail("Select at least one post type.");
  const media = value.media ?? { mode: "all" };
  if (!isObject(media) || !["all", "since", "since-last"].includes(media.mode)) fail("Choose which media to include.");
  return {
    resources, excludes: validateExcludes(value.excludes ?? []), database,
    themes: value.themes === undefined ? { mode: "all", items: [] } : mode(value.themes, "themes"),
    plugins: value.plugins === undefined ? { mode: "all", items: [] } : mode(value.plugins, "plugins"),
    media: media.mode === "since" ? { mode: "since", since: validDate(media.since) } : { mode: media.mode },
  };
}

export function isDefaultDatabaseFilters(f) {
  return f.tables === "all" && f.postTypes === "all" && !f.excludeRevisions && !f.excludeSpam && f.excludeTransients;
}

/** ExportOptions → the Pull body (`{profile, database}`); defaults give exactly the 0.3.14 shape. */
export function exportOptionsToPull(options, lastMediaDate) {
  const r = options.resources, f = options.database;
  const database = !r.database ? false : isDefaultDatabaseFilters(f) ? true : {
    ...(Array.isArray(f.tables) ? { tables: f.tables } : {}), postTypes: Array.isArray(f.postTypes) ? f.postTypes : null,
    excludeRevisions: f.excludeRevisions, excludeSpam: f.excludeSpam, excludeTransients: f.excludeTransients,
  };
  const mediaSince = !r.media ? undefined : options.media.mode === "since" ? options.media.since : options.media.mode === "since-last" ? lastMediaDate ?? undefined : undefined;
  const profile = {
    name: "Zoer remote pull", themes: r.themes, plugins: r.plugins, media: r.media, muplugins: r.muplugins, core: r.core, excludes: options.excludes,
    ...(r.themes && options.themes.mode !== "all" && !(options.themes.mode === "except" && !options.themes.items.length) ? { themesMode: options.themes.mode, themesItems: options.themes.items } : {}),
    ...(r.plugins && options.plugins.mode !== "all" && !(options.plugins.mode === "except" && !options.plugins.items.length) ? { pluginsMode: options.plugins.mode, pluginsItems: options.plugins.items } : {}),
    ...(mediaSince ? { mediaSince } : {}),
  };
  return { profile, database };
}

/** A3 additions on an already mapped Pull body. */
export function validatePullExtensions(profile, database) {
  const extensions = {};
  for (const kind of ["themes", "plugins"]) {
    const m = profile[kind + "Mode"]; if (m === undefined || m === "all") continue;
    if (!["active", "selected", "except"].includes(m) || profile[kind] !== true) fail(`Choose valid ${kind} selections.`);
    const items = list(profile[kind + "Items"] ?? [], SLUG, 500, `${kind} slugs`);
    if (m === "selected" && !items.length) fail(`Choose at least one of the ${kind} to include.`);
    Object.assign(extensions, { [kind + "Mode"]: m, [kind + "Items"]: m === "active" ? [] : items });
  }
  if (profile.mediaSince !== undefined && profile.mediaSince !== null) { if (profile.media !== true) fail("Media date filters require media."); extensions.mediaSince = validDate(profile.mediaSince); }
  if (typeof database === "boolean") return { extensions, database };
  if (!isObject(database)) fail("Choose valid database filters.");
  const d = database;
  const out = { ...(d.tables !== undefined ? { tables: list(d.tables, TABLE_SUFFIX, 500, "database tables") } : {}), postTypes: d.postTypes === null || d.postTypes === undefined ? null : list(d.postTypes, POST_TYPE, 100, "post types"),
    excludeRevisions: d.excludeRevisions === undefined ? false : bool(d.excludeRevisions, "revision"), excludeSpam: d.excludeSpam === undefined ? false : bool(d.excludeSpam, "spam comment"), excludeTransients: d.excludeTransients === undefined ? true : bool(d.excludeTransients, "transient") };
  if ((out.tables && !out.tables.length) || (out.postTypes && !out.postTypes.length)) fail("Select at least one database table and post type.");
  return { extensions, database: out };
}

/** Pull options from ExportOptions (validatePullOptions in the host engine). */
export function pullOptionsFrom(exportOptions, lastMediaDate = null) {
  const value = exportOptionsToPull(validateExportOptions(exportOptions ?? defaultExportOptions()), lastMediaDate);
  const profile = { name: "Zoer remote pull", excludes: validateExcludes(value.profile.excludes) };
  for (const key of ["themes", "plugins", "media", "muplugins", "core"]) { if (typeof value.profile[key] !== "boolean") fail("Choose valid export resources."); profile[key] = value.profile[key]; }
  const { extensions, database } = validatePullExtensions({ ...value.profile, ...profile }, value.database);
  if (!database && !Object.values(profile).includes(true)) fail("Select at least one resource.");
  return { profile: { ...profile, ...extensions }, database };
}

/** Remote sources must advertise A3 capabilities before receiving any addition. */
export function assertExportCapabilities(pull, caps, where = "the source") {
  const missing = [];
  if (typeof pull.database === "object" && !caps?.databaseFilters) missing.push("database filters");
  if ((pull.profile.themesMode || pull.profile.pluginsMode) && !caps?.resourceModes) missing.push("theme and plugin selection");
  if (pull.profile.mediaSince && !caps?.mediaSince) missing.push("media date filter");
  if (missing.length) fail(`Update Zoer Connect on ${where} to 0.4.0 to use ${missing.join(", ")}, or choose the default selection.`);
}

function row(value) {
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  if (!isObject(value) || typeof value.find !== "string" || !value.find || value.find.length > 4096 || typeof value.replace !== "string" || value.replace.length > 4096 || /\x00/.test(value.find + value.replace)) fail("Each find & replace row needs text to find; values are limited to 4,096 characters.");
  const regex = value.regex === undefined ? false : bool(value.regex, "regex"), caseSensitive = value.caseSensitive === undefined ? true : bool(value.caseSensitive, "case");
  if (regex && Buffer.byteLength(value.find, "utf8") > 500) fail("Regular expressions are limited to 500 characters.");
  if (regex) { const m = /^([^A-Za-z0-9\\\s])([\s\S]+)([^A-Za-z0-9\\\s])([a-zA-Z]*)$/.exec(value.find); if (!m || /e/.test(m[4]) || new Set(m[4]).size !== m[4].length) fail("Write regular expressions with delimiters, for example /old-(\\d+)/i."); }
  return { find: value.find, replace: value.replace, regex, caseSensitive };
}

export function validateImportOptions(value, { requireCustom = false } = {}) {
  if (!isObject(value) || !isObject(value.replacements)) fail("Choose valid import options.");
  const r = value.replacements;
  if (!Array.isArray(r.custom ?? []) || (r.custom ?? []).length > 50) fail("Use at most 50 find & replace rows.");
  const triState = (x, label) => x === null || x === undefined ? null : bool(x, label);
  const options = {
    replacements: { automatic: r.automatic === undefined ? true : bool(r.automatic, "automatic replacement"), variants: bool(r.variants ?? false, "URL variant"), paths: bool(r.paths ?? false, "path replacement"), custom: (r.custom ?? []).map(row) },
    replaceGuids: value.replaceGuids === undefined ? true : bool(value.replaceGuids, "GUID"), keepActivePlugins: triState(value.keepActivePlugins, "active plugin"), keepActiveTheme: triState(value.keepActiveTheme, "active theme"),
    authorMapping: value.authorMapping === undefined ? "administrator" : ["administrator", "match"].includes(value.authorMapping) ? value.authorMapping : fail("Choose a valid author mapping."),
    createTables: bool(value.createTables ?? false, "table creation"), fence: value.fence === undefined ? "early" : ["early", "activation"].includes(value.fence) ? value.fence : fail("Choose when the site is paused."),
    review: bool(value.review ?? false, "review"), purgeCaches: bool(value.purgeCaches ?? false, "cache purge"),
  };
  if (options.review && options.fence !== "activation") fail("Review before applying requires keeping the site online while staging.");
  if (requireCustom && !options.replacements.custom.length) fail("Add at least one find & replace row.");
  return options;
}

const replacements = (out) => (out.replacements ??= {});
const importGates = [
  { label: "URL variants", capability: "replacementVariants", active: o => o.replacements.variants, apply: (out, o) => { replacements(out).variants = o.replacements.variants; } },
  { label: "path replacement", capability: "replacementRules", active: o => o.replacements.paths, apply: (out, o) => { replacements(out).paths = o.replacements.paths; } },
  { label: "custom find & replace", capability: "replacementRules", active: o => o.replacements.custom.length > 0 || !o.replacements.automatic, apply: (out, o) => { replacements(out).automatic = o.replacements.automatic; replacements(out).custom = o.replacements.custom; } },
  { label: "keeping GUIDs", capability: "replacementRules", active: o => !o.replaceGuids, apply: (out, o) => { out.replaceGuids = o.replaceGuids; } },
  { label: "active plugin and theme choice", capability: "keepActivePlugins", active: o => o.keepActivePlugins !== null || o.keepActiveTheme !== null, apply: (out, o) => { out.keepActivePlugins = o.keepActivePlugins; out.keepActiveTheme = o.keepActiveTheme; } },
  { label: "author mapping", capability: "authorMapping", active: o => o.authorMapping === "match", apply: (out, o) => { out.authorMapping = o.authorMapping; } },
  { label: "creating missing tables", capability: "createTables", active: o => o.createTables, apply: (out, o) => { out.createTables = o.createTables; } },
  { label: "keeping the site online while staging", capability: "lateFence", active: o => o.fence === "activation", apply: (out, o) => { out.fence = o.fence; } },
  { label: "review before applying", capability: "reviewPause", active: o => o.review, apply: (out, o) => { out.review = o.review; } },
  { label: "cache purge", capability: "cachePurge", active: o => o.purgeCaches, apply: (out, o) => { out.purgeCaches = o.purgeCaches; } },
];

/** Plugin A4 `options`: only advertised capabilities are sent; a chosen non-default without its capability is refused. */
export function importOptionsToPlugin(options, caps, extra = {}) {
  const out = {}; const missing = new Set();
  for (const gate of importGates) { if (caps?.[gate.capability]) gate.apply(out, options); else if (gate.active(options)) missing.add(gate.label); }
  if (extra.partialDatabase) { if (caps?.databaseFilters || caps?.createTables) out.partialDatabase = true; else missing.add("partial database imports"); }
  if (missing.size) fail(`Update Zoer Connect on the destination to 0.4.0 to use ${[...missing].join(", ")}, or turn ${missing.size > 1 ? "those options" : "that option"} off.`);
  return Object.keys(out).length ? out : undefined;
}

/** Replace-only (A6 kind:'replace') options. */
export function replaceOptionsToPlugin(options, caps, tables) {
  if (!caps?.siteReplace) fail("Update Zoer Connect on this site to 0.4.0 to run find & replace.");
  if (options.purgeCaches && !caps.cachePurge) fail("Update Zoer Connect on this site to purge caches, or turn cache purge off.");
  return { replacements: { custom: options.replacements.custom }, ...(tables ? { tables } : {}), review: true, fence: "activation", replaceGuids: options.replaceGuids, ...(caps.cachePurge ? { purgeCaches: options.purgeCaches } : {}) };
}

export function validateTableSuffixes(value) {
  if (value === undefined || value === null || value === "all") return undefined;
  const tables = list(value, TABLE_SUFFIX, 500, "database tables");
  if (!tables.length) fail("Select at least one database table.");
  if (tables.some(table => table === "users" || table === "usermeta")) fail("Find & replace cannot change the users or user meta tables. Deselect them.");
  return tables;
}

/** Capability flags of a `/status` answer, bounded like the host engine. */
export function capabilityFlags(status) {
  return Object.fromEntries(Object.entries(status?.capabilities && typeof status.capabilities === "object" ? status.capabilities : {}).filter(([k, v]) => /^[A-Za-z]{1,40}$/.test(k) && typeof v === "boolean").slice(0, 64));
}
