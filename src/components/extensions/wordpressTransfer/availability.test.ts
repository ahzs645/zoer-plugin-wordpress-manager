import { expect, test } from "bun:test";
import type { ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { actionAvailability, pushReadiness, zoerConnectSettingsUrl } from "./availability";
import { initialAction } from "./draft";
import { tableItems, unselectableTablesHint } from "./DatabasePanel";

const connection = (status: Partial<ZoerConnectConnection["status"]>) => ({ url: "https://site.example", status: { pull: true, push: true, publish: true, stagingReady: true, capabilities: { siteReplace: true }, ...status } }) as unknown as ZoerConnectConnection;

test("Find & Replace needs completed import setup, like Push", () => {
  expect(actionAvailability(connection({})).replace).toBeNull();
  const noImport = actionAvailability(connection({ publish: false }));
  expect(noImport.replace).toBe(noImport.push);
  // publish=false means the destination import setup was not confirmed, not an old plugin.
  expect(noImport.push).toContain("Destination import setup");
  expect(noImport.push).not.toContain("Update");
});

test("push readiness lists each destination setting with its fix", () => {
  const items = pushReadiness(connection({ publish: false, stagingReady: false }));
  expect(items.filter(item => !item.ok).map(item => item.key)).toEqual(["imports", "storage"]);
  expect(zoerConnectSettingsUrl("https://site.example/")).toBe("https://site.example/wp-admin/tools.php?page=zoer-connect");
});

test("tables whose names the plugin cannot select are disabled with a hint", () => {
  const items = tableItems({ database: { tables: [
    { name: "wp_posts", suffix: "posts", prefixed: true, rows: 3 },
    { name: "wp_odd-name", suffix: "odd-name", prefixed: true },
  ] } } as any);
  expect(items.map(item => [item.value, !!item.disabled])).toEqual([["posts", false], ["odd-name", true]]);
  expect(unselectableTablesHint(items)).toContain("1 table can't be selected");
  expect(unselectableTablesHint(items.slice(0, 1))).toBeNull();
});

test("a transfer dialog never opens on a disabled tile", () => {
  // A push-only destination (Pull off, as on the 0.4.0 destination test site) opens on Push.
  const pushOnly = actionAvailability(connection({ pull: false }));
  expect(pushOnly.pull).toContain("Turn on Pull");
  expect(initialAction(pushOnly)).toBe("push");
  expect(initialAction(actionAvailability(connection({ stagingReady: false })))).toBe("push");
  expect(initialAction(actionAvailability(connection({})))).toBe("pull");
  // Pull-only sites keep Pull; with nothing available the dialog explains why on Pull.
  expect(initialAction(actionAvailability(connection({ push: false })))).toBe("pull");
  expect(initialAction(actionAvailability(connection({ pull: false, push: false })))).toBe("pull");
});
