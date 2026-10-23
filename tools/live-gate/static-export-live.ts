#!/usr/bin/env bun
/** Real-cluster API acceptance. Run remotely after the feature deployment is ready. */
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { api, apiOk, apiBase } from "./zoer";
import { assertWritableSite } from "./guard";

const SITE = "ddev-zoer-connect-040-source";
assertWritableSite(SITE);
const directory = resolve(process.env.LIVE_GATE_STATIC_EVIDENCE || resolve(import.meta.dir, ".baseline", "static-export"));
await mkdir(directory, { recursive: true });
const fixture = await Bun.file(resolve(directory, "setup.json")).json();
if (fixture.siteId !== SITE || !fixture.complete) throw new Error("Prepare a complete fixture on the allowed source site first.");
const prefix = `/wordpress-manager/sites/${SITE}/static-exports`;
const origin = apiBase().replace(/\/api$/, "");
const report: any = { siteId: SITE, at: new Date().toISOString(), checks: [], jobs: [], errors: [] };
const owned = new Set<string>();
const check = (condition: unknown, description: string) => { if (!condition) throw new Error(description); report.checks.push(description); };
const path = (name: string) => { const url = new URL(fixture.routes[name]); return url.pathname + url.search; };
const options = (name: string, extra: Record<string, unknown> = {}) => ({ mode: "selected", paths: [path(name)], linkMode: "relative", basePath: "/", maxPages: 100, maxAssets: 1000, maxBytes: 64 * 1024 * 1024, ...extra });
const saved = async (name: string, value: unknown) => Bun.write(resolve(directory, `${name}.json`), JSON.stringify(value, null, 2) + "\n");

async function create(input: Record<string, unknown>) {
  const { export: job } = await apiOk(prefix, { body: input });
  if (typeof job?.id !== "string") throw new Error("Export creation did not return an ID.");
  owned.add(job.id); report.jobs.push(job.id);
  return job;
}
async function settle(id: string) {
  const deadline = Date.now() + 12 * 60_000;
  let previous = "";
  while (Date.now() < deadline) {
    const { export: job } = await apiOk(`${prefix}/${id}`);
    const progress = JSON.stringify([job.status, job.phase, job.progress]);
    if (progress !== previous) { console.error(progress); previous = progress; }
    if (!["queued", "running"].includes(job.status)) return job;
    await Bun.sleep(750);
  }
  throw new Error("The real export did not settle within the live test budget.");
}
async function download(job: any, name: string) {
  const headers: Record<string, string> = {};
  if (process.env.ZOER_TOKEN) headers.authorization = `Bearer ${process.env.ZOER_TOKEN}`;
  const response = await fetch(origin + job.downloadUrl, { headers });
  check(response.ok, `${name}: ZIP download succeeds`);
  check(response.headers.get("content-type")?.includes("application/zip"), `${name}: ZIP MIME type`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  check(sha256 === job.sha256 && response.headers.get("x-zoer-export-sha256") === job.sha256, `${name}: downloaded digest matches receipt`);
  check(data.subarray(0, 2).toString() === "PK", `${name}: ZIP signature`);
  await Bun.write(resolve(directory, `${name}.zip`), data);
}
async function remove(id: string) {
  const result = await api(`${prefix}/${id}`, { method: "DELETE" });
  check(result.status === 200, "Owned test export can be deleted");
  owned.delete(id);
  const absent = await api(`${prefix}/${id}`);
  check(absent.status >= 400, "Deleted export cannot be read");
}

try {
  const before = await apiOk(prefix);
  await saved("exports-before", before);
  const { preflight } = await apiOk(`${prefix}/inspect`, { body: options("loops") });
  check(preflight.sampledPages === 1, "Preflight identifies one sampled page");
  check(preflight.findings.some((finding: any) => finding.code === "query_snapshot"), "Preflight explains query snapshots");
  await saved("preflight-loops", preflight);
  const dynamic = await apiOk(`${prefix}/inspect`, { body: options("dynamic") });
  check(dynamic.preflight.findings.some((finding: any) => finding.code === "form_requires_service"), "Preflight identifies a form needing a service");
  check(dynamic.preflight.findings.some((finding: any) => finding.code === "dynamic_runtime"), "Preflight identifies live API dependencies");
  await saved("preflight-dynamic", dynamic.preflight);

  for (const [name, extra] of [["loops", {}], ["root-subpath", { linkMode: "root", basePath: "/resources/" }], ["enhanced", {}]] as const) {
    const created = await create(options(name === "enhanced" ? "enhanced" : "loops", extra));
    const job = await settle(created.id);
    await saved(`export-${name}`, job);
    check(job.status === "ready", `${name}: real export is ready (${job.error ?? ""})`);
    check(job.progress.pages >= (name === "enhanced" ? 3 : 9), `${name}: pagination states are rendered`);
    await download(job, name);
    const badSha = await api(`${prefix}/${job.id}/download?sha256=${"0".repeat(64)}`);
    check(badSha.status >= 400, `${name}: wrong download digest is refused`);
    const headers: Record<string, string> = {};
    if (process.env.ZOER_TOKEN) headers.authorization = `Bearer ${process.env.ZOER_TOKEN}`;
    const preview = await fetch(origin + job.previewUrl, { headers, redirect: "manual" });
    check(preview.status === 302, `${name}: preview produces a limited artifact ticket`);
    const target = new URL(preview.headers.get("location")!, origin);
    const publicPreview = await fetch(target);
    const csp = publicPreview.headers.get("content-security-policy") ?? "";
    check(publicPreview.ok, `${name}: ticket preview is readable`);
    check(csp.includes("sandbox allow-scripts") && !csp.includes("allow-same-origin") && csp.includes("form-action 'none'"), `${name}: preview isolates scripts and disables forms`);
    check(publicPreview.headers.get("access-control-allow-origin") === "*", `${name}: opaque-origin preview resources allow CORS`);
    await Bun.write(resolve(directory, `preview-${name}.html`), await publicPreview.text());
    await saved(`preview-${name}-headers`, Object.fromEntries(publicPreview.headers));
    owned.delete(job.id); // Keep positive artifacts for browser qualification and review.
  }

  const broken = await create(options("broken"));
  const failed = await settle(broken.id);
  await saved("export-broken", failed);
  check(failed.status === "failed" && !failed.downloadUrl, "Missing required asset fails without a download");
  await remove(broken.id);

  const limited = await create(options("loops", { maxPages: 1 }));
  const capped = await settle(limited.id);
  await saved("export-page-cap", capped);
  check(capped.status === "failed" && /page limit/i.test(capped.error ?? ""), "Page limit fails explicitly instead of a partial ready export");
  await remove(limited.id);

  const assetLimited = await create(options("loops", { maxAssets: 1 }));
  const assetCapped = await settle(assetLimited.id);
  await saved("export-asset-cap", assetCapped);
  check(assetCapped.status === "failed" && /asset limit/i.test(assetCapped.error ?? ""), "Asset limit fails explicitly instead of a partial ready export");
  await remove(assetLimited.id);

  const initialCap = await api(prefix, { body: { ...options("loops", { maxPages: 1 }), paths: [path("loops"), path("enhanced")] } });
  if (initialCap.status === 202 && typeof initialCap.json?.export?.id === "string") { owned.add(initialCap.json.export.id); report.jobs.push(initialCap.json.export.id); }
  check(initialCap.status === 409, "Initial selected pages cannot exceed their page cap");

  const cancelling = await create(options("loops"));
  const cancelled = await apiOk(`${prefix}/${cancelling.id}/cancel`, { body: {} });
  await saved("export-cancelled", cancelled.export);
  check(cancelled.export.status === "cancelled", "Immediate cancellation reaches its terminal state");
  await remove(cancelling.id);

  const pair = await Promise.all([api(prefix, { body: options("loops") }), api(prefix, { body: options("loops") })]);
  const successes = pair.filter(result => result.status === 202);
  for (const result of successes) {
    const id = result.json?.export?.id;
    if (typeof id === "string") { owned.add(id); report.jobs.push(id); }
  }
  check(successes.length === 1 && pair.some(result => result.status === 409), "Concurrent same-site creation admits one job");
  const simultaneous = successes[0]!.json.export;
  await apiOk(`${prefix}/${simultaneous.id}/cancel`, { body: {} });
  await remove(simultaneous.id);

  for (const invalid of [{ paths: ["/wp-admin/"] }, { paths: ["https://example.com/"] }, { basePath: "/../escape/", linkMode: "root" }, { maxPages: 501 }]) {
    const denied = await api(`${prefix}/inspect`, { body: { ...options("loops"), ...invalid } });
    check(denied.status >= 400, "Unsafe or out-of-bound export options are refused");
  }
  await saved("exports-after", await apiOk(prefix));
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  for (const id of owned) {
    await api(`${prefix}/${id}/cancel`, { body: {} }).catch(() => undefined);
    await api(`${prefix}/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
  await saved("api-report", report);
  console.log(JSON.stringify(report, null, 2));
}
