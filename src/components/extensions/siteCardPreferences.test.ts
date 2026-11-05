import { expect, test } from "bun:test";
import type { WordPressManagedSite } from "../../lib/api";
import type { WordPressSiteGroup } from "./wordpressSiteGroups";
import { moveSiteCard, orderedSiteCards, readSiteCardPreferences, saveSiteCardPreferences, siteCardFaviconSite, siteCardId } from "./siteCardPreferences";

const site = (id: string) => ({ id, name: id }) as WordPressManagedSite;
const single = (id: string): WordPressSiteGroup => ({ kind: "site", site: site(id) });

test("saved order survives a missing site and appends new sites", () => {
  expect(orderedSiteCards([single("a"), single("new"), single("c")], ["c", "missing", "a"]).map(siteCardId)).toEqual(["c", "a", "new"]);
});

test("reordering a filtered list preserves hidden and temporarily unavailable cards", () => {
  const order = moveSiteCard(["a", "hidden", "b", "offline", "c"], ["a", "hidden", "b", "c", "new"], "c", "a", false);
  expect(order).toEqual(["c", "a", "hidden", "b", "offline", "new"]);
  expect(moveSiteCard(order, ["c", "a", "b"], "c", "b", true)).toEqual(["a", "hidden", "b", "c", "offline", "new"]);
});

test("first site supplies a group favicon unless a current member is selected", () => {
  const group: WordPressSiteGroup = { kind: "pair", id: "first", source: site("first"), lives: [site("other-live")], copies: [site("copy")] };
  expect(siteCardFaviconSite(group, {}).id).toBe("first");
  expect(siteCardFaviconSite(group, { first: "copy" }).id).toBe("copy");
  expect(siteCardFaviconSite(group, { first: "removed" }).id).toBe("first");
  expect(siteCardFaviconSite(single("standalone"), { standalone: "other-live" }).id).toBe("standalone");
  expect(siteCardId(group)).toBe(siteCardId(single("first")));
});

test("preferences round-trip, reject malformed values and tolerate blocked browser storage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let stored = "";
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } } });
  try {
    const preferences = { order: ["b", "a"], collapsed: ["a"], faviconSites: { b: "copy" } };
    expect(saveSiteCardPreferences(preferences)).toBe(true);
    expect(readSiteCardPreferences()).toEqual(preferences);
    stored = '{"order":["a",7,"a"],"collapsed":"wrong","faviconSites":{"a":"copy","b":12}}';
    expect(readSiteCardPreferences()).toEqual({ order: ["a"], collapsed: [], faviconSites: { a: "copy" } });
    stored = "broken json";
    expect(readSiteCardPreferences().order).toEqual([]);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    expect(readSiteCardPreferences().collapsed).toEqual([]);
    expect(saveSiteCardPreferences(preferences)).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
