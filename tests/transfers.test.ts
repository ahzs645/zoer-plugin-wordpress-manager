import { describe, expect, test } from "bun:test";
import { FakeWorld } from "./fakes/host";
import { BLOCK, FakeZoerConnect, sampleSite, sha } from "./fakes/zoer-connect";
import { writeZip } from "./fakes/zip";
import { createTicketHost } from "../plugin/worker/lib/host.js";
import { mapConnectResponse } from "../plugin/worker/lib/zoer-connect.js";
import { validatePullFiles } from "../plugin/worker/lib/files.js";
import { defaultExportOptions } from "../plugin/worker/lib/options.js";
import { preparationMessage } from "../plugin/worker/lib/pull.js";
import { runtimeError } from "../plugin/worker/lib/slices.js";
import { EXPORT_CREATE_INPUT_SCHEMA, schemaIssues } from "./fakes/ddev-schemas";

const PULL = "a".repeat(32), PULL2 = "b".repeat(32), IMPORT = "c".repeat(32), COPY = "d".repeat(32), PREVIEW = "e".repeat(32), RESTORE = "f".repeat(32);

function world() {
  const w = new FakeWorld();
  const source = w.addSite("hostinger-1", sampleSite("https://source.example"));
  const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {}, existing: { "wp-content/themes/twentyone/style.css": "body{color:red}", "wp-content/plugins/akismet/akismet.php": "old" } }));
  return { w, source, destination };
}
async function pulled(w: FakeWorld, siteId = "hostinger-1", pullId = PULL) {
  w.catalog.engine(siteId);
  const result = await w.run("transfer.pull", { siteId, pullId });
  expect(result.status).toBe("succeeded");
  return result.output as any;
}

describe("engine gate", () => {
  test("every site stays on the legacy engine until it is switched as a test target", async () => {
    const { w } = world();
    const refused = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL });
    expect(refused.status).toBe("failed");
    expect((refused as any).error.message).toContain("legacy transfer engine");
    expect(w.calls.some(c => c.method === "network.fetch")).toBe(false);
    expect([...w.catalog.records.keys()].some(id => id.startsWith("history:"))).toBe(false);
    w.catalog.engine("hostinger-1", "plugin", false);
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL })).status).toBe("failed");
    w.catalog.engine("hostinger-1", "legacy", true);
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL })).status).toBe("failed");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
    const clock = timed(source);
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock });
    expect(result.status).toBe("succeeded");
    // Create, six polls until ready, the download and the seal: all in the first slice.
    expect(result.envelopes).toHaveLength(1);
    expect(steps(source)).toBe(6);
    expect(source.log.filter(l => l.method === "POST" && l.route === "/exports")).toHaveLength(1);
    // The polls report preparation progress inside the slice.
    expect(w.calls.filter(c => c.method === "run.progress").map(c => c.input.progress.phase)).toEqual(Array(5).fill("preparing"));
  });

  test("the slice yields when its budget runs out and the next slice keeps polling at once", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 80 }));
    w.catalog.engine("hostinger-1");
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
    expect(rest.envelopes).toHaveLength(1);
    expect(steps(source)).toBe(80);
    // Created once; the later slice only polled.
    expect(source.log.filter(l => l.method === "POST" && l.route === "/exports")).toHaveLength(1);
  });

  test("fast bridge polls stop below Zoer's runtime call budget per slice", async () => {
    const w = new FakeWorld();
    const content = sampleSite("https://shop.ddev.site", { exportSteps: 450 });
    w.ddev.add("ddev-shop", "shop", content);
    w.catalog.engine("ddev-shop");
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
    w.catalog.engine("ddev-shop");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
    const result = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { clock: timed(source) });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes).toHaveLength(1);
    // Four polls to ready, then a poll before each further page (the host engine's order).
    const routes = source.log.map(l => l.route.replace(/\?.*$/, "")).filter(r => r !== "/status" && !r.endsWith("/batch"));
    expect(routes).toEqual(["/exports/paged", ...Array(4).fill(`/exports/paged/${PULL}/step`), `/exports/paged/${PULL}/manifest`,
      ...Array(3).fill([`/exports/paged/${PULL}/step`, `/exports/paged/${PULL}/manifest`]).flat()]);
  });

  test("local exports poll the DDEV bridge within one slice", async () => {
    const w = new FakeWorld();
    const content = sampleSite("https://shop.ddev.site", { exportSteps: 5 });
    w.ddev.add("ddev-shop", "shop", content);
    w.catalog.engine("ddev-shop");
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL }, { clock: timed(content) });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes).toHaveLength(1);
    expect(w.calls.filter(c => c.method === "runtime.invoke").map(c => c.input.operation)).toEqual(["runtime.inspect.v1", "export.create.v1", ...Array(4).fill("export.step.v1")]);
  });

  test("copy.local prepares its embedded pull in one slice and labels the progress", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 6 }));
    w.catalog.engine("hostinger-1");
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" }, { clock: timed(source) });
    expect(result.status).toBe("succeeded");
    expect(steps(source)).toBe(6);
    // Only the DDEV site start waits between slices; the pull never does.
    expect(result.envelopes.filter((e: any) => String(e.progress?.phase).startsWith("pulling"))).toHaveLength(0);
    expect(w.calls.filter(c => c.method === "run.progress").map(c => c.input.progress.phase)).toEqual(Array(5).fill("pulling: preparing"));
  });
});

describe("deleting a pull", () => {
  test("removes the file set, the record and the export on the site, so the site accepts the next export", async () => {
    const w = new FakeWorld();
    const source = w.addSite("hostinger-1", sampleSite("https://source.example", { singleExport: true, pagedExport: true }));
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("ddev-shop");
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL })).status).toBe("succeeded");
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 }) as any).error.message).toBe("Cancel an existing source export before starting another.");
    const removed = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, remove: true });
    expect((removed as any).output).toMatchObject({ status: "deleted", remoteRemoved: true });
    expect(w.ddev.invocations.filter(i => i.operation === "export.cancel.v1").map(i => i.args)).toContainEqual({ exportId: PULL });
    expect((await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL2 })).status).toBe("succeeded");
  });

  test("a running transfer is not deleted", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", sampleSite("https://source.example", { exportSteps: 3 }));
    w.catalog.engine("hostinger-1");
    w.catalog.records.set(`pull:${PULL}`, { id: `pull:${PULL}`, kind: "pull", title: "p", data: { siteId: "hostinger-1", status: "downloading", setId: `fs_${PULL}` } } as any);
    expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL, remove: true }) as any).error.message).toBe("This transfer is still running. Cancel it instead.");
  });
});

describe("transfer.preview and transfer.push", () => {
  const confirm = { confirmTarget: "https://dest.example", replacementAccepted: true };
  test("preview classifies files against the destination and stores pages", async () => {
    const { w, destination } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
    const result = await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: PREVIEW });
    expect(result.status).toBe("succeeded");
    expect((result as any).output.counts).toEqual({ new: 4, changed: 1, unchanged: 1, blocked: 0, database: 1 });
    const page = w.catalog.records.get(`preview-page:${PREVIEW}:0`)!.data.files;
    expect(page.find((f: any) => f.path === "wp-content/plugins/akismet/akismet.php").state).toBe("changed");
    expect(destination.log.filter(l => l.route === "/files/compare")).toHaveLength(1);
  });

  test("push uploads with ZBT1 batches, steps the import and finishes byte-identical", async () => {
    const { w, source, destination } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ status: "complete", importId: IMPORT, fileCount: 7 });
    for (const [path, data] of Object.entries(source.options.files)) {
      if (path === "database.sql") expect(sha(destination.database!)).toBe(sha(Buffer.from(data)));
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

  test("review pauses the push for the user; approve through push.control, then resume completes", async () => {
    const { w, destination } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
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
    w.catalog.engine("external:dest");
    await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: PREVIEW });
    const selectedPaths = ["wp-content/uploads/2024/01/photo.jpg", "database.sql"];
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, previewId: PREVIEW, selectedPaths, ...confirm });
    expect(result.status).toBe("succeeded");
    const manifest = destination.imports.get(IMPORT)!.manifest;
    expect(manifest.files.map((f: any) => f.path)).toEqual(["wp-content/uploads/2024/01/photo.jpg"]);
    expect(manifest.files[0].expectedDestinationSha256).toBeNull();
    expect(manifest.resources).toMatchObject({ plugins: false, themes: false });
    expect(destination.site.get("wp-content/uploads/2024/01/photo.jpg")!.length).toBe(BLOCK * 2 + 12345);
  });

  test("the import ID is checkpointed before the import is created; a lost answer picks up the same import", async () => {
    const { w, destination } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
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
    w.catalog.engine("external:dest");
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm }, { onSlice: (_e, slice) => { if (slice === 1) w.catalog.records.get(`pull:${PULL}`)!.data.source.prefix = "wp2_"; } });
    expect((result as any).error.message).toBe("The download, the destination or the selection changed before the import was created. Start the push again.");
    expect(destination.imports.size).toBe(0);
  });

  test("dry run plans the push and sends nothing that writes", async () => {
    const { w, destination } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, dryRun: true, ...confirm });
    expect((result as any).output).toMatchObject({ status: "dry-run", plan: { files: 6, database: true, batchUpload: true } });
    expect(destination.log.map(l => l.route)).toEqual(["/status"]);
    expect(destination.imports.size).toBe(0);
  });

  test("changed key parks the import with the host engine's recovery message", async () => {
    const { w } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
    const result = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm }, { onSlice: (_e, slice) => { if (slice === 1) w.rotateKey("external:dest"); } });
    // The first slice may already have finished the small import; otherwise the next slice parks.
    if (result.status !== "succeeded") expect((result as any).reason).toBe("Connection changed. Restore the original connection to recover this import.");
  });

  test("destination confirmation, policy and source checks match the host engine", async () => {
    const { w } = world();
    await pulled(w);
    w.catalog.engine("external:dest");
    const wrong = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://other.example", replacementAccepted: true });
    expect((wrong as any).error.message).toBe("Confirm the exact destination address.");
    const noPolicy = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://dest.example" });
    expect((noPolicy as any).error.message).toContain("confirm the destination replacement policy");
    w.catalog.engine("hostinger-1");
    const same = await w.run("transfer.push", { siteId: "hostinger-1", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://source.example", replacementAccepted: true });
    expect((same as any).error.message).toContain("Choose a different source");
  });
});

describe("copy.local", () => {
  test("pulls, creates a DDEV site, stages verified files, imports and verifies", async () => {
    const { w, source } = world();
    w.catalog.engine("hostinger-1");
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

  test("refresh takes a recovery backup first and reuses the copy", async () => {
    const { w } = world();
    w.catalog.engine("hostinger-1");
    const first = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop" });
    const targetId = (first as any).output.targetId;
    const refresh = await w.run("copy.local", { siteId: "hostinger-1", copyId: PULL2, replaceSiteId: targetId });
    expect(refresh.status).toBe("succeeded");
    expect((refresh as any).output.targetId).toBe(targetId);
    expect(w.ddev.sites.get(targetId)!.backups).toBe(1);
  });

  test("a failed command parks the copy with its message; resume continues the same destination", async () => {
    const { w } = world();
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("hostinger-1");
    const result = await w.run("copy.local", { siteId: "hostinger-1", copyId: COPY, name: "Shop", dryRun: true });
    expect((result as any).output).toMatchObject({ status: "dry-run", siteName: `zoer-dryrun-${COPY.slice(0, 8)}`, targetUrl: null });
    expect([...w.ddev.sites.values()][0]!.state).toBe("archived");
    expect(w.sets.sets.size).toBe(0);
    expect(w.catalog.records.has(`local-copy:${COPY}`)).toBe(false);
  });

  test("an executable upload that is not a placeholder is refused before anything is created", async () => {
    const w = new FakeWorld();
    w.addSite("hostinger-1", new FakeZoerConnect({ origin: "https://source.example", files: { "database.sql": "x", "wp-content/uploads/index.php": "<?php echo 1;" } }));
    w.catalog.engine("hostinger-1");
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
    w.catalog.engine("ddev-shop");
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("succeeded");
    expect((result as any).output).toMatchObject({ kind: "local-export", status: "ready", fileCount: 7 });
    expect(w.calls.filter(c => c.method === "runtime.invoke").map(c => c.input.operation)).toEqual(["runtime.inspect.v1", "export.create.v1"]);
    expect(w.calls.find(c => c.method === "transfer.download")!.input.source).toEqual({ runtime: { alias: "wordpress_site", resourceId: "ddev-shop", operation: "export.chunk.v1", args: { exportId: PULL } } });
  });

  test("default options send the host engine's body, valid against Zoer's export.create.v1 schema", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.catalog.engine("ddev-shop");
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
    expect(schemaIssues(EXPORT_CREATE_INPUT_SCHEMA, { ...args, database: true })).toEqual(["/database must be object"]);
  });

  test("database filters reach the bridge as filters", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.catalog.engine("ddev-shop");
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
    w.catalog.engine("ddev-shop");
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

  test("a run that gives up after repeated transient failures leaves a failed history record", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.catalog.engine("ddev-shop");
    w.ddev.failOperation = { operation: "export.create.v1", message: "DDEV bridge request failed (503).", code: "database_query_failed", count: 99 };
    let recordedAt = 0;
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL }, { onSlice: (_e, slice) => { if (!recordedAt && w.catalog.records.has(`history:local-export:${PULL}`)) recordedAt = slice; } });
    expect(result.status).toBe("failed");
    expect(result.envelopes).toHaveLength(9);
    // Only the slice whose retry Zoer refuses (the 9th) writes it.
    expect(recordedAt).toBe(9);
    expect(w.catalog.records.get(`history:local-export:${PULL}`)!.data).toMatchObject({ status: "failed", lastError: "DDEV bridge request failed (503).", errorCode: "database_query_failed" });
  });

  test("a bridge transport failure retries with the bridge's message and code", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.catalog.engine("ddev-shop");
    w.ddev.failOperation = { operation: "export.create.v1", message: "DDEV bridge request failed (502).", code: "database_query_failed", count: 1 };
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL });
    expect(result.status).toBe("succeeded");
    expect(result.envelopes[0]).toMatchObject({ resumable: "retry", error: { code: "database_query_failed", message: "DDEV bridge request failed (502)." } });
  });

  test("an export without the database is refused before anything starts", async () => {
    const w = new FakeWorld();
    w.ddev.add("ddev-shop", "shop", sampleSite("https://shop.ddev.site"));
    w.catalog.engine("ddev-shop");
    const options = defaultExportOptions();
    options.resources.database = false;
    const result = await w.run("transfer.local-export", { siteId: "ddev-shop", pullId: PULL, exportOptions: options });
    expect((result as any).error.message).toBe("Local exports include the database on this Zoer release. Select the database and start the export again.");
    expect(w.ddev.invocations.some(i => i.operation === "export.create.v1")).toBe(false);
    expect(w.catalog.records.get(`history:local-export:${PULL}`)!.data).toMatchObject({ status: "failed", lastError: "Local exports include the database on this Zoer release. Select the database and start the export again.", summary: "Local export: Themes, plugins, media" });
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
  });
  test("an incomplete set is refused with the host engine's message", async () => {
    const w = new FakeWorld();
    const setId = w.sets.sealed("Updraft", { "backup_x-db.gz": "x" });
    const result = await w.run("backup.restore-local", { uploadSetId: setId, restoreId: RESTORE, name: "Restored" });
    expect((result as any).error.message).toBe("select one database, plugins, themes, uploads, and others backup file");
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
});
