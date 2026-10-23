#!/usr/bin/env bun
/** Real-cluster terminal-state deletion/concurrency regression, without source fixtures. Run remotely. */
import { resolve } from "node:path";
import { api, apiOk } from "./zoer";
import { assertWritableSite } from "./guard";

const site = "ddev-zoer-connect-040-source";
assertWritableSite(site);
const directory = resolve(process.env.LIVE_GATE_STATIC_EVIDENCE || resolve(import.meta.dir, ".baseline", "static-export"));
const prefix = `/wordpress-manager/sites/${site}/static-exports`;
const normal = { mode: "selected", paths: ["/"], linkMode: "relative", basePath: "/", maxPages: 100, maxAssets: 1000, maxBytes: 64 * 1024 * 1024 };
const report: any = { at: new Date().toISOString(), checks: [], cases: [], errors: [] };
const owned = new Set<string>();
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); report.checks.push(message); };
const record = (result: any) => { const id = result.json?.export?.id; if (result.status === 202 && typeof id === "string") owned.add(id); return id; };
async function create(extra: Record<string, unknown>) {
  const result = await api(prefix, { body: { ...normal, ...extra } });
  const id = record(result);
  check(result.status === 202 && id, "A real test export is accepted");
  return id as string;
}
async function settle(id: string) {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const { export: job } = await apiOk(`${prefix}/${id}`);
    if (!["queued", "running"].includes(job.status)) return job;
    await Bun.sleep(20);
  }
  throw new Error(`The export did not settle: ${id}`);
}
async function remove(id: string, name: string, job: any) {
  const started = Date.now();
  const result = await api(`${prefix}/${id}`, { method: "DELETE" });
  report.cases.push({ name, id, status: job.status, phase: job.phase, error: job.error, deleteElapsedMs: Date.now() - started, result });
  check(result.status === 200, `${name}: deletion immediately after visible terminal state succeeds (${result.status})`);
  owned.delete(id);
  check((await api(`${prefix}/${id}`)).status >= 400, `${name}: deleted export cannot be read`);
}
try {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const id = await create({ maxAssets: 1 });
    const job = await settle(id);
    check(job.status === "failed" && /asset limit/i.test(job.error ?? ""), "Asset cap produces an explicit failed state");
    await remove(id, `failed-asset-cap-${attempt}`, job);
  }
  const pageId = await create({ mode: "site", maxPages: 1 });
  const pageJob = await settle(pageId);
  check(pageJob.status === "failed" && /page limit/i.test(pageJob.error ?? ""), "Whole-site page cap fails explicitly");
  await remove(pageId, "failed-page-cap", pageJob);
  const readyId = await create({});
  const ready = await settle(readyId);
  check(ready.status === "ready", "Clean selected-homepage export is ready");
  check((await api(`${prefix}/${readyId}/download?sha256=${"0".repeat(64)}`)).status >= 400, "Wrong download digest is refused");
  await remove(readyId, "ready", ready);
  const cancelledId = await create({});
  const cancelled = (await apiOk(`${prefix}/${cancelledId}/cancel`, { body: {} })).export;
  check(cancelled.status === "cancelled", "Immediate cancellation reaches its terminal state");
  await remove(cancelledId, "cancelled", cancelled);
  const pair = await Promise.all([api(prefix, { body: normal }), api(prefix, { body: normal })]);
  for (const item of pair) record(item);
  check(pair.filter(item => item.status === 202).length === 1 && pair.some(item => item.status === 409), "Concurrent same-site requests admit exactly one export");
  const concurrent = pair.find(item => item.status === 202)!.json.export;
  const stopped = (await apiOk(`${prefix}/${concurrent.id}/cancel`, { body: {} })).export;
  await remove(concurrent.id, "concurrent-cancelled", stopped);
  check((await api(prefix, { body: { ...normal, paths: ["/", "/sample-page/"], maxPages: 1 } })).status === 409, "Starting pages cannot exceed their page cap");
  for (const invalid of [{ paths: ["/wp-admin/"] }, { paths: ["https://example.com/"] }, { basePath: "/../escape/", linkMode: "root" }, { maxPages: 501 }]) {
    check((await api(`${prefix}/inspect`, { body: { ...normal, ...invalid } })).status >= 400, "Unsafe or out-of-bound export options are refused");
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  for (const id of owned) {
    await api(`${prefix}/${id}/cancel`, { body: {} }).catch(() => undefined);
    await Bun.sleep(1000);
    await api(`${prefix}/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
  await Bun.write(resolve(directory, "api-terminal-lifecycle.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
