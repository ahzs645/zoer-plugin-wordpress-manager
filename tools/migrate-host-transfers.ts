#!/usr/bin/env bun
/**
 * Moves the legacy host engine's transfer data into WordPress Manager's own storage
 * (docs/plugin-shared-services.md 16.5 P3.5) through Zoer's operator data-migration API:
 *
 *   ZOER_URL=https://zoer.example ZOER_TOKEN=… bun tools/migrate-host-transfers.ts           # dry run (default)
 *   ZOER_URL=https://zoer.example ZOER_TOKEN=… bun tools/migrate-host-transfers.ts --apply   # write
 *
 * The migration runs inside the Zoer server (it holds the legacy stores' locks) as the admin
 * action `wordpress-manager.transfers-to-plugin`: finished pulls and local exports become sealed,
 * retained file sets plus `pull` catalog records; transfer profiles become presets of the 0.7.0
 * transfer actions; history becomes `transfer-history` records; completed local copies become
 * `local-copy` and `site-link` records; deployments and recovery points become catalog records.
 * It is idempotent, keeps every legacy file in place and never changes a site's transfer engine
 * (every site stays on the legacy engine until the user switches it). It refuses until
 * WordPress Manager 0.7.0 (file sets and catalog permissions) is installed.
 */
export const MIGRATION_ID = "wordpress-manager.transfers-to-plugin";

export interface MigrationClientOptions { zoerUrl: string; token?: string; fetch?: typeof fetch }

export function createMigrationClient(options: MigrationClientOptions) {
  const request = options.fetch ?? fetch;
  const base = `${options.zoerUrl.replace(/\/+$/, "")}/api/admin/data-migrations`;
  const headers: Record<string, string> = { accept: "application/json", ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) };
  async function call(path: string, init: RequestInit = {}) {
    const response = await request(`${base}${path}`, { ...init, headers: { ...headers, ...(init.body ? { "content-type": "application/json" } : {}) } });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(`${response.status} ${body?.error ?? response.statusText}`);
    return body;
  }
  return {
    async available() { return ((await call("")).migrations ?? []).some((m: { id: string }) => m.id === MIGRATION_ID); },
    run(apply: boolean) { return call(`/${encodeURIComponent(MIGRATION_ID)}`, { method: "POST", body: JSON.stringify({ apply }) }); },
  };
}

type Row = { id?: string; profileId?: string; reason?: string };

/**
 * Zoer's migration reports a second legacy local copy of the same target as "already
 * migrated" for its `site-link:<target>` (one link per target; the newest copy is queued first
 * and wins), even when the catalog had no link. A skipped link whose target this same run
 * linked is a duplicate target: name it, and the copy that keeps the link (the `local-copy:`
 * entry queued just before that link). Every copy still gets its own `local-copy` record.
 */
export function explainLocalCopies(value: { planned?: Row[]; created?: Row[]; skipped?: Row[] }): Row[] {
  const done = Array.isArray(value.created) ? value.created : Array.isArray(value.planned) ? value.planned : [];
  const skipped = Array.isArray(value.skipped) ? value.skipped : [];
  const winners = new Map<string, string>();
  let lastCopy: string | null = null;
  for (const row of done) {
    if (row.id?.startsWith("local-copy:")) lastCopy = row.id;
    else if (row.id?.startsWith("site-link:") && lastCopy) winners.set(row.id.slice("site-link:".length), lastCopy);
  }
  const duplicates = new Map<string, number>();
  for (const row of skipped) {
    const target = row.id?.startsWith("site-link:") ? row.id.slice("site-link:".length) : null;
    if (target && row.reason === "already migrated" && winners.has(target)) duplicates.set(target, (duplicates.get(target) ?? 0) + 1);
  }
  return skipped.map(row => {
    const target = row.id?.startsWith("site-link:") ? row.id.slice("site-link:".length) : null;
    if (!target || row.reason !== "already migrated" || !winners.has(target)) return row;
    const copies = duplicates.get(target)! + 1;
    return { ...row, reason: `duplicate target: ${copies} legacy local copies point at ${target}; the newest (${winners.get(target)}) keeps the site link, the others are kept as local-copy records only` };
  });
}

/** One line per category: planned/created and skipped counts, then the skip reasons. */
export function summarize(result: { apply: boolean; report: any }) {
  const lines = [`${result.apply ? "Applied" : "Dry run of"} ${MIGRATION_ID}`];
  const report = result.report ?? {};
  if (report.blocked) lines.push(`Blocked: ${report.blocked}`);
  for (const [category, value] of Object.entries(report as Record<string, any>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const done = Array.isArray(value.created) ? value.created.length : Array.isArray(value.planned) ? value.planned.length : value.created ?? value.planned;
    const skipped = category === "localCopies" ? explainLocalCopies(value) : Array.isArray(value.skipped) ? value.skipped : [];
    lines.push(`  ${category}: ${done ?? 0} ${result.apply ? "created" : "planned"}, ${skipped.length} skipped`);
    for (const row of skipped.slice(0, 20)) lines.push(`    - ${row.id ?? row.profileId ?? "?"}: ${row.reason}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const zoerUrl = process.env.ZOER_URL;
  if (!zoerUrl) { console.error("Set ZOER_URL (and ZOER_TOKEN for an operator session)."); process.exit(2); }
  const apply = process.argv.includes("--apply");
  const client = createMigrationClient({ zoerUrl, token: process.env.ZOER_TOKEN });
  if (!(await client.available())) { console.error(`This Zoer does not offer ${MIGRATION_ID}; deploy the Zoer release with the P3 host changes first.`); process.exit(1); }
  const result = await client.run(apply);
  console.log(summarize(result));
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
}
