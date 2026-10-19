import { describe, expect, test } from "bun:test";
import { FakeWorld } from "./fakes/host";
import { BLOCK, FakeZoerConnect, sampleSite, sha } from "./fakes/zoer-connect";
import { writeZip } from "./fakes/zip";
import { createTicketHost } from "../plugin/worker/lib/host.js";
import { connectClient, mapConnectResponse } from "../plugin/worker/lib/zoer-connect.js";
import { connectRefusal, validatePullFiles } from "../plugin/worker/lib/files.js";
import { defaultExportOptions } from "../plugin/worker/lib/options.js";
import { preparationMessage } from "../plugin/worker/lib/pull.js";
import { isTransient, runtimeError } from "../plugin/worker/lib/slices.js";
import { statsText, waitingReason } from "../plugin/worker/lib/push.js";
import { EXPORT_CREATE_INPUT_SCHEMA, schemaIssues } from "./fakes/ddev-schemas";

const PULL = "a".repeat(32), PULL2 = "b".repeat(32), IMPORT = "c".repeat(32), COPY = "d".repeat(32), PREVIEW = "e".repeat(32), RESTORE = "f".repeat(32);

function world() {
  const w = new FakeWorld();
  const source = w.addSite("hostinger-1", sampleSite("https://source.example"));
  const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {}, existing: { "wp-content/themes/twentyone/style.css": "body{color:red}", "wp-content/plugins/akismet/akismet.php": "old" } }));
  return { w, source, destination };
}
async function pulled(w: FakeWorld, siteId = "hostinger-1", pullId = PULL) {
  const result = await w.run("transfer.pull", { siteId, pullId });
  expect(result.status).toBe("succeeded");
  return result.output as any;
}

describe("every managed site (0.8.0: no engine switch)", () => {
  test("transfers run on a site without any engine record, and stale 0.7.x engine records are ignored", async () => {
    const { w } = world();
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL })).status).toBe("succeeded");
    expect(w.calls.some(c => c.method === "catalog.read" && JSON.stringify(c.input).includes("site-engine:"))).toBe(false);
    // A record left by the 0.7.x switch ("legacy", or "plugin" without the test-target confirmation) changes nothing.
    for (const [engine, testTarget] of [["legacy", true], ["plugin", false]] as const) {
      w.catalog.records.set("site-engine:external:dest", { id: "site-engine:external:dest", kind: "site-engine", title: "dest", data: { v: 1, siteId: "external:dest", engine, testTarget, updatedAt: "2026-10-04T00:00:00Z" } });
      const preview = await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: engine === "legacy" ? PREVIEW : PULL2 });
      expect(preview.status).toBe("succeeded");
    }
  });
});

describe("transfer.pull", () => {
  test("downloads a verified, sealed file set and records the pull", async () => {
    const { w, source } = world();
    const output = await pulled(w);
    expect(output).toMatchObject({ pullId: PULL, status: "ready", setId: `fs_${PULL}`, fileCount: 7, skippedCount: 1 });
    const set = w.sets.get(`fs_${PULL}`);
    expect(set.status).toBe("sealed");
    expect(set.labels).toEqual({ kind: "pull", siteId: "hostinger-1", pullId: PULL });
    expect(set.rules).toBe("site-export");
    for (const entry of set.entries) expect(sha(entry.data)).toBe(sha(Buffer.from(source.options.files[entry.path]!)));
    // The large file came with a block digest and was converted to plain sha256.
    const photo = set.entries.find(e => e.path === "wp-content/uploads/2024/01/photo.jpg")!;
    expect(photo.sourceSha256).toBeDefined();
    const record = w.catalog.records.get(`pull:${PULL}`)!;
    expect(record.data).toMatchObject({ status: "ready", setId: `fs_${PULL}`, siteId: "hostinger-1", engine: "plugin", source: { url: "https://source.example", prefix: "wp_" } });
    expect(w.catalog.records.get(`history:pull:${PULL}`)!.data.status).toBe("ready");
    // Same remote calls as the host engine: status, create, step, then chunk reads.
    const routes = source.log.map(l => `${l.method} ${l.route.replace(/\?.*$/, "")}`);
    expect(routes.slice(0, 3)).toEqual(["GET /status", "POST /exports", `POST /exports/${PULL}/step`]);
    expect(routes.slice(3).every(r => r === `GET /exports/${PULL}/chunks`)).toBe(true);
  });

  test("paged manifests are declared page by page and read in batches", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { pagedExport: true, pageSize: 2, exportSteps: 2 }));
    const output = await pulled(w);
    expect(output.fileCount).toBe(7);
    expect(source.log.filter(l => l.route.includes("/manifest")).map(l => l.route)).toEqual([0, 2, 4, 6].map(o => `/exports/paged/${PULL}/manifest?offset=${o}`));
    expect(source.log.some(l => l.route.startsWith(`/exports/paged/${PULL}/batch`))).toBe(true);
  });

  test("a transient 503 retries the slice from its checkpoint and Retry-After is honoured", async () => {
    const { w, source } = world();
    source.failNext(/\/step$/, 503, 1, "7");
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL });
    expect(result.status).toBe("succeeded");
    const retry = result.envelopes.find((e: any) => e.resumable === "retry");
    expect(retry).toMatchObject({ error: { code: "transfer_transient" }, retryAfterMs: 7000 });
    expect(retry.checkpoint.remoteCreated).toBe(true);
    // The export was created once; the retry only polled it.
    expect(source.log.filter(l => l.method === "POST" && l.route === "/exports")).toHaveLength(1);
  });

  test("a rotated key parks the pull with the host engine's message", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 3 }));
    // 18 s slices leave room for one export step each, so the key rotates mid-preparation.
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { onSlice: (_e, slice) => { if (slice === 1) w.rotateKey("hostinger-1"); } , maxSlices: 3, deadlineMs: 18_000 });
    expect(result.status).toBe("needs-user");
    expect((result as any).reason).toBe("This connection changed. Cancel the old pull and start a new one.");
  });

  test("unsafe manifests are refused with the host engine's messages", () => {
    const file = (path: string) => ({ path, bytes: 0, sha256: sha("") });
    expect(() => validatePullFiles([file("wp-content/uploads/.DS_Store")])).toThrow("Add **/.DS_Store and **/__MACOSX/");
    expect(() => validatePullFiles([file("wp-config.php")])).toThrow("unsupported file path: wp-config.php");
    expect(() => validatePullFiles([file("wp-content/plugins/zoer-connect/x.php")])).toThrow("unsupported file path");
    expect(() => validatePullFiles([file("wp-content/uploads/a"), file("wp-content/uploads/A")])).toThrow("duplicate file paths");
    expect(() => validatePullFiles([file("wp-content/uploads/a"), file("wp-content/uploads/a/b")])).toThrow("overlap");
    expect(validatePullFiles([file("wp-content/plugins/a/.gitignore"), file("wp-content/themes/t/.github/x.yml"), file("index.php")])).toHaveLength(3);
  });

  test("dry run verifies the download into a scratch set and keeps nothing", async () => {
    const { w, source } = world();
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, dryRun: true });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ status: "dry-run", setId: null, fileCount: 7 });
    expect(w.sets.sets.has(`fs_${PULL}`)).toBe(false);
    expect(source.exports.get(PULL)!.status).toBe("cancelled");
    expect(w.catalog.records.get(`pull:${PULL}`)!.data.status).toBe("dry-run");
  });

  test("cancel removes the remote export and the partial set", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 3 }));
    const first = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { maxSlices: 1, deadlineMs: 18_000 });
    const checkpoint = first.checkpoint ?? first.envelopes.at(-1)?.checkpoint;
    expect(checkpoint.remoteCreated).toBe(true);
    const cancelled = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { checkpoint, cancelling: true, maxSlices: 1 });
    expect(cancelled.status).toBe("succeeded");
    expect(source.exports.get(PULL)!.status).toBe("cancelled");
    expect(w.sets.sets.has(`fs_${PULL}`)).toBe(false);
  });
});

describe("export preparation pacing", () => {
  const steps = (site: FakeZoerConnect) => site.log.filter(l => l.method === "POST" && /\/step$/.test(l.route)).length;
  /** A fake clock where every remote export step takes `stepMs` (5.5 s: the live per-step baseline). */
  function timed(site: FakeZoerConnect, stepMs = 5_500) {
    let now = Date.parse("2026-10-04T12:00:00Z");
    site.onExportStep = () => { now += stepMs; };
    return () => now;
  }

  test("several remote export steps run within one slice, back to back", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 6 }));
    const clock = timed(source);
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock });
    expect(result.status).toBe("succeeded");
    // Preparation, download, and verification are separate durable slices.
    expect(result.envelopes).toHaveLength(3);
    expect(result.envelopes.slice(0, 2).map((e: any) => e.checkpoint.phase)).toEqual(["downloading", "sealing"]);
    expect(steps(source)).toBe(6);
    expect(source.log.filter(l => l.method === "POST" && l.route === "/exports")).toHaveLength(1);
    // The polls report preparation progress inside the slice.
    expect(w.calls.filter(c => c.method === "run.progress").map(c => c.input.progress.phase)).toEqual([...Array(5).fill("preparing"), "downloading"]);
  });

  test("the slice yields when its budget runs out and the next slice keeps polling at once", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 80 }));
    const clock = timed(source);
    const start = clock();
    const first = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock, maxSlices: 1 });
    const envelope = first.envelopes[0];
    expect(envelope).toMatchObject({ resumable: "continue", waitMs: 0, checkpoint: { phase: "preparing", remoteCreated: true }, progress: { phase: "preparing" } });
    // 300 s slice, 8 s reserve, 10 s budget plus the slowest step (5.5 s): 51 steps of 5.5 s.
    expect(steps(source)).toBe(51);
    expect(clock() - start).toBe(51 * 5_500);
    expect(clock()).toBeLessThan(start + 300_000 - 8_000);
    const rest = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock, checkpoint: envelope.checkpoint, step: 2 });
    expect(rest.status).toBe("succeeded");
    expect(rest.envelopes).toHaveLength(3);
    expect(steps(source)).toBe(80);
    // Created once; the later slice only polled.
    expect(source.log.filter(l => l.method === "POST" && l.route === "/exports")).toHaveLength(1);
  });

  test("fast bridge polls stop below Zoer's runtime call budget per slice", async () => {
    const w = new FakeWorld();
    const content = sampleSite("https://shop.ddev.site", { exportSteps: 450 });
    w.ddev.add("ddev-shop", "shop", content);
    const clock = timed(content, 20);
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL }, { clock });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes.slice(0, 2)).toMatchObject([{ resumable: "continue", waitMs: 0 }, { resumable: "continue", waitMs: 0 }]);
    // Counted like Zoer (the fake refuses the 251st call); the slices stop at the 200-call budget.
    expect(w.executions.slice(0, 2).map(e => e.runtime)).toEqual([200, 200]);
  });

  test("a large local export stays within Zoer's runtime call limits in every phase", async () => {
    const w = new FakeWorld();
    const files: Record<string, string> = { "database.sql": "-- db\n" };
    for (let i = 0; i < 450; i++) files[`wp-content/uploads/2024/01/f${i}.txt`] = `file ${i}`;
    w.ddev.add("ddev-shop", "shop", new FakeZoerConnect({ origin: "https://shop.ddev.site", files, exportSteps: 120 }));
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("succeeded");
    expect((result as any).output.fileCount).toBe(451);
    // Preparation steps, chunk reads (one runtime-peer request per file here) and cleanup together.
    for (const execution of w.executions) expect(execution.runtime + execution.peer).toBeLessThanOrEqual(200 + 2);
    expect(w.executions.length).toBeGreaterThan(2);
  });

  test("a slow step shortens the slice so the next step cannot overrun the deadline", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 80 }));
    const clock = timed(source, 50_000);
    const start = clock();
    const first = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock, maxSlices: 1 });
    expect(first.envelopes[0]).toMatchObject({ resumable: "continue", waitMs: 0 });
    // After 5 steps 42 s are left, less than 10 s + 50 s: a sixth step could miss the deadline.
    expect(steps(source)).toBe(5);
    expect(clock()).toBeLessThan(start + 300_000 - 8_000);
  });

  test("while preparing, progress shows the files the source has listed", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example", { pagedExport: true, exportSteps: 3 }));
    const first = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { maxSlices: 1, deadlineMs: 18_000 });
    expect(first.envelopes[0]).toMatchObject({ resumable: "continue", progress: { phase: "preparing", message: "Remote export: 7 files (database)" } });
    expect(preparationMessage({ phase: "complete", files: 120 })).toBe("Remote export: 120 files (complete)");
    expect(preparationMessage({ phase: "database", files: 0 })).toBe("Remote export: database");
    expect(preparationMessage({ phase: "undefined", files: 1 })).toBe("Remote export: 1 file");
    expect(preparationMessage({ phase: "", files: 0 })).toBeUndefined();
  });

  test("a pause notice stops preparation between steps with the checkpoint", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 10 }));
    source.onExportStep = (job) => { if (job.steps === 3) w.pause = { reason: "maintenance", graceSeconds: 60, drainId: "user-pause:run-1" }; };
    const first = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { maxSlices: 1 });
    expect(first.envelopes[0]).toMatchObject({ paused: true, checkpoint: { phase: "preparing", remoteCreated: true } });
    expect(steps(source)).toBe(3);
    // The worker checked the notice itself: no further step was even attempted (and refused).
    expect(w.calls.filter(c => c.method === "network.fetch" && String(c.input.url).endsWith("/step"))).toHaveLength(3);
    w.pause = null;
    const resumed = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { checkpoint: first.envelopes[0].checkpoint, step: 2 });
    expect(resumed.status).toBe("succeeded");
    expect(steps(source)).toBe(10);
    expect(source.log.filter(l => l.method === "POST" && l.route === "/exports")).toHaveLength(1);
  });

  test("paged manifests: polls until ready, then pages, within one slice", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { pagedExport: true, pageSize: 2, exportSteps: 4 }));
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock: timed(source) });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes).toHaveLength(3);
    // Four polls to ready, then a poll before each further page (the host engine's order).
    const routes = source.log.map(l => l.route.replace(/\?.*$/, "")).filter(r => r !== "/status" && !r.endsWith("/batch"));
    expect(routes).toEqual(["/exports/paged", ...Array(4).fill(`/exports/paged/${PULL}/step`), `/exports/paged/${PULL}/manifest`,
      ...Array(3).fill([`/exports/paged/${PULL}/step`, `/exports/paged/${PULL}/manifest`]).flat()]);
  });

  test("local exports poll the DDEV bridge within one slice", async () => {
    const w = new FakeWorld();
    const content = sampleSite("https://shop.ddev.site", { exportSteps: 5 });
    w.ddev.add("ddev-shop", "shop", content);
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL }, { clock: timed(content) });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes).toHaveLength(3);
    expect(w.calls.filter(c => c.method === "runtime.invoke").map(c => c.input.operation)).toEqual(["runtime.inspect.v1", "export.create.v1", ...Array(4).fill("export.step.v1")]);
  });

  test("copy.local prepares its embedded pull in one slice and labels the progress", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 6 }));
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" }, { clock: timed(source) });
    expect(result.status).toBe("succeeded");
    expect(steps(source)).toBe(6);
    // The embedded pull checkpoints its phase boundaries too.
    expect(result.envelopes.filter((e: any) => String(e.progress?.phase).startsWith("pulling"))).toHaveLength(2);
    expect(w.calls.filter(c => c.method === "run.progress").map(c => c.input.progress.phase)).toEqual([...Array(5).fill("pulling: preparing"), "pulling: downloading"]);
  });
});

describe("deleting a pull", () => {
  test("removes the file set, the record and the export on the site, so the site accepts the next export", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { singleExport: true, pagedExport: true }));
    await pulled(w);
    expect(w.catalog.records.get(`pull:${PULL}`)!.data.paged).toBe(true);
    const blocked = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL2 });
    expect((blocked as any).error.message).toBe("Cancel an existing source export before starting another.");
    const removed = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, remove: true });
    expect((removed as any).output).toMatchObject({ pullId: PULL, status: "deleted", remoteRemoved: true });
    expect(w.sets.sets.has(`fs_${PULL}`)).toBe(false);
    expect(w.catalog.records.has(`pull:${PULL}`)).toBe(false);
    expect(source.exports.get(PULL)!.status).toBe("cancelled");
    expect(source.log.filter(l => l.method === "DELETE").map(l => l.route)).toEqual([`/exports/paged/${PULL}`]);
    // The pull's history entry stays; a delete is not a transfer and adds none.
    expect(w.catalog.records.get(`history:pull:${PULL}`)!.data.status).toBe("ready");
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL2 })).status).toBe("succeeded");
  });

  test("an older record without the export API tries both; a removed connection is reported", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example"));
    await pulled(w);
    delete w.catalog.records.get(`pull:${PULL}`)!.data.paged;
    source.failNext(/^\/exports\/paged\//, 404);
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, remove: true }) as any).output.remoteRemoved).toBe(true);
    expect(source.log.filter(l => l.method === "DELETE").map(l => l.route)).toEqual([`/exports/paged/${PULL}`, `/exports/${PULL}`]);

    await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL2 });
    w.endpoints.delete("hostinger-1");
    const orphan = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL2, remove: true });
    expect((orphan as any).output).toMatchObject({ remoteRemoved: false, remoteError: expect.stringContaining("connection was removed") });
    expect(w.sets.sets.has(`fs_${PULL2}`)).toBe(false);
    expect(w.catalog.records.has(`pull:${PULL2}`)).toBe(false);
  });

  test("a local export's delete cancels the bridge export", async () => {
    const w = new FakeWorld();
    const content = sampleSite("https://shop.ddev.site", { singleExport: true });
    w.ddev.add("ddev-shop", "shop", content);
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL })).status).toBe("succeeded");
    // An export older than the bridge's 24-hour TTL is not released (the bridge purges it itself);
    // while this fake bridge still holds it, the next export is refused.
    const createdAt = w.catalog.records.get(`pull:${PULL}`)!.data.createdAt;
    w.catalog.records.get(`pull:${PULL}`)!.data.createdAt = "2020-01-01T00:00:00.000Z";
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 }) as any).error.message).toBe("Cancel an existing source export before starting another.");
    w.catalog.records.get(`pull:${PULL}`)!.data.createdAt = createdAt;
    const removed = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, remove: true });
    expect((removed as any).output).toMatchObject({ status: "deleted", remoteRemoved: true });
    expect(w.ddev.invocations.filter(i => i.operation === "export.cancel.v1").map(i => i.args)).toContainEqual({ exportId: PULL });
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
  });

  test("releasing local source staging frees a slot without deleting the verified download", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site", { singleExport: true }));
    await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    const before = structuredClone(w.sets.get(`fs_${PULL}`));
    const released = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, releaseSource: true });
    expect((released as any).output).toMatchObject({ status: "source-released", setId: `fs_${PULL}` });
    expect(w.sets.get(`fs_${PULL}`)).toEqual(before);
    expect(w.catalog.records.get(`pull:${PULL}`)!.data).toMatchObject({ status: "ready", setId: `fs_${PULL}`, sourceReleasedAt: expect.any(String) });
    expect(w.calls.some(call => call.method === "fileset.delete")).toBe(false);
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, releaseSource: true })).status).toBe("succeeded");
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
  });

  test("a new local export releases earlier verified stagings itself, in its own run", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site", { singleExport: true }));
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL })).status).toBe("succeeded");
    const before = structuredClone(w.sets.get(`fs_${PULL}`));
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
    expect(w.ddev.invocations.filter(i => i.operation === "export.cancel.v1").map(i => i.args)).toEqual([{ exportId: PULL }]);
    // The earlier download stays verified and usable; only its bridge staging is gone.
    expect(w.sets.get(`fs_${PULL}`)).toEqual(before);
    expect(w.catalog.records.get(`pull:${PULL}`)!.data).toMatchObject({ status: "ready", sourceReleasedAt: expect.any(String) });
    expect(w.catalog.records.get(`pull:${PULL2}`)!.data.sourceReleasedAt).toBeUndefined();
  });

  test("an abandoned unfinished export of the site is released too; the site lock proves it is not running", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site", { singleExport: true }));
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL })).status).toBe("succeeded");
    // Its run died mid-download: the record never became ready, the bridge job is still there.
    Object.assign(w.catalog.records.get(`pull:${PULL}`)!.data, { status: "downloading", setId: null });
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
    expect(w.ddev.invocations.filter(i => i.operation === "export.cancel.v1").map(i => i.args)).toEqual([{ exportId: PULL }]);
    expect(w.catalog.records.get(`pull:${PULL}`)!.data.sourceReleasedAt).toEqual(expect.any(String));
  });

  test("a refused staging release stops the releases; the export still starts, in the next slice", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL })).status).toBe("succeeded");
    // Zoer need not return a fresh runtime ticket with such a refusal: nothing else runs in that slice.
    w.ddev.failOperation = { operation: "export.cancel.v1", message: "Bridge unavailable.", code: "execution_failed", count: 1 };
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
    expect(w.catalog.records.get(`pull:${PULL}`)!.data.sourceReleasedAt).toBeUndefined();
  });

  test("source release refuses wrong site, remote exports and unsealed downloads without cancelling anything", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    const before = w.ddev.invocations.length;
    expect((await w.run("transfer.local-export", { siteId: "ddev-other", pullId: PULL, releaseSource: true })).status).toBe("failed");
    const record = w.catalog.records.get(`pull:${PULL}`)!;
    record.data.kind = "pull";
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, releaseSource: true })).status).toBe("failed");
    record.data.kind = "local-export";
    w.sets.get(`fs_${PULL}`).status = "open";
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, releaseSource: true })).status).toBe("failed");
    expect(w.ddev.invocations.length).toBe(before);
    expect(w.catalog.records.get(`pull:${PULL}`)!.data.status).toBe("ready");
    expect(w.sets.sets.has(`fs_${PULL}`)).toBe(true);
  });

  test("a running transfer is not deleted", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 3 }));
    w.catalog.records.set(`pull:${PULL}`, { id: `pull:${PULL}`, kind: "pull", title: "p", data: { siteId: "hostinger-1", status: "downloading", setId: `fs_${PULL}` } } as any);
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, remove: true }) as any).error.message).toBe("This transfer is still running. Cancel it instead.");
  });
});

describe("transfer.preview and transfer.push", () => {
  const confirm = { confirmTarget: "https://dest.example", replacementAccepted: true };
  test("preview classifies files against the destination and stores pages", async () => {
    const { w, destination } = world();
    await pulled(w);
    const result = await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: PREVIEW });
    expect(result.status).toBe("succeeded");
    // The theme's .gitignore and the uploads index.php are files Zoer Connect refuses: blocked, never compared.
    expect((result as any).output.counts).toEqual({ new: 2, changed: 1, unchanged: 1, blocked: 2, database: 1 });
    // The run's result is the preview summary, the same as its catalog record.
    const record = w.catalog.records.get(`preview:${PREVIEW}`)!.data;
    expect((result as any).output).toEqual({ previewId: PREVIEW, siteId: "external:dest", setId: `fs_${PULL}`, pullId: PULL, complete: true, total: 7, pages: record.pages, counts: record.counts,
      createdAt: record.createdAt, expiresAt: record.expiresAt, summary: "Compared 7 files: 2 new, 1 changed, 1 unchanged, 2 blocked, database." });
    expect(record).toMatchObject({ complete: true, cursor: 7, total: 7 });
    expect(destination.log.filter(l => l.route === "/files/compare")).toHaveLength(1);
    const page = w.catalog.records.get(`preview-page:${PREVIEW}:0`)!.data.files;
    expect(page.find((f: any) => f.path === "wp-content/plugins/akismet/akismet.php").state).toBe("changed");
    expect(destination.log.filter(l => l.route === "/files/compare")).toHaveLength(1);
  });

  test("push uploads with ZBT1 batches, steps the import and finishes byte-identical", async () => {
    const { w, source, destination } = world();
    await pulled(w);
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ status: "complete", importId: IMPORT, fileCount: 5,
      skipped: { count: 2, reason: "not accepted by Zoer Connect", files: [{ path: "wp-content/themes/twentyone/.gitignore", reason: "hidden file or folder" }, { path: "wp-content/uploads/2024/index.php", reason: "executable upload" }] } });
    for (const [path, data] of Object.entries(source.options.files)) {
      if (path === "database.sql") expect(sha(destination.database!)).toBe(sha(Buffer.from(data)));
      else if (path.endsWith(".gitignore") || path.endsWith("index.php")) expect(destination.site.has(path)).toBe(false);
      else expect(sha(destination.site.get(path)!)).toBe(sha(Buffer.from(data)));
    }
    const manifest = destination.imports.get(IMPORT)!.manifest;
    expect(manifest.database.chunkSha256).toHaveLength(1);
    expect(manifest.files.find((f: any) => f.path === "wp-content/uploads/2024/01/photo.jpg").chunkSha256).toHaveLength(3);
    expect(manifest).toMatchObject({ target: "https://dest.example", sourceUrl: "https://source.example", sourcePrefix: "wp_", migrationMode: "shared-replacement", replacementAccepted: true });
    const routes = destination.log.map(l => `${l.method} ${l.route}`);
    expect(routes[0]).toBe("GET /status");
    expect(routes).toContain("POST /imports");
    expect(routes).toContain(`GET /imports/${IMPORT}?view=upload`);
    expect(routes.filter(r => r === `POST /imports/${IMPORT}/batch`).length).toBeGreaterThan(0);
  });

  test("compact import summaries are negotiated without changing upload or manifest contracts", async () => {
    const { w, destination } = world();
    destination.options.capabilities = { compactImportResponses: true };
    await pulled(w);
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(result.status).toBe("succeeded");
    const routes = destination.log.map(l => `${l.method} ${l.route}`);
    expect(routes).toContain("POST /imports?view=compact");
    expect(routes).toContain(`POST /imports/${IMPORT}/step?view=compact`);
    expect(routes).toContain(`GET /imports/${IMPORT}?view=upload`);
    expect(routes).toContain(`POST /imports/${IMPORT}/batch`);
    expect(destination.imports.get(IMPORT)!.manifest).toMatchObject({ target: "https://dest.example", sourceUrl: "https://source.example", migrationMode: "shared-replacement", replacementAccepted: true });
    destination.log.length = 0;
    const finished = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "finish" });
    expect(finished.status).toBe("succeeded");
    expect(destination.log.map(l => `${l.method} ${l.route}`)).toEqual(["GET /status", `GET /imports/${IMPORT}?view=compact`]);
  });

  for (const [remote, expected] of [
    [{ phase: "applying_files", cursor: 3, artifactCount: 7 }, { done: 3, total: 7, unit: "files" }],
    [{ phase: "verifying_tables", progress: { tableIndex: 2, tableCount: 28 } }, { done: 2, total: 28, unit: "items" }],
    [{ phase: "applying_files", cursor: 90, artifactCount: 7 }, { done: 7, total: 7, unit: "files" }],
    [{ phase: "applying_files", cursor: "3", artifactCount: -7 }, {}],
  ] as const) test(`destination progress uses bounded counters: ${JSON.stringify(remote)}`, async () => {
    const { w } = world();
    await pulled(w);
    let now = Date.parse("2026-10-04T12:00:00Z"), injected = false;
    w.services["network.fetch"] = async (input, context) => {
      const response = await w.serve("network.fetch", input, context.effect);
      if (!injected && input.method === "POST" && String(input.url).endsWith(`/imports/${IMPORT}/step`)) {
        injected = true; now += 30_000;
        return { ...response, bodyBase64: Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(response.bodyBase64, "base64").toString()), ...remote })).toString("base64") };
      }
      return response;
    };
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm }, { clock: () => now });
    const progress = result.envelopes.find((e: any) => e.progress?.message === `Destination: ${remote.phase}`)?.progress;
    expect(progress).toMatchObject({ phase: "importing", ...expected });
    if (!("done" in expected)) expect(progress).not.toHaveProperty("done");
    expect(result.status).toBe("succeeded");
  });

  test("a pause during the upload parks the run within one upload slice, before review", async () => {
    const w = new FakeWorld();
    // Whole 256 KiB blocks: the fake uploader cuts batches at byte budgets, not block boundaries.
    const files: Record<string, Buffer> = { "database.sql": Buffer.alloc(BLOCK, 45) };
    for (let i = 0; i < 12; i++) files[`wp-content/uploads/2024/01/v${i}.mp4`] = Buffer.alloc(BLOCK * 4, i + 1);
    w.addSite("hostinger-1", new FakeZoerConnect({ origin: "https://source.example", files }));
    const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {} }));
    await pulled(w);
    let now = Date.parse("2026-10-04T12:00:00Z");
    let batches = 0;
    destination.onRequest = (route) => { if (route.endsWith("/batch")) { now += 10_000; if (++batches === 2) w.userPause = true; } };
    const options = { replacements: { automatic: true, variants: false, paths: false, custom: [] }, fence: "activation", review: true };
    const input = { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, importOptions: options, ...confirm };
    const paused = await w.run("transfer.push", input, { clock: () => now });
    expect(paused.status).toBe("paused");
    expect(paused.checkpoint).toMatchObject({ phase: "uploading" });
    // The slice stopped after 30 s of uploading (3 batches of 10 s), long before the upload's end.
    expect(batches).toBe(3);
    expect(destination.imports.get(IMPORT)!.phase).toBe("uploading");
    const resumed = await w.run("transfer.push", input, { clock: () => now, checkpoint: paused.checkpoint, step: 10 });
    expect(resumed.status).toBe("needs-user");
  });

  test("review pauses the push for the user; approve through push.control, then resume completes", async () => {
    const { w, destination } = world();
    await pulled(w);
    const options = { replacements: { automatic: true, variants: false, paths: false, custom: [] }, fence: "activation", review: true };
    const first = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, importOptions: options, ...confirm });
    expect(first.status).toBe("needs-user");
    expect((first as any).reason).toContain("Review the import before it is activated.");
    expect(destination.site.has("wp-content/uploads/2024/01/photo.jpg")).toBe(false);
    const control = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "approve" });
    expect((control as any).output).toMatchObject({ control: "approve" });
    const resumed = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, importOptions: options, ...confirm }, { checkpoint: first.checkpoint, step: 10 });
    expect(resumed.status).toBe("succeeded");
    expect(destination.site.has("wp-content/uploads/2024/01/photo.jpg")).toBe(true);
  });

  test("selective push sends only the reviewed paths, database first", async () => {
    const { w, destination } = world();
    await pulled(w);
    await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: PREVIEW });
    const selectedPaths = ["wp-content/uploads/2024/01/photo.jpg", "database.sql"];
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, previewId: PREVIEW, selectedPaths, ...confirm });
    expect(result.status).toBe("succeeded");
    const manifest = destination.imports.get(IMPORT)!.manifest;
    expect(manifest.files.map((f: any) => f.path)).toEqual(["wp-content/uploads/2024/01/photo.jpg"]);
    expect(manifest.files[0].expectedDestinationSha256).toBeNull();
    expect(manifest.resources).toMatchObject({ plugins: false, themes: false });
    // With the database the source's active theme and plugins come along, not the destination's.
    expect(manifest.options).toMatchObject({ keepActivePlugins: false, keepActiveTheme: false });
    expect(destination.site.get("wp-content/uploads/2024/01/photo.jpg")!.length).toBe(BLOCK * 2 + 12345);
  });

  test("a compared push without the database, or with an explicit choice, keeps the activation as chosen", async () => {
    const { w, destination } = world();
    await pulled(w);
    await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: PREVIEW });
    await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, previewId: PREVIEW, selectedPaths: ["wp-content/uploads/2024/01/photo.jpg"], ...confirm });
    expect(destination.imports.get(IMPORT)!.manifest.options?.keepActiveTheme ?? null).toBeNull();
    const kept = { replacements: { automatic: true, variants: false, paths: false, custom: [] }, keepActiveTheme: true, keepActivePlugins: null };
    await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: PULL2, previewId: PREVIEW, selectedPaths: ["database.sql"], importOptions: kept, ...confirm });
    expect(destination.imports.get(PULL2)!.manifest.options).toMatchObject({ keepActiveTheme: true, keepActivePlugins: false });
  });

  test("the import ID is checkpointed before the import is created; a lost answer picks up the same import", async () => {
    const { w, destination } = world();
    await pulled(w);
    w.loseResponses.push({ method: "POST", pattern: /^\/imports$/, count: 1 });
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(result.status).toBe("succeeded");
    // Slice 1 plans and checkpoints; slice 2 posts (the answer is lost) and retries from that
    // checkpoint; slice 3 posts the same manifest and gets the existing import.
    expect(result.envelopes[0]).toMatchObject({ resumable: "continue", checkpoint: { phase: "submitting", importId: IMPORT, manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(result.envelopes[1]).toMatchObject({ resumable: "retry", error: { code: "ECONNRESET" }, checkpoint: { phase: "submitting", importId: IMPORT } });
    expect(result.envelopes[2]).toMatchObject({ resumable: "continue", checkpoint: { phase: "uploading", importId: IMPORT } });
    expect(destination.log.filter(l => l.method === "POST" && l.route === "/imports")).toHaveLength(2);
    expect(destination.imports.size).toBe(1);
  });

  test("a manifest that changed between planning and creation is refused", async () => {
    const { w, destination } = world();
    await pulled(w);
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm }, { onSlice: (_e, slice) => { if (slice === 1) w.catalog.records.get(`pull:${PULL}`)!.data.source.prefix = "wp2_"; } });
    // A definite refusal ends the external-write run with a failure result, not "outcome unknown".
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ status: "failed", importId: IMPORT, error: { message: "The download, the destination or the selection changed before the import was created. Start the push again." } });
    expect(destination.imports.size).toBe(0);
  });

  test("a refused import fails cleanly with the site's message and cancels the staged import", async () => {
    const { w, destination } = world();
    await pulled(w);
    const message = "Every imported core or plugin table requires an existing matching destination schema.";
    (destination.options as any).refuseImport = { phase: "scanning_database", message };
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ status: "failed", importId: IMPORT, cancelledImport: true, error: { message, remoteCode: "zoer_import_failed", httpStatus: 409 } });
    expect(result.envelopes.at(-1)).toMatchObject({ resumable: "done", progress: { phase: "failed", message } });
    // Before the fence a rollback only cancels; the cancelled import is then cleaned up, so nothing stays staged.
    expect(destination.imports.get(IMPORT)!.phase).toBe("cancelled");
    expect(destination.imports.get(IMPORT)!.cleanedUp).toBe(true);
    expect((result as any).output.cleanedUp).toBe(true);
  });

  test("a lost answer is not a refusal: the step is retried", async () => {
    const { w } = world();
    await pulled(w);
    w.loseResponses.push({ method: "POST", pattern: /\/step$/, count: 1 });
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(result.status).toBe("succeeded");
    expect((result as any).output.status).toBe("complete");
    expect(result.envelopes.some((e: any) => e.resumable === "retry")).toBe(true);
  });

  test("the dry run names tables the destination lacks and suggests Create missing tables", async () => {
    const { w, destination } = world();
    await pulled(w);
    (destination.options as any).tables = ["options"];
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, dryRun: true, ...confirm });
    expect((result as any).output.plan.missingTables).toEqual(["posts"]);
    expect((result as any).output.plan.warnings).toContain("The destination has no table for posts. Turn on “Create missing tables”, or Zoer Connect will refuse the import.");
    const create = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: PULL2, dryRun: true, importOptions: { replacements: { automatic: true, variants: false, paths: false, custom: [] }, createTables: true }, ...confirm });
    expect((create as any).output.plan.missingTables).toBeUndefined();
  });

  test("a push stops before uploading when the destination lacks tables and Create missing tables is off", async () => {
    const { w, destination } = world();
    await pulled(w);
    (destination.options as any).tables = ["options"];
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(JSON.stringify(result)).toContain("The destination has no table for posts. Turn on “Create missing tables” (Database and address options) and push again. Nothing was sent.");
    expect(destination.imports.has(IMPORT)).toBe(false);
  });

  test("dry run plans the push and sends nothing that writes", async () => {
    const { w, destination } = world();
    await pulled(w);
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, dryRun: true, ...confirm });
    // Files Zoer Connect would refuse are reported in the plan, before anything is sent.
    expect((result as any).output).toMatchObject({ status: "dry-run", plan: { files: 4, database: true, batchUpload: true, skipped: { count: 2, reason: "not accepted by Zoer Connect" },
      warnings: ["2 files skipped: not accepted by Zoer Connect (wp-content/themes/twentyone/.gitignore, wp-content/uploads/2024/index.php). The destination keeps its own copies."] } });
    // Only reads: status, then diagnostics for the missing-table check.
    expect(destination.log.map(l => l.route)).toEqual(["/status", "/diagnostics"]);
    expect(destination.imports.size).toBe(0);
  });

  test("changed key parks the import with the host engine's recovery message", async () => {
    const { w } = world();
    await pulled(w);
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm }, { onSlice: (_e, slice) => { if (slice === 1) w.rotateKey("external:dest"); } });
    // The first slice may already have finished the small import; otherwise the next slice parks.
    if (result.status !== "succeeded") expect((result as any).reason).toBe("Connection changed. Restore the original connection to recover this import.");
  });

  test("destination confirmation, policy and source checks match the host engine", async () => {
    const { w } = world();
    await pulled(w);
    const wrong = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://other.example", replacementAccepted: true });
    expect((wrong as any).output.error.message).toBe("Confirm the exact destination address.");
    const noPolicy = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://dest.example" });
    expect((noPolicy as any).output.error.message).toContain("confirm the destination replacement policy");
    const same = await w.run("transfer.push", { siteId: "hostinger-1", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://source.example", replacementAccepted: true });
    expect((same as any).output.error.message).toContain("Choose a different source");
  });
});

describe("copy.local", () => {
  test("pulls, creates a DDEV site, stages verified files, imports and verifies", async () => {
    const { w, source } = world();
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    expect(result.status).toBe("succeeded");
    const output = (result as any).output;
    expect(output).toMatchObject({ copyId: COPY, status: "complete", siteName: `Shop-${COPY.slice(0, 8)}` });
    const site = w.ddev.sites.get(output.targetId)!;
    expect(site.home).toBe(output.targetUrl);
    for (const [path, data] of Object.entries(source.options.files)) if (path !== "database.sql") expect(sha(site.files.get(path)!)).toBe(sha(Buffer.from(data)));
    expect(site.database!.toString()).toBe(source.options.files["database.sql"]!.toString());
    expect(w.ddev.commands.map(c => c.command)).toEqual(["wordpress.copy.prepare", "wordpress.copy.database", "wordpress.copy.files", "wordpress.copy.finish"]);
    expect(w.catalog.records.get(`site-link:${output.targetId}`)!.data.sourceSiteId).toBe("hostinger-1");
    expect(w.catalog.records.get(`local-copy:${COPY}`)!.data.phase).toBe("complete");
  });

  test("users: copies the source's accounts only when asked, and records the import summary", async () => {
    const { w } = world();
    const copied = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", users: "source" });
    expect(copied.status).toBe("succeeded");
    expect(w.ddev.commands.find(c => c.command === "wordpress.copy.database")!.plan.users).toBe("source");
    const output = (copied as any).output;
    expect(output.database).toMatchObject({ tables: 12, users: { mode: "source", copied: 114, meta: 3403 } });
    // Collation conversions are kept as reported; malformed names are dropped.
    expect(output.database.collations).toEqual([{ from: "utf8mb4_0900_ai_ci", to: "utf8mb4_unicode_520_ci", tables: 12 }]);
    expect(output.summary).toContain("with 114 source users");
    expect(w.catalog.records.get(`local-copy:${COPY}`)!.data).toMatchObject({ users: "source", database: { users: { copied: 114 } } });

    const plain = world();
    await plain.w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    expect(plain.w.ddev.commands.find(c => c.command === "wordpress.copy.database")!.plan.users).toBe("local");
    expect(plain.w.catalog.records.get(`local-copy:${COPY}`)!.data).toMatchObject({ users: "local", database: { users: { mode: "local" } } });

    const exact = world();
    const replaced = await exact.w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", users: "exact" });
    expect(exact.w.ddev.commands.find(c => c.command === "wordpress.copy.database")!.plan.users).toBe("exact");
    expect((replaced as any).output.database.users).toMatchObject({ mode: "exact", copied: 114 });
    expect((replaced as any).output.summary).toContain("with 114 source users");

    const bad = await world().w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", users: "everyone" });
    expect((bad as any).error.message).toBe("Choose whether to keep the local accounts or copy the source's users.");
  });

  test("refresh takes a recovery backup first and reuses the copy", async () => {
    const { w } = world();
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const refresh = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: targetId });
    expect(refresh.status).toBe("succeeded");
    expect((refresh as any).output.targetId).toBe(targetId);
    expect(w.ddev.sites.get(targetId)!.backups).toBe(1);
  });

  test("database refresh backs up, downloads only SQL and never places source code files", async () => {
    const { w, source } = world();
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const site = w.ddev.sites.get(targetId)!;
    site.files.set("wp-content/plugins/development/plugin.php", Buffer.from("local development"));
    const before = [...site.files].map(([p, b]) => [p, sha(b)]);
    const calls = w.ddev.commands.length;
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: targetId, scope: "database", keepLocalDesign: true, users: "source" });
    expect(result.status).toBe("succeeded");
    expect([...site.files].map(([p, b]) => [p, sha(b)])).toEqual(before);
    expect(w.ddev.commands.slice(calls).map(c => c.command)).toEqual(["wordpress.copy.prepare", "wordpress.copy.database", "wordpress.copy.finish"]);
    expect(w.ddev.commands.slice(calls).find(c => c.command === "wordpress.copy.database")!.plan).toMatchObject({ scope: "database", keepLocalDesign: true, users: "source" });
    expect(source.exports.get(PULL2)!.files.map(f => f.path)).toEqual(["database.sql"]);
    expect(w.catalog.records.get(`local-copy:${PULL2}`)!.data).toMatchObject({ scope: "database", keepLocalDesign: true, replaceSiteId: targetId, backup: "backup-1" });
    expect(site.backups).toBe(1);
  });

  test("no-media refresh downloads code and database, preserves upload bytes and requires an existing copy", async () => {
    const { w, source } = world();
    const refused = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, name: "Shop", scope: "without-media" });
    expect((refused as any).error.message).toContain("existing linked local copy");
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const site = w.ddev.sites.get(targetId)!;
    site.files.set("wp-content/uploads/keep.jpg", Buffer.from("local media"));
    const before = [...site.files].filter(([p]) => p.startsWith("wp-content/uploads/")).map(([p,b]) => [p,sha(b)]);
    const refreshed = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: targetId, scope: "without-media", users: "source" });
    expect(refreshed.status).toBe("succeeded");
    expect(source.exports.get(PULL2)!.files.some(f => f.path.startsWith("wp-content/uploads/"))).toBe(false);
    expect(source.exports.get(PULL2)!.files.some(f => f.path.startsWith("wp-content/themes/"))).toBe(true);
    expect([...site.files].filter(([p]) => p.startsWith("wp-content/uploads/")).map(([p,b]) => [p,sha(b)])).toEqual(before);
    expect(site.backups).toBe(1);
    expect(w.catalog.records.get(`local-copy:${PULL2}`)!.data.scope).toBe("without-media");
  });

  test("database refresh rejects new sites and complete pulls before a local write", async () => {
    const { w } = world();
    expect((await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", scope: "database" }) as any).error.message).toContain("existing linked local copy");
    expect(w.ddev.sites.size).toBe(0);
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const count = w.ddev.commands.length;
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: (first as any).output.targetId, scope: "database", pullSetId: `fs_${COPY}` });
    expect((result as any).error.message).toContain("database-only Pull");
    expect(w.ddev.commands.length).toBe(count);
  });

  test("a failed command parks the copy with its message; resume continues the same destination", async () => {
    const { w } = world();
    w.ddev.failCommand = { command: "wordpress.copy.finish", message: "Local website verification failed.", count: 1 };
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    expect(first.status).toBe("needs-user");
    expect((first as any).reason).toBe("Local website verification failed.");
    const resumed = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" }, { checkpoint: first.checkpoint, step: 20 });
    expect(resumed.status).toBe("succeeded");
    expect(w.ddev.sites.size).toBe(1);
  });

  test("dry run restores into a scratch site that goes to the trash, and keeps no pull", async () => {
    const { w } = world();
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", dryRun: true });
    expect((result as any).output).toMatchObject({ status: "dry-run", siteName: `zoer-dryrun-${COPY.slice(0, 8)}`, targetUrl: null });
    expect([...w.ddev.sites.values()][0]!.state).toBe("archived");
    expect(w.sets.sets.size).toBe(0);
    expect(w.catalog.records.has(`local-copy:${COPY}`)).toBe(false);
  });

  test("refresh options reach the pull and the import: new media, selected plugins, stale files, activation, find & replace", async () => {
    const { w, source } = world();
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const site = w.ddev.sites.get(targetId)!;
    site.files.set("wp-content/plugins/akismet/removed-upstream.php", Buffer.from("stale"));
    site.files.set("wp-content/plugins/akismet/.git/HEAD", Buffer.from("ref: main"));
    site.files.set("wp-content/plugins/local-only/local.php", Buffer.from("developer plugin"));
    const calls = w.ddev.commands.length;
    const refreshed = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: targetId, media: "since-last", plugins: { mode: "selected", items: ["akismet"] }, removeStale: true,
      activePlugins: "source", database: { excludeRevisions: true, excludeSpam: true }, replacements: { paths: true, custom: [{ find: "Old Brand", replace: "New Brand", caseSensitive: false }] }, pace: "gentle" });
    expect(refreshed.status).toBe("succeeded");
    const profile = source.exports.get(PULL2)!.input.profile;
    expect(profile).toMatchObject({ themes: true, plugins: true, media: true, pluginsMode: "selected", pluginsItems: ["akismet"] });
    // The first copy downloaded media today, so "since-last" asks for files changed since then.
    expect(profile.mediaSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(source.exports.get(PULL2)!.input.database).toMatchObject({ excludeRevisions: true, excludeSpam: true, postTypes: null });
    const plan = w.ddev.commands.slice(calls).find(c => c.command === "wordpress.copy.database")!.plan;
    expect(plan).toMatchObject({ activePlugins: "source", replacements: { sourcePath: "/var/www/html", custom: [{ find: "Old Brand", replace: "New Brand", regex: false, caseSensitive: false }] } });
    expect(w.ddev.commands.slice(calls).find(c => c.command === "wordpress.copy.finish")!.plan.prune).toBe(true);
    // Only the stale file inside the placed plugin folder went; hidden files and other plugins stayed.
    expect(site.files.has("wp-content/plugins/akismet/removed-upstream.php")).toBe(false);
    expect(site.files.has("wp-content/plugins/akismet/.git/HEAD")).toBe(true);
    expect(site.files.has("wp-content/plugins/local-only/local.php")).toBe(true);
    const output = (refreshed as any).output;
    expect(output.summary).toMatch(/only media new since \d{4}-\d{2}-\d{2} downloaded/);
    expect(output.summary).toContain("selected plugins only");
    expect(output.summary).toContain("1 deleted file removed");
    expect(output.summary).toContain("source plugins activated");
    expect(w.catalog.records.get(`local-copy:${PULL2}`)!.data).toMatchObject({ pruned: 1, options: { media: "since-last", activePlugins: "source", removeStale: true, pace: "gentle" } });
  });

  test("gentle pace downloads two chunks per request; an unknown pace is refused", async () => {
    const { w } = world();
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, pace: "gentle" });
    expect(result.status).toBe("succeeded");
    const downloads = w.calls.filter(call => call.method === "transfer.download");
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads.every(call => call.input.maxChunks <= 2)).toBe(true);
    expect(((await world().w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, pace: "fast" })) as any).error.message).toContain("pace");
  });

  test("translations: the languages folder is placed when the source supports it, and refused clearly when it does not", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example", { files: { ...sampleSite().options.files, "wp-content/languages/fr_FR.mo": "translation" } }));
    const copied = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", languages: true });
    expect(copied.status).toBe("succeeded");
    expect(w.ddev.sites.get((copied as any).output.targetId)!.files.has("wp-content/languages/fr_FR.mo")).toBe(true);
    expect((copied as any).output.summary).toContain("translations included");
    const plain = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, name: "Shop" });
    expect(plain.status).toBe("succeeded");
    expect(w.ddev.sites.get((plain as any).output.targetId)!.files.has("wp-content/languages/fr_FR.mo")).toBe(false);
    const old = new FakeWorld();
    old.addSite("hostinger-1", sampleSite("https://source.example", { capabilities: { languages: false } }));
    expect(((await old.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", languages: true })) as any).error.message).toContain("Update Zoer Connect on the source to 0.8.1");
    expect(old.ddev.sites.size).toBe(0);
  });

  test("a copy frees its source export once downloaded, so one-export sources accept the next refresh", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { singleExport: true }));
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    expect(first.status).toBe("succeeded");
    const refreshed = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: (first as any).output.targetId, scope: "files" });
    expect(refreshed.status).toBe("succeeded");
    expect([...source.exports.values()].filter(job => job.status !== "cancelled").length).toBe(0);
  });

  test("files-only refresh downloads no database, skips the import and keeps the database", async () => {
    const { w, source } = world();
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const site = w.ddev.sites.get(targetId)!;
    const database = site.database!.toString();
    const calls = w.ddev.commands.length;
    const refreshed = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: targetId, scope: "files", media: "none" });
    expect(refreshed.status).toBe("succeeded");
    expect(source.exports.get(PULL2)!.input.database).toBeFalsy();
    expect(source.exports.get(PULL2)!.files.some(f => f.path === "database.sql" || f.path.startsWith("wp-content/uploads/"))).toBe(false);
    expect(w.ddev.commands.slice(calls).map(c => c.command)).toEqual(["wordpress.copy.prepare", "wordpress.copy.files", "wordpress.copy.finish"]);
    expect(w.ddev.commands.slice(calls).find(c => c.command === "wordpress.copy.finish")!.plan.scope).toBe("files");
    expect(site.database!.toString()).toBe(database);
    expect(site.backups).toBe(1);
    expect((refreshed as any).output.summary).toContain("Local themes and plugins refreshed");
  });

  test("new media counts from this copy's own last download, not another copy's or a separate pull", async () => {
    const { w, source } = world();
    const a = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "A" });
    // A database-only refresh of A has no media: the cutoff stays at A's first copy.
    await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: (a as any).output.targetId, scope: "database" });
    const record = w.catalog.records.get(`local-copy:${COPY}`)!;
    w.catalog.records.set(`local-copy:${COPY}`, { ...record, data: { ...record.data, createdAt: "2026-01-05T10:00:00.000Z" } });
    await pulled(w); // a separate Pull today must not move A's cutoff
    const third = "c".repeat(32);
    const refreshed = await w.run("copy.local", { siteId: "hostinger-1", copyId: third, replaceSiteId: (a as any).output.targetId, media: "since-last" });
    expect(refreshed.status).toBe("succeeded");
    expect(source.exports.get(third)!.input.profile.mediaSince).toBe("2026-01-05");
  });

  test("refresh options are refused where they do not apply, before anything changes", async () => {
    const { w } = world();
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const count = w.ddev.commands.length;
    const refused = async (input: Record<string, unknown>) => ((await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, ...input })) as any).error?.message as string;
    expect(await refused({ name: "Shop", media: "since-last" })).toContain("refreshing an existing local copy");
    expect(await refused({ name: "Shop", activePlugins: "local" })).toContain("no plugin activation of its own");
    expect(await refused({ name: "Shop", removeStale: true })).toContain("refreshing an existing copy");
    expect(await refused({ name: "Shop", database: { tables: ["posts", "options"] } })).toContain("a new copy needs every table");
    expect(await refused({ replaceSiteId: targetId, database: { tables: ["postmeta"] } })).toBe("Include the posts and options tables.");
    expect(await refused({ replaceSiteId: targetId, scope: "database", activePlugins: "source" })).toContain("keeps the local site's active plugins");
    expect(await refused({ replaceSiteId: targetId, scope: "files", users: "source" })).toContain("does not change user accounts");
    expect(await refused({ replaceSiteId: targetId, scope: "files", replacements: { paths: true } })).toContain("no database");
    expect(await refused({ replaceSiteId: targetId, scope: "without-media", media: "all" })).toContain("does not copy media");
    expect(await refused({ replaceSiteId: targetId, pullSetId: `fs_${COPY}`, media: "none" })).toContain("an existing download keeps the selection");
    expect(await refused({ replaceSiteId: targetId, replacements: { custom: [{ find: "not a regex", replace: "x", regex: true }] } })).toContain("delimiters");
    expect(await refused({ replaceSiteId: targetId, pace: "fast" })).toContain("pace");
    expect(await refused({ replaceSiteId: targetId, replacements: { custom: [{ find: "/foo(/", replace: "x", regex: true }] } })).toContain("does not compile");
    expect(await refused({ replaceSiteId: targetId, replacements: { custom: [{ find: "字".repeat(2000), replace: "x" }] } })).toContain("4,096");
    expect(await refused({ replaceSiteId: targetId, users: "source", database: { tables: ["posts", "options"] } })).toContain("users and usermeta");
    expect(await refused({ replaceSiteId: targetId, scope: "database", keepLocalDesign: true, database: { postTypes: ["post"] } })).toContain("every post type");
    expect(w.ddev.commands.length).toBe(count);
  });

  test("a copy made before refresh options resumes with the old behaviour", async () => {
    const { w } = world();
    w.ddev.failCommand = { command: "wordpress.copy.finish", message: "Local website verification failed.", count: 1 };
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    // A checkpoint written by 0.12 has no options; it still finishes with plugins inactive and no prune.
    const checkpoint = JSON.parse(JSON.stringify(first.checkpoint));
    delete checkpoint.options;
    const resumed = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" }, { checkpoint, step: 20 });
    expect(resumed.status).toBe("succeeded");
    expect(w.ddev.commands.filter(c => c.command === "wordpress.copy.finish").at(-1)!.plan.prune).toBeUndefined();
  });

  test("an executable upload that is not a placeholder is refused before anything is created", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", new FakeZoerConnect({ origin: "https://source.example", files: { "database.sql": "x", "wp-content/uploads/index.php": "<?php echo 1;" } }));
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    expect((result as any).error.message).toContain("executable upload");
    expect(w.ddev.sites.size).toBe(0);
    expect(w.catalog.records.get(`history:local-copy:${COPY}`)!.data).toMatchObject({ kind: "local-copy", status: "failed", siteId: "hostinger-1", sourceSiteId: "hostinger-1", summary: `Local copy Shop-${COPY.slice(0, 8)}` });
    expect(w.catalog.records.get(`history:local-copy:${COPY}`)!.data.lastError).toContain("executable upload");
  });
});

describe("transfer.local-export", () => {
  test("exports a DDEV site through bridge operations and a runtime peer", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ kind: "local-export", status: "ready", fileCount: 7 });
    expect(w.calls.filter(c => c.method === "runtime.invoke").map(c => c.input.operation)).toEqual(["runtime.inspect.v1", "export.create.v1"]);
    expect(w.calls.find(c => c.method === "transfer.download")!.input.source).toEqual({ runtime: { alias: "wordpress_site", resourceId: "ddev-shop", operation: "export.chunk.v1", args: { exportId: PULL } } });
  });

  test("default options send the host engine's body, valid against Zoer's export.create.v1 schema", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    // The UI sends the default export options (PluginPushFlow); omitting them means the same.
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, exportOptions: defaultExportOptions() });
    expect(result.status).toBe("succeeded");
    const args = w.ddev.invocations.find(i => i.operation === "export.create.v1")!.args;
    expect(schemaIssues(EXPORT_CREATE_INPUT_SCHEMA, args)).toEqual([]);
    // requestLocalExport's { id, sourceUrl, profile, database } with the full snapshot as filters.
    expect(args).toEqual({ clientId: PULL, sourceUrl: "https://shop.wp.example", database: { postTypes: null, excludeRevisions: false, excludeSpam: false, excludeTransients: true },
      profile: { name: "Zoer remote pull", excludes: [], themes: true, plugins: true, media: true, muplugins: false, core: false } });
    expect((result as any).output.source).toEqual({ url: "https://shop.wp.example", prefix: "wp_" });
    // The host engine's `database: true` is what the schema refuses.
    expect(schemaIssues(EXPORT_CREATE_INPUT_SCHEMA, { ...args, database: true })).not.toEqual([]);
  });

  test("database filters reach the bridge as filters", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    const options = defaultExportOptions();
    options.database.excludeRevisions = true;
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, exportOptions: options });
    expect(result.status).toBe("succeeded");
    const args = w.ddev.invocations.find(i => i.operation === "export.create.v1")!.args;
    expect(schemaIssues(EXPORT_CREATE_INPUT_SCHEMA, args)).toEqual([]);
    expect(args.database).toEqual({ postTypes: null, excludeRevisions: true, excludeSpam: false, excludeTransients: true });
  });

  test("a bridge refusal fails at once with the bridge's message and Zoer's code", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.ddev.failOperation = { operation: "export.create.v1", message: "Invalid export selections.", code: "database_query_failed", count: 99 };
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("failed");
    expect((result as any).error).toMatchObject({ message: "Invalid export selections.", code: "database_query_failed" });
    expect(result.envelopes).toHaveLength(0);
    expect(w.ddev.invocations.filter(i => i.operation === "export.create.v1")).toHaveLength(1);
    // Recorded like the host engine lists a job with lastError.
    expect(w.catalog.records.get(`history:local-export:${PULL}`)!.data).toMatchObject({ kind: "local-export", id: PULL, siteId: "ddev-shop", status: "failed", engine: "plugin",
      lastError: "Invalid export selections.", errorCode: "database_query_failed", summary: "Local export: Database, themes, plugins, media", runId: "run-1" });
  });

  test("a long source outage parks the download without deleting saved progress", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.ddev.failOperation = { operation: "export.create.v1", message: "DDEV bridge request failed (503).", code: "database_query_failed", count: 99 };
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("needs-user");
    expect(result.envelopes).toHaveLength(9);
    expect(result.reason).toContain("Saved progress is kept");
    expect(w.catalog.records.has(`history:local-export:${PULL}`)).toBe(false);
    w.ddev.failOperation = undefined;
    const resumed = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL }, { checkpoint: result.checkpoint });
    expect(resumed.status).toBe("succeeded");
  });

  test("a bridge transport failure retries with the bridge's message and code", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.ddev.failOperation = { operation: "export.create.v1", message: "DDEV bridge request failed (502).", code: "database_query_failed", count: 1 };
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes[0]).toMatchObject({ resumable: "retry", error: { code: "database_query_failed", message: "DDEV bridge request failed (502)." } });
  });

  test("a failed export cleans up its partial set, its record and the bridge export", async () => {
    const w = new FakeWorld();
    const content = sampleSite("https://shop.ddev.site", { singleExport: true });
    w.ddev.add("ddev-shop", "shop", content);
    w.services["transfer.download"] = () => { throw Object.assign(new Error("The peer refused the request."), { name: "HostCallError", code: "transfer_rejected" }); };
    const failed = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect((failed as any).error.message).toBe("The peer refused the request.");
    expect(w.sets.sets.has(`fs_${PULL}`)).toBe(false);
    expect(w.catalog.records.get(`pull:${PULL}`)!.data).toMatchObject({ status: "failed", lastError: "The peer refused the request.", setId: null });
    expect(content.exports.get(PULL)!.status).toBe("cancelled");
    expect(w.catalog.records.get(`history:local-export:${PULL}`)!.data.status).toBe("failed");
    // The site accepts the next export.
    delete w.services["transfer.download"];
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
  });

  test("a files-only local export never includes SQL and forwards database false", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    const options = defaultExportOptions();
    options.resources.database = false;
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, exportOptions: options });
    expect(result.status).toBe("succeeded");
    const args=w.ddev.invocations.find(i=>i.operation==="export.create.v1")!.args;
    expect(args.database).toBe(false);
    expect(schemaIssues(EXPORT_CREATE_INPUT_SCHEMA,args)).toEqual([]);
    expect((result as any).output).toMatchObject({status:"ready",fileCount:6});
    expect(w.catalog.records.get(`pull:${PULL}`)!.data.options.database).toBe(false);
    expect(w.sets.sets.get(`fs_${PULL}`)!.entries.some(file=>file.path==="database.sql")).toBe(false);
  });
});

describe("backup.restore-local", () => {
  function upload(w: FakeWorld) {
    const sql = "# WordPress MySQL database backup\n# Created by UpdraftPlus\n";
    const files: Record<string, Buffer> = {
      "backup_2026-10-01-1200_Site_abcdef123456-db.gz": Buffer.from(sql),
      "backup_2026-10-01-1200_Site_abcdef123456-plugins.zip": writeZip([{ name: "plugins/" }, { name: "plugins/hello.php", data: "<?php" }]),
      "backup_2026-10-01-1200_Site_abcdef123456-themes.zip": writeZip([{ name: "themes/t/style.css", data: "x", deflate: true }]),
      "backup_2026-10-01-1200_Site_abcdef123456-uploads.zip": writeZip([{ name: "uploads/a.jpg", data: "jpg" }]),
      "backup_2026-10-01-1200_Site_abcdef123456-others.zip": writeZip([{ name: "languages/x.mo", data: "mo" }, { name: "object-cache.php", data: "<?php" }]),
    };
    return w.sets.sealed("Updraft", files, { kind: "updraft-upload" });
  }
  test("dry run inspects the archives and plans without creating a site", async () => {
    const w = new FakeWorld();
    const setId = upload(w);
    const result = await w.run("backup.restore-local", { uploadSetId: setId, restoreId: RESTORE, name: "Restored", dryRun: true });
    expect((result as any).output).toMatchObject({ status: "dry-run", plan: { files: 4 } });
    expect((result as any).output.plan.warnings).toContain("Skipped local cache, drop-in, must-use plugin or backup file.");
    expect(w.ddev.sites.size).toBe(0);
  });
  test("restores into a new local site through the Updraft preparation bundle", async () => {
    const w = new FakeWorld();
    const setId = upload(w);
    const result = await w.run("backup.restore-local", { uploadSetId: setId, restoreId: RESTORE, name: "Restored" });
    expect(result.status).toBe("succeeded");
    const site = w.ddev.sites.get((result as any).output.targetId)!;
    expect(site.files.get("wp-content/themes/t/style.css")!.toString()).toBe("x");
    expect(w.ddev.commands.map(c => c.command)).toEqual(["wordpress.copy.prepare", "wordpress.updraft.prepare", "wordpress.copy.database", "wordpress.copy.files", "wordpress.copy.finish"]);
    expect(w.ddev.commands.at(-1)!.plan.updateDb).toBe(true);
    expect(w.ddev.commands.find(c => c.command === "wordpress.copy.database")!.plan.users).toBe("local");
  });
  test("a restore can copy the backup's users; the dry run plan says so", async () => {
    const w = new FakeWorld();
    const setId = upload(w);
    const dry = await w.run("backup.restore-local", { uploadSetId: setId, restoreId: RESTORE, name: "Restored", dryRun: true, users: "source" });
    expect((dry as any).output.plan.users).toBe("source");
    const result = await w.run("backup.restore-local", { uploadSetId: setId, restoreId: "c".repeat(32), name: "Restored", users: "source" });
    expect(result.status).toBe("succeeded");
    expect(w.ddev.commands.find(c => c.command === "wordpress.copy.database")!.plan.users).toBe("source");
    expect((result as any).output.database.users).toMatchObject({ mode: "source", copied: 114 });
  });
  test("an incomplete set is refused with the host engine's message", async () => {
    const w = new FakeWorld();
    const setId = w.sets.sealed("Updraft", { "backup_x-db.gz": "x" });
    const result = await w.run("backup.restore-local", { uploadSetId: setId, restoreId: RESTORE, name: "Restored" });
    expect((result as any).error.message).toBe("select one database, plugins, themes, uploads, and others backup file");
  });
});

describe("transfer.push.control", () => {
  const confirm = { confirmTarget: "https://dest.example", replacementAccepted: true };
  /** A completed push of `count` files plus the database onto a destination with a few files of its own. */
  async function completedPush(count: number) {
    const w = new FakeWorld();
    const files: Record<string, string> = { "database.sql": "-- db\n" };
    for (let i = 0; i < count; i++) files[`wp-content/uploads/2024/01/f${i}.jpg`] = `new ${i}`;
    w.addSite("hostinger-1", new FakeZoerConnect({ origin: "https://source.example", files }));
    const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {}, existing: { "wp-content/uploads/2024/01/f0.jpg": "old 0" }, importTables: 12 }));
    await pulled(w);
    const pushed = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect((pushed as any).output.status).toBe("complete");
    expect(destination.site.get("wp-content/uploads/2024/01/f0.jpg")!.toString()).toBe("new 0");
    return { w, destination };
  }

  test("one approved rollback drives every rollback phase to the end, across slices", async () => {
    const { w, destination } = await completedPush(300);
    let now = Date.parse("2026-10-04T12:00:00Z");
    const phases: string[] = [];
    destination.onRequest = (route) => { if (route.endsWith("/rollback")) { now += 400; const phase = destination.imports.get(IMPORT)!.phase; if (phases.at(-1) !== phase) phases.push(phase); } };
    const result = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "rollback" }, { clock: () => now });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ importId: IMPORT, control: "rollback", phase: "rolled_back", summary: "Import rolled back." });
    const requests = destination.imports.get(IMPORT)!.requests.rollback!;
    expect(requests).toBeGreaterThan(900);
    expect((result as any).output.requests).toBe(requests);
    // Several slices, each within its time, request and output budgets; every one a continue until done.
    expect(result.envelopes.length).toBeGreaterThan(1);
    expect(result.envelopes.slice(0, -1).every((e: any) => e.resumable === "continue" && e.progress.phase === "rolling back")).toBe(true);
    for (const execution of w.executions.filter(e => e.actionId === "transfer.push.control")) expect(execution.output).toBeLessThanOrEqual(execution.limit);
    expect(phases).toEqual(["complete", "rollback_reset", "rollback_reset_files", "rollback_preflight_tables", "rollback_preflight_files", "rollback_tables", "rollback_files", "rollback_ready"]);
    expect(destination.site.get("wp-content/uploads/2024/01/f0.jpg")!.toString()).toBe("old 0");
    expect(destination.site.has("wp-content/uploads/2024/01/f1.jpg")).toBe(false);
  });

  test("a rollback an earlier build left half done continues where it stopped", async () => {
    const { w, destination } = await completedPush(40);
    const job = destination.imports.get(IMPORT)!;
    // 0.7.0 stopped after one request per run: the import waits in rollback_reset_files, fenced.
    Object.assign(job, { phase: "rollback_reset_files", cursor: 17 });
    const seen = new Set<string>();
    destination.onRequest = () => seen.add(destination.imports.get(IMPORT)!.phase);
    const result = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "rollback" });
    expect((result as any).output.phase).toBe("rolled_back");
    expect(seen.has("rollback_reset")).toBe(false);
    expect(destination.site.get("wp-content/uploads/2024/01/f0.jpg")!.toString()).toBe("old 0");
  });

  test("a refused rollback and a staged import's cancel end cleanly", async () => {
    const { w, destination } = await completedPush(3);
    destination.imports.get(IMPORT)!.rollbackRefused = true;
    const refused = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "rollback" });
    expect((refused as any).output).toMatchObject({ status: "failed", error: { message: "The destination changed after this import. Rollback was refused before changing data." } });
  });

  test("cleanup repeats until the site reports it done", async () => {
    const { w, destination } = await completedPush(3);
    (destination.options as any).cleanupCalls = 7;
    const result = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "cleanup" });
    expect((result as any).output).toMatchObject({ control: "cleanup", cleanedUp: true });
    expect(destination.imports.get(IMPORT)!.requests.cleanup).toBe(7);
  });

  test("finish reconciles an already completed import without another write", async () => {
    const { w, destination } = await completedPush(3);
    destination.log.length = 0;
    const result = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "finish" });
    expect(result.status).toBe("succeeded");
    expect((result as any).output.phase).toBe("complete");
    expect(destination.log.map(l => `${l.method} ${l.route}`)).toEqual(["GET /status", `GET /imports/${IMPORT}`]);
  });

  test("finish accepts a legacy full import acknowledgment above the host's default 1 MiB", async () => {
    const { w, destination } = await completedPush(3);
    const artifacts = Array.from({ length: 10969 }, (_, i) => ({ path: `wp-content/plugins/example/vendor/${"a".repeat(90)}/file-${i}.php`, bytes: 1234, sha256: "a".repeat(64) }));
    let receivedBytes = 0;
    w.services["network.fetch"] = async (input, context) => {
      const response = await w.serve("network.fetch", input, context.effect);
      if (input.method === "GET" && String(input.url).endsWith(`/imports/${IMPORT}`)) {
        const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(response.bodyBase64, "base64").toString()), artifacts }));
        receivedBytes = bytes.length;
        return { ...response, bodyBase64: bytes.toString("base64") };
      }
      return response;
    };
    const result = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "finish" });
    expect(receivedBytes).toBeGreaterThan(1048576);
    expect(result.status).toBe("succeeded");
    expect((result as any).output.phase).toBe("complete");
    expect(destination.log.filter(l => l.route.endsWith("/finish"))).toHaveLength(0);
  });

  test("a lost finish answer reconciles completion on retry instead of repeating finish", async () => {
    const { w, destination } = await completedPush(3);
    destination.imports.get(IMPORT)!.phase = "verification_required";
    destination.log.length = 0;
    w.loseResponses.push({ method: "POST", pattern: /\/finish$/, count: 1 });
    const result = await w.run("transfer.push.control", { siteId: "external:dest", importId: IMPORT, control: "finish" });
    expect(result.status).toBe("succeeded");
    expect((result as any).output.phase).toBe("complete");
    expect(destination.log.filter(l => l.route.endsWith("/finish"))).toHaveLength(1);
    expect(destination.log.filter(l => l.route === `/imports/${IMPORT}`)).toHaveLength(2);
  });
});

describe("files Zoer Connect refuses", () => {
  test("the review reason reads as sentences and lists as many skipped files as fit", () => {
    expect(statsText({ replacements: 42, files: 1, tableRows: 12, label: "x" })).toBe("42 replacements, 1 file, 12 table rows");
    const many = { count: 140, reason: "not accepted by Zoer Connect", files: Array.from({ length: 20 }, (_, i) => ({ path: `wp-content/plugins/plugin-${i}/.htaccess`, reason: "hidden file or folder" })) };
    const reason = waitingReason({ phase: "review_required", stats: { replacements: 42 }, skipped: many }, "Approve or roll back in WordPress Manager.");
    expect(reason.length).toBeLessThanOrEqual(500);
    expect(reason).toStartWith("Review the import before it is activated. Destination: 42 replacements. 140 files skipped (not accepted by Zoer Connect): wp-content/plugins/plugin-0/.htaccess, ");
    expect(reason).toMatch(/ and 1\d\d more\. Approve or roll back in WordPress Manager\.$/);
    expect(waitingReason({ phase: "verification_required" }, "Then finish or roll back the import in WordPress Manager.")).toBe("Verify the destination site. Then finish or roll back the import in WordPress Manager.");
  });

  const corpus = [
    "wp-content/plugins/akismet/.htaccess", "wp-content/uploads/.htaccess", "wp-content/themes/t/.gitignore", "wp-content/plugins/a/.github/workflows/ci.yml",
    "wp-content/plugins/a/.trash/x.php", "wp-content/uploads/2024/index.php", "wp-content/uploads/shell.php5", "wp-content/uploads/a.phtml.jpg",
    "wp-content/plugins/zoer-connect/zoer-connect.php", "wp-content/plugins/ZOER-CONNECT/x.php", "wp-content/plugins/a/wp-config.php", "wp-content/mu-plugins/x.php",
    "wp-content/uploads/a%20b.jpg", "wp-content/uploads/a\\b.jpg", `wp-content/uploads/${"x".repeat(490)}.jpg`,
    "wp-content/themes/t/style.css", "wp-content/plugins/a/a.php", "wp-content/uploads/2024/01/photo (1).jpg", "wp-content/uploads/é-ü.jpg",
    "wp-content/uploads/[x]~!&'=#+@,.jpg", "wp-content/plugins/a/index.php", "wp-content/uploads/archive.tar.gz",
  ];

  test("match the plugin's own rules (StageStore::validateManifest, run with PHP when available)", async () => {
    const php = Bun.which("php");
    if (!php) return;
    const script = `require ${JSON.stringify(new URL("../wordpress-plugins/zoer-connect/includes/StageStore.php", import.meta.url).pathname)};$out=[];foreach(json_decode(stream_get_contents(STDIN),true) as $p){try{\\ZoerConnect\\StageStore::validateManifest(['version'=>1,'target'=>'t','files'=>[['path'=>$p,'bytes'=>0,'sha256'=>hash('sha256','')]]],'t');$out[]=null;}catch(\\Throwable $e){$out[]=$e->getMessage();}}echo json_encode($out);`;
    const run = Bun.spawnSync([php, "-r", script], { stdin: Buffer.from(JSON.stringify(corpus)) });
    const plugin = JSON.parse(run.stdout.toString()) as (string | null)[];
    expect(corpus.map(path => connectRefusal(path) !== null)).toEqual(plugin.map(message => message !== null));
    expect(plugin[0]).toBe("Unsafe file path.");
  });

  test("a pull with a plugin's .htaccess pushes without it and says so before review", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example"));
    source.options.files["wp-content/plugins/akismet/.htaccess"] = "Deny from all";
    const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {} }));
    await pulled(w);
    expect(w.sets.get(`fs_${PULL}`).entries.some(e => e.path === "wp-content/plugins/akismet/.htaccess")).toBe(true);
    const options = { replacements: { automatic: true, variants: false, paths: false, custom: [] }, fence: "activation", review: true };
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, importOptions: options, confirmTarget: "https://dest.example", replacementAccepted: true });
    expect(result.status).toBe("needs-user");
    expect((result as any).reason).toBe("Review the import before it is activated. Destination: 4 files, 42 rows. 3 files skipped (not accepted by Zoer Connect): wp-content/themes/twentyone/.gitignore, wp-content/uploads/2024/index.php, wp-content/plugins/akismet/.htaccess. Approve or roll back in WordPress Manager.");
    expect(destination.imports.get(IMPORT)!.manifest.files.map((f: any) => f.path)).not.toContain("wp-content/plugins/akismet/.htaccess");
  });
});

describe("line protocol and response mapping", () => {
  test("runtime refusals keep Zoer's message and code; only transport failures retry", () => {
    const refusal = (message: string, code: string) => runtimeError(Object.assign(new Error(message), { name: "HostCallError", code }));
    expect(refusal("Runtime operation args are invalid: /database must be object", "invalid_request")).toMatchObject({ message: "Runtime operation args are invalid: /database must be object", code: "invalid_request" });
    expect(refusal("Runtime operation args are invalid: /database must be object", "invalid_request").transient).toBeUndefined();
    expect(refusal("Invalid source URL.", "database_query_failed").transient).toBeUndefined();
    expect(refusal("Export expired. Start a new export.", "database_query_failed").transient).toBeUndefined();
    expect(refusal("Runtime RPC budget exhausted.", "capability_denied").transient).toBeUndefined();
    for (const message of ["DDEV bridge request failed (502).", "DDEV bridge request failed (429).", "fetch failed", "Unable to connect. Is the computer able to access the url?", "The operation timed out."]) {
      expect(refusal(message, "database_query_failed")).toMatchObject({ message, code: "database_query_failed", transient: true });
    }
    expect(refusal("", "ECONNRESET")).toMatchObject({ message: "The DDEV bridge could not complete this operation.", transient: true });
  });

  test("tickets rotate per grant, including after a refusal", async () => {
    const seen: string[] = [];
    const host = createTicketHost({ grants: { network: { ticket: "n0" }, filesets: { ticket: "f0" }, runtimes: [{ alias: "wordpress_site", ticket: "w0" }] } }, async (message: any) => {
      seen.push(message.input.ticket);
      const next = message.input.ticket.replace(/\d+$/, (n: string) => String(Number(n) + 1));
      return message.method === "fileset.read" ? { kind: "host-response", requestId: message.requestId, ok: false, error: { code: "fileset_not_found", message: "gone" }, nextTicket: next } : { kind: "host-response", requestId: message.requestId, ok: true, result: {}, nextTicket: next };
    });
    await host.call("network.fetch", {});
    await expect(host.call("fileset.read", {})).rejects.toMatchObject({ code: "fileset_not_found" });
    await host.call("fileset.describe", {});
    await host.call("runtime.invoke", { alias: "wordpress_site" });
    await host.call("network.fetch", {});
    expect(seen).toEqual(["n0", "f0", "f1", "w0", "n1"]);
    await expect(host.call("catalog.read", {})).rejects.toMatchObject({ code: "capability_denied" });
  });

  test("the pause notice riding on host responses is kept, also from a refusal", async () => {
    const pause = { reason: "maintenance", graceSeconds: 60, drainId: "user-pause:run-1" };
    let paused = false;
    const host = createTicketHost({ grants: { network: { ticket: "n0" } } }, async (message: any) => paused
      ? { kind: "host-response", requestId: message.requestId, ok: false, error: { code: "ZOER_PAUSED", message: "Paused for Zoer update" }, pause }
      : { kind: "host-response", requestId: message.requestId, ok: true, result: {} });
    await host.call("network.fetch", {});
    expect(host.pauseRequested).toBeNull();
    paused = true;
    await expect(host.call("network.fetch", {})).rejects.toMatchObject({ code: "ZOER_PAUSED" });
    expect(host.pauseRequested).toEqual(pause);
  });

  test("Zoer Connect answers map to the host engine's messages and retry rules", () => {
    const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers, bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64") });
    expect(() => mapConnectResponse("/status", "GET", answer(401, {}))).toThrow("WordPress rejected this key.");
    expect(() => mapConnectResponse("/exports/x/chunks", "GET", answer(410, {}))).toThrow("The remote export is missing or expired. Start a new pull.");
    let error: any;
    try { mapConnectResponse("/exports", "POST", answer(409, { code: "zoer_export_blocked", message: "Export busy, retry" })); } catch (e) { error = e; }
    expect(error).toMatchObject({ message: "Export busy, retry", transient: true });
    try { mapConnectResponse("/imports/x/batch", "POST", answer(413, { limits: { maxBatchBytes: 1048576 } })); } catch (e) { error = e; }
    expect(error.details.maxBatchBytes).toBe(1048576);
    try { mapConnectResponse("/imports/x/step", "POST", answer(422, { code: "zoer_import_table", message: "Table /var/www/html/wp-config.php missing", phase: "importing" })); } catch (e) { error = e; }
    expect(error.message).toBe("Table [path] missing");
    try { mapConnectResponse("/imports/x/step", "POST", answer(503, {}, { "retry-after": "12" })); } catch (e) { error = e; }
    expect(error).toMatchObject({ transient: true, retryAfterMs: 12000 });
  });

  test("an oversized acknowledgment is not mislabeled as an unreachable site or retried blindly", async () => {
    const host = { call: async () => { throw Object.assign(new Error("Network response exceeded its size limit."), { name: "HostCallError", code: "database_query_failed" }); } };
    const client = connectClient(host, { id: "external:dest", generation: "g1", origin: "https://dest.example" });
    const error = await client.request(`/imports/${IMPORT}/finish`, "POST").catch(e => e);
    expect(error).toMatchObject({ code: "network_response_limit" });
    expect(isTransient(error)).toBe(false);
    expect(error.message).toContain("The operation may have completed.");
  });
});

describe("large pull completion and recovery", () => {
  test("a fully downloaded set checkpoints before slow verification and recovers a sealed receipt", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example"));
    const input = { siteId: "hostinger-1", pullId: PULL };
    const first = await w.run("transfer.pull", input, { maxSlices: 2 });
    expect(first.envelopes[1]).toMatchObject({ resumable: "continue", checkpoint: { phase: "sealing" }, progress: { phase: "sealing", unit: "files" } });
    expect(w.calls.filter(c => c.method === "fileset.seal")).toHaveLength(0);
    // The host completes verification, but the worker is lost before recording its result.
    w.sets.seal({ setId: `fs_${PULL}` });
    const previous = source.log.length;
    const recovered = await w.run("transfer.pull", { ...input, recover: true }, { runId: "recovered" });
    expect(recovered.status).toBe("succeeded");
    expect(recovered.output).toMatchObject({ status: "ready", setId: `fs_${PULL}` });
    expect(source.log.slice(previous).map(e => e.route)).toEqual(["/status"]);
    expect(w.catalog.records.get(`pull:${PULL}`)?.data.status).toBe("ready");
  });

  test("recovery refuses different ownership or selection without removing the saved set", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example"));
    const input = { siteId: "hostinger-1", pullId: PULL };
    await w.run("transfer.pull", input, { maxSlices: 2 });
    w.sets.seal({ setId: `fs_${PULL}` });
    const record = w.catalog.records.get(`pull:${PULL}`)!;
    record.data.siteId = "other-site";
    const refused = await w.run("transfer.pull", { ...input, recover: true });
    expect(refused.status).toBe("failed");
    expect(w.sets.get(`fs_${PULL}`).status).toBe("sealed");
  });

  test("bounded verification keeps yielding until the host reports sealed", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example"));
    const seal = w.sets.seal.bind(w.sets);
    let calls = 0, now = Date.now();
    w.sets.seal = (input: any) => {
      now += 20_000;
      return ++calls < 3 ? { set: w.sets.summary(w.sets.get(input.setId)), verification: { done: calls, total: 7 } } : seal(input);
    };
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock: () => now, deadlineMs: 40_000 });
    expect(result.status).toBe("succeeded");
    expect(calls).toBe(3);
    expect(result.envelopes.filter((e: any) => e.progress?.phase === "sealing")).toHaveLength(3);
    expect(w.calls.filter(c => c.method === "fileset.seal").every(c => c.input.bounded === true)).toBe(true);
  });
});

test("a host network deadline yields the saved checkpoint without spending a retry", async () => {
  const w = new FakeWorld();
  w.addSite("hostinger-1", sampleSite("https://source.example"));
  const serve = w.serve.bind(w);
  let requests = 0;
  w.serve = async (method: string, input: any, effect: string) => {
    if (method === "network.fetch" && ++requests === 4) throw Object.assign(new Error("Fresh slice needed"), { name: "HostCallError", code: "network_deadline" });
    return serve(method, input, effect);
  };
  const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL });
  expect(result.status).toBe("succeeded");
  expect(result.envelopes[0]).toMatchObject({ resumable: "continue", checkpoint: { remoteCreated: true } });
  expect(result.envelopes.some((e: any) => e.resumable === "retry")).toBe(false);
});

test("storage exhaustion keeps the inbound checkpoint for Resume", async () => {
  const w = new FakeWorld();
  w.addSite("hostinger-1", sampleSite("https://source.example"));
  w.services["transfer.download"] = () => { throw Object.assign(new Error("Transfer quota exceeded"), { name: "HostCallError", code: "fileset_quota" }); };
  const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL });
  expect(result.status).toBe("needs-user");
  expect(result.checkpoint.phase).toBe("downloading");
  expect(w.sets.sets.has(`fs_${PULL}`)).toBe(true);
  delete w.services["transfer.download"];
  expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { checkpoint: result.checkpoint })).status).toBe("succeeded");
});

test("creating a local copy retains its source checkpoint during a long outage", async () => {
  const w = new FakeWorld();
  w.addSite("hostinger-1", sampleSite("https://source.example"));
  const lost = { pattern: /\/step$/, method: "POST", count: 99 };
  w.loseResponses.push(lost);
  const input = { siteId: "hostinger-1", copyId: COPY, name: "Outage recovery" };
  const result = await w.run("copy.local", input);
  expect(result.status).toBe("needs-user");
  expect(result.reason).toContain("Saved progress is kept");
  lost.count = 0;
  expect((await w.run("copy.local", input, { checkpoint: result.checkpoint })).status).toBe("succeeded");
});
