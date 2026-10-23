#!/usr/bin/env bun
/** Export the restored disposable source after fixture removal; --selected checks / and /sample-page/. Run remotely. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { apiOk, apiBase } from "./zoer";
import { assertWritableSite } from "./guard";

const site = "ddev-zoer-connect-040-source";
assertWritableSite(site);
const directory = resolve(process.env.LIVE_GATE_STATIC_EVIDENCE || resolve(import.meta.dir, ".baseline", "static-export"));
const original = await Bun.file(resolve(directory, "baseline.json")).json();
const restored = await Bun.file(resolve(directory, "baseline-after-final.json")).json();
const cleanup = await Bun.file(resolve(directory, "cleanup.json")).json();
if (!cleanup.cleaned || JSON.stringify(original) !== JSON.stringify(restored)) {
  throw new Error("Verify exact restoration of the original fixture baseline before this acceptance check.");
}
const prefix = `/wordpress-manager/sites/${site}/static-exports`;
const selected = process.argv.includes("--selected");
const label = selected ? "selected-clean" : "whole-clean";
const options = { mode: selected ? "selected" : "site", paths: selected ? ["/", "/sample-page/"] : ["/"], linkMode: "relative", basePath: "/", maxPages: 100, maxAssets: 1000, maxBytes: 64 * 1024 * 1024 };
const { preflight } = await apiOk(`${prefix}/inspect`, { body: options });
await Bun.write(resolve(directory, `preflight-${label}.json`), JSON.stringify(preflight, null, 2) + "\n");
const created = await apiOk(prefix, { body: options });
const id = created.export?.id;
if (typeof id !== "string") throw new Error("Export creation did not return an ID.");
await Bun.write(resolve(directory, `export-${label}-created.json`), JSON.stringify(created.export, null, 2) + "\n");
const deadline = Date.now() + 12 * 60_000;
while (Date.now() < deadline) {
  const { export: job } = await apiOk(`${prefix}/${id}`);
  if (["queued", "running"].includes(job.status)) { await Bun.sleep(750); continue; }
  await Bun.write(resolve(directory, `export-${label}.json`), JSON.stringify(job, null, 2) + "\n");
  if (job.status !== "ready") throw new Error(`The clean ${label} export failed: ${job.error ?? job.status}`);
  const headers: Record<string, string> = {};
  if (process.env.ZOER_TOKEN) headers.authorization = `Bearer ${process.env.ZOER_TOKEN}`;
  const response = await fetch(apiBase().replace(/\/api$/, "") + job.downloadUrl, { headers });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/zip")) throw new Error("No ZIP download returned.");
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (sha256 !== job.sha256 || response.headers.get("x-zoer-export-sha256") !== job.sha256) throw new Error("Downloaded digest does not match the export receipt.");
  await Bun.write(resolve(directory, `${label}.zip`), data);
  console.log(JSON.stringify({ id, sha256, progress: job.progress, downloadUrl: job.downloadUrl, previewUrl: job.previewUrl }, null, 2));
  process.exit(0);
}
throw new Error(`The clean ${label} export did not settle: ${id}`);
