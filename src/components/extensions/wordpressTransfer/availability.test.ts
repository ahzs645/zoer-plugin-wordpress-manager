import { expect, test } from "bun:test";
import type { ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { actionAvailability } from "./TransferWorkspace";
import { initialAction } from "./draft";
import { tableItems, unselectableTablesHint } from "./DatabasePanel";

const connection = (status: Partial<ZoerConnectConnection["status"]>) => ({ url: "https://site.example", status: { pull: true, push: true, publish: true, stagingReady: true, capabilities: { siteReplace: true }, ...status } }) as unknown as ZoerConnectConnection;

test("Find & Replace needs an import-capable plugin, like Push", () => {
  expect(actionAvailability(connection({})).replace).toBeNull();
  const noImport = actionAvailability(connection({ publish: false }));
  expect(noImport.replace).toBe(noImport.push);
  expect(noImport.replace).toContain("import-capable");
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
  expect(pushOnly.pull).toContain("Enable Pull");
  expect(initialAction(pushOnly)).toBe("push");
  expect(initialAction(actionAvailability(connection({ stagingReady: false })))).toBe("push");
  expect(initialAction(actionAvailability(connection({})))).toBe("pull");
  // Pull-only sites keep Pull; with nothing available the dialog explains why on Pull.
  expect(initialAction(actionAvailability(connection({ push: false })))).toBe("pull");
  expect(initialAction(actionAvailability(connection({ pull: false, push: false })))).toBe("pull");
});
