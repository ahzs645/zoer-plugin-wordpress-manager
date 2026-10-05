// The plugin catalog (`workspace:catalog`): small records the transfer engine keeps beside its
// file sets. Record kinds (all `data.v` 1):
//   site-engine      site-engine:<siteId>        { siteId, engine: "legacy"|"plugin", testTarget, label?, confirmedAt?, updatedAt }  (written by the UI)
//   pull             pull:<pullId>               finished pull / local export: set, options, source, skipped
//   preview          preview:<previewId>         push comparison summary; pages in preview-page:<previewId>:<n>
//   local-copy       local-copy:<copyId>         local copy / backup restore destination
//   site-link        site-link:<targetSiteId>    local copy → source site (sidebar grouping)
//   transfer-history history:<kind>:<id>         one finished or failed transfer
// Writes need a local-write action (catalog commits); external-write actions only read.
import { TransferError } from "./slices.js";

export async function readRecords(host, ids) {
  if (!ids.length) return [];
  const result = await host.call("catalog.read", { ids });
  return Array.isArray(result?.records) ? result.records : [];
}
export async function readRecord(host, id) { return (await readRecords(host, [id]))[0] ?? null; }

/** Every record of one kind (paged by id). */
export async function listKind(host, kind, limit = 2000) {
  const out = [];
  let after = "";
  for (;;) {
    const page = await host.call("catalog.read", { kind, after, limit: 200 });
    out.push(...(page?.records ?? []));
    if (!page?.next || out.length >= limit) return out;
    after = page.next;
  }
}

/** Commits records (and deletes) with the current revision, retrying a concurrent change a few times. */
export async function commitRecords(host, records, deletes = []) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { revision } = await host.call("catalog.read", { ids: [] });
    const result = await host.call("catalog.commit", { revision, records, ...(deletes.length ? { deletes } : {}) });
    if (!result?.conflict) return result;
  }
  throw new TransferError("The WordPress Manager catalog kept changing. Retrying shortly.", { transient: true });
}

const ENGINE_MESSAGE = "This site uses the legacy transfer engine. In WordPress Manager, mark it as a non-production test target and switch it to the plugin engine first.";

/**
 * The P3 gate (docs/plugin-shared-services.md 16.5 P3.4): plugin-engine transfers run only on
 * sites the user switched to the plugin engine and confirmed as non-production test targets.
 * Every site is on the legacy engine until then.
 */
export async function assertPluginEngine(host, siteId) {
  const record = await readRecord(host, `site-engine:${siteId}`);
  const data = record?.kind === "site-engine" ? record.data : null;
  if (!data || data.siteId !== siteId || data.engine !== "plugin" || data.testTarget !== true) throw new TransferError(ENGINE_MESSAGE, { code: "engine_legacy" });
  return data;
}

export function historyRecord(entry) {
  return { id: `history:${entry.kind}:${entry.id}`, kind: "transfer-history", title: String(entry.summary).slice(0, 200), data: { v: 1, engine: "plugin", ...entry } };
}

const RESOURCE_WORDS = [["themes", "themes"], ["plugins", "plugins"], ["media", "media"], ["muplugins", "must-use plugins"], ["core", "core"]];
/** The host engine's history summary of a pull's selections ("Database, themes, plugins, media"). */
export function selectionWords(options) {
  const words = [options?.database ? "database" : null, ...RESOURCE_WORDS.map(([key, word]) => options?.profile?.[key] ? word : null)].filter(Boolean).join(", ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Selected resources";
}

/**
 * The history record of a failed run, like the host engine lists a job with `lastError`
 * (status "failed", the error's message, plus its code). The engine gate's refusal is not a
 * transfer and leaves no record.
 */
export async function recordFailedTransfer(host, entry, error, now) {
  if (error?.code === "engine_legacy" || !entry.id || !entry.siteId) return;
  const message = String(error?.message || "The transfer failed.").replace(/\s+/g, " ").trim().slice(0, 500);
  const code = typeof error?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code) ? error.code : "transfer_failed";
  await commitRecords(host, [historyRecord({ ...entry, status: "failed", finishedAt: new Date(now()).toISOString(), lastError: message, errorCode: code })]);
}
