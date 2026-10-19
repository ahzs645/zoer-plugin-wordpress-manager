import { expect, test } from "bun:test";
import { readRecordsSplitting } from "../plugin/worker/lib/catalog.js";

test("a record batch the host refuses as too large is read in halves", async () => {
  const calls: number[] = [];
  // Like Zoer's catalog.read: more than two of these records exceed its per-read byte limit.
  const host = { call: async (_method: string, input: { ids: string[] }) => {
    calls.push(input.ids.length);
    if (input.ids.length > 2) throw new Error("Record lookup too large; use fewer IDs.");
    return { records: input.ids.map(id => ({ id })) };
  } };
  const ids = ["a", "b", "c", "d", "e"];
  expect((await readRecordsSplitting(host, ids)).map((r: any) => r.id)).toEqual(ids);
  expect(calls).toEqual([5, 3, 2, 1, 2]);
  const other = { call: async () => { throw new Error("Catalog unavailable."); } };
  await expect(readRecordsSplitting(other, ids)).rejects.toThrow("Catalog unavailable.");
});
