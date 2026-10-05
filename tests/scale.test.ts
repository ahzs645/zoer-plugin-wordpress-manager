import { describe, expect, test } from "bun:test";
import { FakeWorld } from "./fakes/host";
import { FakeZoerConnect } from "./fakes/zoer-connect";
import { OUTPUT_LIMITS } from "../plugin/worker/lib/actions.js";
import manifest from "../plugin/manifest.json";

const PULL = "a".repeat(32), IMPORT = "c".repeat(32), PREVIEW = "e".repeat(32);
const FILES = 20_000;

/** A source with 20k media files (paged manifest, 500 per page) and a destination holding a few of them. */
function largeWorld() {
  const files: Record<string, string> = { "database.sql": "-- db\n" };
  for (let i = 0; i < FILES; i++) files[`wp-content/uploads/2024/${String(i % 12 + 1).padStart(2, "0")}/image-${i}-1024x768.jpg`] = `jpeg ${i}`;
  const existing: Record<string, string> = {};
  for (let i = 0; i < FILES; i += 50) existing[`wp-content/uploads/2024/${String(i % 12 + 1).padStart(2, "0")}/image-${i}-1024x768.jpg`] = i % 100 ? `jpeg ${i}` : "older";
  const w = new FakeWorld();
  w.addSite("hostinger-1", new FakeZoerConnect({ origin: "https://source.example", files, pagedExport: true, pageSize: 500 }));
  const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {}, existing }));
  w.catalog.engine("hostinger-1");
  w.catalog.engine("external:dest");
  return { w, destination };
}

function expectWithinLimits(w: FakeWorld, actionId: string) {
  const executions = w.executions.filter(e => e.actionId === actionId);
  expect(executions.length).toBeGreaterThan(0);
  for (const execution of executions) {
    expect(execution.limit).toBe(OUTPUT_LIMITS[actionId as keyof typeof OUTPUT_LIMITS]);
    expect(execution.output).toBeLessThanOrEqual(execution.limit);
    expect(execution.checkpointBytes).toBeLessThanOrEqual(65536);
  }
  return executions;
}

describe("a 20,000-file site stays within Zoer's output and checkpoint limits", () => {
  test("pull, preview and push", async () => {
    const { w, destination } = largeWorld();
    const pulled = await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL }, { maxSlices: 500 });
    expect(pulled.status).toBe("succeeded");
    expect((pulled as any).output.fileCount).toBe(FILES + 1);
    expectWithinLimits(w, "transfer.pull");

    const preview = await w.run("transfer.preview", { siteId: "external:dest", setId: `fs_${PULL}`, previewId: PREVIEW }, { maxSlices: 500 });
    expect(preview.status).toBe("succeeded");
    expect((preview as any).output.counts).toEqual({ new: FILES - 400, changed: 200, unchanged: 200, blocked: 0, database: 1 });
    // The run's result stays a summary: the classification lives in preview-page records.
    expect(Buffer.byteLength(JSON.stringify((preview as any).output))).toBeLessThan(1024);
    expectWithinLimits(w, "transfer.preview");

    const push = await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://dest.example", replacementAccepted: true }, { maxSlices: 500 });
    expect(push.status).toBe("succeeded");
    expect((push as any).output).toMatchObject({ status: "complete", fileCount: FILES + 1 });
    expect(destination.site.get("wp-content/uploads/2024/01/image-0-1024x768.jpg")!.toString()).toBe("jpeg 0");
    const executions = expectWithinLimits(w, "transfer.push");
    // The 20k-file manifest needs the push's raised limit; every other slice is far below it.
    expect(Math.max(...executions.map(e => e.output))).toBeGreaterThan(4 * 1024 * 1024);
  }, 120_000);

  test("the workers' output limits are the manifest's", () => {
    for (const action of (manifest as any).integration.actions.filter((a: any) => a.resumable)) {
      expect(OUTPUT_LIMITS[action.id as keyof typeof OUTPUT_LIMITS]).toBe(action.resourceLimits.maxOutputBytes);
    }
    // Above 4 MiB Zoer adds `worker:output:<n>` to the permission fingerprint: only Push goes there.
    const raised = (manifest as any).integration.actions.filter((a: any) => (a.resourceLimits?.maxOutputBytes ?? 0) > 4194304).map((a: any) => a.id);
    expect(raised).toEqual(["transfer.push"]);
  });
});
