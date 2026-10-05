import { expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

/**
 * 0.8.0 (Zoer docs/plugin-shared-services.md 16.5 P4): the plugin no longer depends on Zoer's legacy
 * WordPress transfer engine, which Zoer deletes. No shipped source (UI, workers, manifest, command
 * bundle, build script) may reference its routes, and the remaining `/wordpress-manager/*` calls are
 * the non-transfer routes Zoer keeps.
 */
const ROOT = resolve(import.meta.dir, "..");
const SCANNED = ["src/**/*", "plugin/**/*", "scripts/**/*"];

const REMOVED: Array<[string, RegExp]> = [
  ["legacy pull routes", /\/wordpress-pulls\b/],
  ["legacy transfer routes", /\/wordpress-transfers\b/],
  ["local exports", /\/local-exports\b/],
  ["backup restores", /\/backup-restores\b/],
  ["local copies", /\/local-copies\b/],
  ["copy workflows", /\/copy-workflows\b/],
  ["transfer profiles", /\/transfer-profiles\b/],
  ["transfer history", /wordpress-manager\/transfers\b|["'`]\/transfers(?:[?/"'`]|$)/],
  ["Updraft computer imports", /wordpress-updraft-imports|\/updraft-import\/|computers\/[^"'`\s]*\/wordpress\/updraft/],
  ["Playground upload route", /\/files\/upload\b/],
  ["legacy pull downloads", /download-ticket/],
  ["legacy push/pull/replace jobs and diagnostics", /\/connect\/[^"'`\s]*\/(?:pulls|pushes|replacements|diagnostics|local-copies|copy-workflows)\b/],
  // Paths built from a helper (`${connectPath(siteId)}/pushes`, `${base}/transfers?limit=…`).
  ["legacy jobs built from a path helper", /\}\/(?:pulls|pushes|replacements|transfers)\b/],
];

/** Route families of `/wordpress-manager` that Zoer keeps after removing the legacy transfer engine. */
const KEPT = new Set(["sites", "connections", "connect", "hostinger", "deployments", "recovery-points", "plugins", "extension-search", "extension-actions", "admin-link", "overview", "workspace"]);

async function sources() {
  const out: Array<{ path: string; text: string }> = [];
  for (const pattern of SCANNED) {
    for await (const path of new Glob(pattern).scan({ cwd: ROOT, onlyFiles: true })) {
      if (/\.(?:png|jpe?g|gif|ico|zip|gz)$/i.test(path)) continue;
      out.push({ path, text: await Bun.file(resolve(ROOT, path)).text() });
    }
  }
  return out;
}

test("no shipped source references Zoer's removed legacy transfer routes", async () => {
  const files = await sources();
  expect(files.length).toBeGreaterThan(50);
  const hits = files.flatMap(({ path, text }) => text.split("\n").flatMap((line, index) =>
    REMOVED.filter(([, pattern]) => pattern.test(line)).map(([name]) => `${path}:${index + 1} ${name}: ${line.trim().slice(0, 160)}`)));
  expect(hits).toEqual([]);
});

test("the remaining /wordpress-manager calls are the routes Zoer keeps", async () => {
  const files = await sources();
  const families = new Set<string>();
  for (const { text } of files) for (const match of text.matchAll(/\/wordpress-manager\/([a-z-]+)/g)) families.add(match[1]!);
  expect([...families].filter(family => !KEPT.has(family))).toEqual([]);
  // Hostinger: only website creation (`/hostinger/websites`) is a call; sign-in moved to Zoer's connection dialog.
  for (const { text } of files) for (const match of text.matchAll(/\/wordpress-manager\/hostinger\/([a-z-]+)/g)) expect(match[1]).toBe("websites");
});

test("the transfer workers never read the 0.7.x per-site engine records", async () => {
  for (const { path, text } of await sources()) {
    if (!path.startsWith("plugin/worker/")) continue;
    expect(`${path}: ${/site-engine:|engine_legacy|assertPluginEngine/.test(text)}`).toBe(`${path}: false`);
  }
});
