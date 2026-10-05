#!/usr/bin/env bun
/**
 * Destination snapshot and baseline compare (read-only: `site.test { diagnostics: true }`, the same
 * Zoer Connect `/diagnostics` read the transfer panels use; endpoint ID = site ID).
 *
 *   bun tools/live-gate/snap.ts save <siteId> <label>                 snapshot → .baseline/<siteId>/<label>.json
 *   bun tools/live-gate/snap.ts compare <siteId> <baseline> [<label>] compare a saved label (or a fresh snapshot)
 *   bun tools/live-gate/snap.ts list <siteId>                         saved labels
 *
 * `compare` exits 1 on a difference. `--ignore options,usermeta` leaves out row counts of tables
 * that change on their own (transients, sessions). Snapshots are kept in the gitignored
 * `tools/live-gate/.baseline/`.
 */
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assertNotForbidden } from "./guard";
import { start, waitRun } from "./zoer";

export const BASELINE_DIR = resolve(import.meta.dir, ".baseline");

export type Snapshot = {
  at: string; siteId: string; version?: string; home?: string; siteurl?: string; prefix?: string;
  tables: Record<string, number | null>; plugins: string[]; muPlugins: string[]; themes: string[]; postTypes: Record<string, number | null>;
};

export function snapshotFrom(siteId: string, d: any, at = new Date().toISOString()): Snapshot {
  return {
    at, siteId, version: d?.wordpress?.version, home: d?.wordpress?.home, siteurl: d?.wordpress?.siteurl, prefix: d?.wordpress?.prefix,
    tables: Object.fromEntries((d?.database?.tables ?? []).map((t: any) => [t.suffix ?? t.name, typeof t.rows === "number" ? t.rows : null])),
    plugins: (d?.plugins ?? []).map((p: any) => `${p.slug}:${p.active ? "active" : "inactive"}:${p.version ?? ""}`).sort(),
    muPlugins: (d?.muPlugins ?? []).map((p: any) => p.file).sort(),
    themes: (d?.themes ?? []).map((t: any) => `${t.slug}:${t.active ? "active" : "inactive"}:${t.version ?? ""}`).sort(),
    postTypes: Object.fromEntries((d?.postTypes ?? []).map((p: any) => [p.name, typeof p.count === "number" ? p.count : null])),
  };
}

export async function takeSnapshot(siteId: string): Promise<Snapshot> {
  assertNotForbidden(siteId);
  const started = await start("site.test", { endpointId: siteId, diagnostics: true });
  if (!started.runId) throw new Error(`site.test did not start: ${JSON.stringify(started).slice(0, 400)}`);
  const run = await waitRun(started.runId, { quiet: true, timeoutMs: 120_000, intervalMs: 1000 });
  if (run.status !== "succeeded" || !run.output?.ok) throw new Error(`Diagnostics failed: ${run.output?.summary ?? run.error ?? run.status}`);
  return snapshotFrom(siteId, run.output.diagnostics);
}

/** Differences between two snapshots, as readable lines. */
export function compareSnapshots(a: Snapshot, b: Snapshot, ignoreTables: string[] = []): string[] {
  const diffs: string[] = [];
  for (const key of ["home", "siteurl", "prefix", "version"] as const) if (a[key] !== b[key]) diffs.push(`${key}: ${a[key]} → ${b[key]}`);
  for (const key of ["plugins", "muPlugins", "themes"] as const) {
    const removed = a[key].filter(x => !b[key].includes(x));
    const added = b[key].filter(x => !a[key].includes(x));
    if (removed.length || added.length) diffs.push(`${key}: -[${removed.join(", ")}] +[${added.join(", ")}]`);
  }
  for (const key of ["tables", "postTypes"] as const) {
    for (const name of [...new Set([...Object.keys(a[key]), ...Object.keys(b[key])])].sort()) {
      if (key === "tables" && ignoreTables.includes(name)) continue;
      if (a[key][name] !== b[key][name]) diffs.push(`${key}.${name}: ${a[key][name] ?? "(missing)"} → ${b[key][name] ?? "(missing)"}`);
    }
  }
  return diffs;
}

const file = (siteId: string, label: string) => resolve(BASELINE_DIR, siteId, `${label.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

async function load(siteId: string, label: string): Promise<Snapshot> {
  const f = Bun.file(file(siteId, label));
  if (!(await f.exists())) throw new Error(`No snapshot ${label} for ${siteId} (${file(siteId, label)}).`);
  return f.json();
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const ignoreAt = argv.indexOf("--ignore");
  const ignore = ignoreAt >= 0 ? (argv.splice(ignoreAt, 2)[1] ?? "").split(",").filter(Boolean) : [];
  const [cmd, siteId, a, b] = argv;
  if (!cmd || !siteId) { console.log("Usage: snap.ts save <siteId> <label> | compare <siteId> <baseline> [<label>] [--ignore t1,t2] | list <siteId>"); process.exit(2); }
  if (cmd === "save") {
    if (!a) throw new Error("Missing label.");
    const snap = await takeSnapshot(siteId);
    await mkdir(resolve(BASELINE_DIR, siteId), { recursive: true });
    await Bun.write(file(siteId, a), JSON.stringify(snap, null, 1));
    console.log(JSON.stringify(snap));
    console.error(`saved ${file(siteId, a)}`);
  } else if (cmd === "compare") {
    if (!a) throw new Error("Missing baseline label.");
    const base = await load(siteId, a);
    const other = b ? await load(siteId, b) : await takeSnapshot(siteId);
    const diffs = compareSnapshots(base, other, ignore);
    console.log(diffs.length ? diffs.join("\n") : `same as ${a}${ignore.length ? ` (ignoring ${ignore.join(", ")})` : ""}`);
    process.exit(diffs.length ? 1 : 0);
  } else if (cmd === "list") {
    const names = await readdir(resolve(BASELINE_DIR, siteId)).catch(() => [] as string[]);
    console.log(names.filter(n => n.endsWith(".json")).map(n => n.slice(0, -5)).join("\n") || "(none)");
  } else { console.error(`Unknown command ${cmd}`); process.exit(2); }
}
