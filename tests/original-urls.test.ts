import { describe, expect, test } from "bun:test";
import { FakeWorld } from "./fakes/host";
import { FakeZoerConnect, sampleSite } from "./fakes/zoer-connect";

const PULL = "a".repeat(32), IMPORT = "c".repeat(32);
const confirm = { confirmTarget: "https://dest.example", replacementAccepted: true };

async function pushManifest(source: FakeZoerConnect) {
  const w = new FakeWorld();
  w.addSite("hostinger-1", source);
  const destination = w.addSite("external:dest", new FakeZoerConnect({ origin: "https://dest.example", files: {} }));
  expect((await w.run("transfer.pull", { siteId: "hostinger-1", pullId: PULL })).status).toBe("succeeded");
  expect((await w.run("transfer.push", { siteId: "external:dest", setId: `fs_${PULL}`, importId: IMPORT, ...confirm })).status).toBe("succeeded");
  return { record: w.catalog.records.get(`pull:${PULL}`)!.data, manifest: destination.imports.get(IMPORT)!.manifest };
}

describe("source siteurl (WordPress in a subdirectory)", () => {
  test("the export's original URLs are kept on the pull and sent with the push", async () => {
    const { record, manifest } = await pushManifest(sampleSite("https://source.example", { siteUrl: "https://source.example/wp" }));
    expect(record.source).toMatchObject({ url: "https://source.example", originalUrls: ["https://source.example/wp"] });
    expect(manifest).toMatchObject({ sourceUrl: "https://source.example", originalUrls: ["https://source.example/wp"] });
  });

  test("a source whose siteurl is its home sends no original URLs", async () => {
    const { manifest } = await pushManifest(sampleSite("https://source.example"));
    expect(manifest).toMatchObject({ sourceUrl: "https://source.example", originalUrls: [] });
  });
});
