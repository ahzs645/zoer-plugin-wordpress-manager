import { expect, test } from "bun:test";
import { readLocalInventory } from "../src/lib/queries/wordpress-transfer";

test("local inventory uses one site-bound host read and retains post types and table diagnostics", async () => {
  const calls: string[] = [];
  const inventory = { wordpress: { prefix: "wp_" }, database: { tables: [{ name: "wp_posts", primaryKey: true }] }, plugins: [], themes: [], postTypes: [{ name: "page", count: 7 }] };
  const result = await readLocalInventory("ddev-test", { inventory: async id => { calls.push(id); return { inventory: inventory as any }; } });
  expect(calls).toEqual(["ddev-test"]);
  expect(result).toEqual(inventory as any);
});
test("a failed or incomplete host inventory is surfaced without starting alternate workers", async () => {
  const failure = new Error("Site is stopped"); let calls = 0;
  await expect(readLocalInventory("ddev-test", { inventory: async () => { calls++; throw failure; } })).rejects.toBe(failure);
  expect(calls).toBe(1);
  await expect(readLocalInventory("ddev-test", { inventory: async () => ({ inventory: {} as any }) })).rejects.toThrow("incomplete inventory");
});
