import { describe, expect, test } from "bun:test";
import { ActionFailedError } from "../src/host/actions";
import { readLocalInventory } from "../src/lib/queries/wordpress-transfer";
import { LOCAL_INVENTORY_COMMANDS } from "../src/lib/wordpress-transfer/inventory";

const guard = "Waiting for prior plugin worker cleanup. Its run has ended but its worker is still present; retry resume after workflow recovery removes it.";
const wrappedGuard = `Integration kubernetes worker failed to start: ${guard}`;
const output = (args: readonly string[]) => args[0] === "db" ? "wp_options\nwp_posts\n" : args[0] === "plugin" ? '[{"name":"leagueflow","status":"inactive","version":"1.0.3"}]' : '[{"name":"twentytwentyfive","status":"active"}]';

describe("local inventory read orchestration", () => {
  test("does not start another site's command or overlap a pending WP-CLI read", async () => {
    const calls: string[][] = [];
    let finishTables!: (value: string) => void;
    const result = readLocalInventory("local-intramurals", { read: async (siteId, args) => {
      expect(siteId).toBe("local-intramurals");
      calls.push([...args]);
      if (args[0] === "db") return new Promise<string>(resolve => { finishTables = resolve; });
      return output(args);
    } });
    await Promise.resolve();
    expect(calls).toEqual([[...LOCAL_INVENTORY_COMMANDS.tables]]);
    finishTables(output(LOCAL_INVENTORY_COMMANDS.tables));
    const inventory = await result;
    expect(calls).toEqual(Object.values(LOCAL_INVENTORY_COMMANDS).map(args => [...args]));
    expect(inventory.wordpress?.prefix).toBe("wp_");
    expect(inventory.plugins).toEqual([{ slug: "leagueflow", version: "1.0.3", name: undefined, active: false }]);
    expect(inventory.themes?.[0]?.active).toBe(true);
  });

  test("recovers only the exact temporary cleanup guard and retains subsequent inventory", async () => {
    const calls: string[] = [], waits: number[] = [];
    let attempted = false;
    const inventory = await readLocalInventory("local", { read: async (_, args) => {
      calls.push(args[0]!);
      if (!attempted) { attempted = true; throw new ActionFailedError(wrappedGuard, { id: "failed-read", status: "failed" }); }
      return output(args);
    }, pause: async ms => { waits.push(ms); } });
    expect(calls).toEqual(["db", "db", "plugin", "theme"]);
    expect(waits).toEqual([2_000]);
    expect(inventory.database?.tables?.map(table => table.name)).toEqual(["wp_options", "wp_posts"]);
  });

  test("generic errors and a superficially similar guard are not retried", async () => {
    for (const message of ["WordPress database unavailable", `Other failure: ${guard}`, `${wrappedGuard} Still broken.`, "The action is still running. Check back later."]) {
      const failure = new Error(message);
      let calls = 0, waits = 0;
      await expect(readLocalInventory("local", { read: async () => { calls++; throw failure; }, pause: async () => { waits++; } })).rejects.toBe(failure);
      expect(calls).toBe(1);
      expect(waits).toBe(0);
    }
  });

  test("cancelled and unknown-outcome actions are never repeated even with matching error text", async () => {
    for (const status of ["cancelled", "outcome_unknown"]) {
      const failure = new ActionFailedError(guard, { id: "read", status });
      let calls = 0;
      await expect(readLocalInventory("local", { read: async () => { calls++; throw failure; }, pause: async () => { throw new Error("Unexpected retry"); } })).rejects.toBe(failure);
      expect(calls).toBe(1);
    }
  });

  test("cleanup exhaustion is bounded to 35 seconds and surfaces the original failure", async () => {
    const failure = new Error(guard), waits: number[] = [];
    let calls = 0;
    await expect(readLocalInventory("local", { read: async () => { calls++; throw failure; }, pause: async ms => { waits.push(ms); } })).rejects.toBe(failure);
    expect(calls).toBe(4);
    expect(waits).toEqual([2_000, 3_000, 30_000]);
    expect(waits.reduce((total, ms) => total + ms, 0)).toBe(35_000);
  });

  test("all three commands share the retry budget instead of multiplying cleanup waits", async () => {
    const attempts: Record<string, number> = {}, waits: number[] = [];
    const failure = new Error(wrappedGuard);
    await expect(readLocalInventory("local", { read: async (_, args) => {
      const command = args[0]!;
      attempts[command] = (attempts[command] ?? 0) + 1;
      if (command === "theme" || attempts[command] === 1) throw failure;
      return output(args);
    }, pause: async ms => { waits.push(ms); } })).rejects.toBe(failure);
    expect(attempts).toEqual({ db: 2, plugin: 2, theme: 2 });
    expect(waits).toEqual([2_000, 3_000, 30_000]);
  });
});
