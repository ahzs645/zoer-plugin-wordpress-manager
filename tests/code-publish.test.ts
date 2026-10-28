import { describe, expect, test } from "bun:test";
import { codeContentIssue, codeExportIssue, codeExportOptions, codeExportOptionsFor, codePathReason } from "../plugin/worker/lib/code-publish.js";
import { defaultExportOptions, defaultImportOptions } from "../src/lib/wordpress-transfer/options";
import { pullOptionsFrom } from "../plugin/worker/lib/options.js";
import { FakeWorld } from "./fakes/host";
import { FakeZoerConnect } from "./fakes/zoer-connect";

const PULL = "1".repeat(32), PREVIEW = "2".repeat(32), IMPORT = "3".repeat(32);
const path = "wp-content/plugins/example/example.php";
const options = () => ({ ...codeExportOptions(defaultExportOptions()), themes: { mode: "selected" as const, items: ["example-theme"] }, plugins: { mode: "selected" as const, items: ["example"] } });
const importOptions = { ...defaultImportOptions(), review: true };

async function prepared(content = "<?php // runtime", extra: Record<string, string> = {}) {
  const w = new FakeWorld();
  const source = w.addSite("source", new FakeZoerConnect({ origin: "https://local.example", files: { [path]: content, ...extra } }));
  const destination = w.addSite("dest", new FakeZoerConnect({ origin: "https://live.example", files: {}, existing: { "wp-content/uploads/keep.jpg": "media", "wp-content/plugins/auth/auth.php": "auth" } }));
  const pulled = await w.run("transfer.pull", { siteId: "source", pullId: PULL, exportOptions: options() });
  expect(pulled.status).toBe("succeeded");
  expect((await w.run("transfer.preview", { siteId: "dest", setId: `fs_${PULL}`, previewId: PREVIEW })).status).toBe("succeeded");
  const input = { siteId: "dest", setId: `fs_${PULL}`, previewId: PREVIEW, importId: IMPORT, selectedPaths: [path], confirmTarget: "https://live.example", replacementAccepted: true, importOptions, codeOnly: true };
  return { w, source, destination, input };
}

describe("portable code publication", () => {
  test("preset removes data and broad selections without mutating the custom draft", () => {
    const draft = defaultExportOptions();
    const code = codeExportOptions(draft);
    expect(code.resources).toEqual({ database: false, themes: true, plugins: true, media: false, muplugins: false, core: false });
    expect(code.themes).toEqual({ mode: "selected", items: [] });
    expect(code.plugins).toEqual({ mode: "selected", items: [] });
    expect(draft.resources.database).toBe(true);
    expect(codeExportIssue(pullOptionsFrom(options()))).toBeNull();
    expect(codeExportIssue(pullOptionsFrom(draft))).toContain("code-only export");
  });

  test("only explicit extension folders qualify; compiled assets and Composer dependencies remain usable", () => {
    const p = pullOptionsFrom(options()).profile;
    for (const file of [path, "wp-content/plugins/example/dist/app.js", "wp-content/plugins/example/vendor/autoload.php", "wp-content/themes/example-theme/assets/font.woff2"]) expect(codePathReason(file, p)).toBeNull();
    for (const file of ["database.sql", "wp-config.php", "wp-content/uploads/a.jpg", "wp-content/mu-plugins/local.php", "wp-content/plugins/auth/auth.php", "wp-content/plugins/example/.env", "wp-content/plugins/example/node_modules/a.js", "wp-content/plugins/example/backups/site.sql.gz", "wp-content/plugins/example/../auth/a.php"]) expect(codePathReason(file, p)).not.toBeNull();
  });

  test("single-resource presets reach export validation without requiring the excluded resource", () => {
    for (const kind of ["themes", "plugins"] as const) {
      const excluded = kind === "themes" ? "plugins" : "themes";
      const draft = defaultExportOptions();
      draft.resources[excluded] = false;
      draft[kind] = { mode: "selected", items: ["example"] };
      const code = codeExportOptions(draft);
      const pull = pullOptionsFrom(code);
      const profile = pull.profile as Record<string, unknown>;
      expect(codeExportIssue(pull)).toBeNull();
      expect(pull.database).toBe(false);
      expect(profile[kind]).toBe(true);
      expect(profile[excluded]).toBe(false);
      expect(profile[kind + "Items"]).toEqual(["example"]);
      expect(profile[excluded + "Mode"]).toBeUndefined();
      expect(codePathReason(`wp-content/${excluded}/example/file.php`, pull.profile)).not.toBeNull();
      // Enabling an empty resource must still fail instead of broadening the export.
      expect(() => pullOptionsFrom(codeExportOptions({ ...draft, [kind]: { mode: "selected", items: [] } }))).toThrow("Choose at least one");
      expect(draft.resources.database).toBe(true);
    }
  });

  test("content checks never echo credentials and ignore the destination hostname", () => {
    const source = { url: "https://local.example", originalUrls: ["http://example.ddev.site"], abspath: "/var/www/html" };
    expect(codeContentIssue('home_url("/portal/")', source, "https://live.example")).toBeNull();
    expect(codeContentIssue("https://live.example/portal/", source, "https://live.example")).toBeNull();
    for (const text of ["https://LOCAL.example/path", "http://example.ddev.site", "/var/www/html/cache"]) expect(codeContentIssue(text, source, "https://live.example")).not.toBeNull();
    const secret = "sk_live_" + "a".repeat(30);
    const issue = codeContentIssue(secret, source, "https://live.example");
    expect(issue).toContain("credential literal");
    expect(issue).not.toContain(secret);
    // Other pushes check portability only.
    expect(codeContentIssue(secret, source, "https://live.example", { credentials: false })).toBeNull();
    expect(codeContentIssue("https://local.example/a.jpg", source, "https://live.example", { credentials: false })).toContain("source-site hostname");
  });

  test("a code export named by slugs matches the Code only export", () => {
    const named = codeExportOptionsFor({ themes: ["example-theme"], plugins: ["example"] });
    expect(pullOptionsFrom(named)).toEqual(pullOptionsFrom(options()));
    expect(codeExportIssue(pullOptionsFrom(codeExportOptionsFor({ plugins: ["example"] })))).toBeNull();
    for (const bad of [undefined, [], {}, { themes: [] }, { plugins: ["../auth"] }, { plugins: "example" }, { plugins: ["example"], media: true }]) expect(codeExportOptionsFor(bad)).toBeNull();
  });

  test("a code-only push without import options stages for review with the Code only defaults", async () => {
    const { w, destination, input } = await prepared();
    const { importOptions: _omitted, ...rest } = input;
    const result = await w.run("transfer.push", { ...rest, dryRun: true });
    expect((result as any).output.plan).toMatchObject({ codeOnly: true, database: false, files: 1 });
    expect(destination.imports.size).toBe(0);
  });

  test("a push without its confirmations names the fields it needs", async () => {
    const { w, input } = await prepared();
    const { replacementAccepted: _policy, ...noPolicy } = input;
    expect((await w.run("transfer.push", { ...noPolicy, dryRun: true }) as any).output.error.message).toContain("replacementAccepted: true");
    expect((await w.run("transfer.push", { ...input, confirmTarget: undefined, dryRun: true }) as any).output.error.message).toBe("Confirm the exact destination address: set confirmTarget to https://live.example.");
  });

  test("dry run scans sealed source and never creates an import", async () => {
    const { w, destination, input } = await prepared();
    const result = await w.run("transfer.push", { ...input, dryRun: true });
    expect(result.status).toBe("succeeded");
    expect((result as any).output.plan).toMatchObject({ codeOnly: true, database: false, files: 1 });
    expect(w.calls.some(c => c.method === "fileset.read")).toBe(true);
    expect(destination.imports.size).toBe(0);
  });

  test("source hostnames crossing a read boundary stop before a destination write", async () => {
    const { w, destination, input } = await prepared(" ".repeat(65530) + "https://local.example/path");
    const result = await w.run("transfer.push", input);
    expect((result as any).output.status).toBe("failed");
    expect((result as any).output.error.message).toContain("source-site hostname");
    expect(destination.imports.size).toBe(0);
  });

  test("tampered data selection, missing comparison and disabled review are refused", async () => {
    for (const change of [{ previewId: undefined }, { importOptions: { ...importOptions, review: false } }]) {
      const { w, destination, input } = await prepared();
      expect((await w.run("transfer.push", { ...input, ...change }) as any).output.status).toBe("failed");
      expect(destination.imports.size).toBe(0);
    }
    const { w, destination, input } = await prepared();
    const record = w.catalog.records.get(`pull:${PULL}`)!;
    record.data.options.database = true;
    expect((await w.run("transfer.push", input) as any).output.status).toBe("failed");
    expect(destination.imports.size).toBe(0);
  });

  test("real code update stages for review and has no database or unrelated files", async () => {
    const { w, destination, input } = await prepared();
    const result = await w.run("transfer.push", input);
    expect(result.status).toBe("needs-user");
    const manifest = destination.imports.get(IMPORT)!.manifest;
    expect(manifest.database).toBeNull();
    expect(manifest.files.map((f: any) => f.path)).toEqual([path]);
    expect(manifest.options).toMatchObject({ review: true, fence: "activation" });
    expect(destination.site.get("wp-content/uploads/keep.jpg")?.toString()).toBe("media");
    expect(destination.site.get("wp-content/plugins/auth/auth.php")?.toString()).toBe("auth");
  });

  test("preflight resumes bounded reads without storing source bytes in checkpoints", async () => {
    const { w, destination, input } = await prepared("x".repeat(65536 * 42));
    const result = await w.run("transfer.push", { ...input, dryRun: true });
    expect((result as any).output.status).toBe("dry-run");
    const checkpoints = result.envelopes.filter((e: any) => e.progress?.phase === "checking code");
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(JSON.stringify(checkpoints)).not.toContain("x".repeat(100));
    expect(destination.imports.size).toBe(0);
  });

  test("destination capabilities cannot silently downgrade code review", async () => {
    const { w, destination, input } = await prepared();
    destination.options.capabilities = { reviewPause: false };
    const result = await w.run("transfer.push", input);
    expect((result as any).output.status).toBe("failed");
    expect(destination.imports.size).toBe(0);
  });
});
