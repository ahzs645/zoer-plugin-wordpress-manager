import { describe, expect, test } from "bun:test";
import { chosenItems, groupOverrides, overrideGroup, overrideSummary, toggleGroupSelection, type ThemeOverride } from "./ThemeSiteEditorChanges";

const item = (id: number, flags: Partial<ThemeOverride>): ThemeOverride => ({
  id, type: "template", slug: `t${id}`, title: `T${id}`, modified: "2026-10-01 10:00:00", path: "", contentSha256: "", portableSha256: "",
  repositoryPath: `templates/t${id}.html`, repositoryFile: { exists: false, sha256: null }, siteFile: { exists: false, sha256: null },
  inRepository: false, siteMatchesRepository: false, safeToRemove: false, warnings: [], ...flags,
});

describe("Site Editor change groups", () => {
  test("each saved copy lands in the step it is waiting for", () => {
    expect(overrideGroup(item(1, {}))).toBe("save");
    expect(overrideGroup(item(2, { repositoryFile: { exists: true, sha256: "x" } }))).toBe("save");
    expect(overrideGroup(item(3, { inRepository: true }))).toBe("update");
    expect(overrideGroup(item(4, { inRepository: true, safeToRemove: true }))).toBe("remove");
  });

  test("groups keep the list's order and the summary counts them", () => {
    const groups = groupOverrides([item(1, { inRepository: true }), item(2, {}), item(3, { inRepository: true }), item(4, { safeToRemove: true, inRepository: true })]);
    expect(groups.save.map(entry => entry.id)).toEqual([2]);
    expect(groups.update.map(entry => entry.id)).toEqual([1, 3]);
    expect(groups.remove.map(entry => entry.id)).toEqual([4]);
    expect(overrideSummary(groups)).toBe("1 needs saving · 2 waiting for a local update · 1 safe to remove");
    expect(overrideSummary(groupOverrides([]))).toBe("");
  });
  test("bulk actions only touch rows the person chose", () => {
    const remove = [item(4, { safeToRemove: true }), item(5, { safeToRemove: true })];
    expect(chosenItems(remove, [])).toEqual([]);
    expect(chosenItems(remove, [5, 99]).map(entry => entry.id)).toEqual([5]);
    // A row that appears after "Check again" is not chosen automatically.
    const refreshed = [...remove, item(6, { safeToRemove: true })];
    expect(chosenItems(refreshed, [4, 5]).map(entry => entry.id)).toEqual([4, 5]);
    // Select all chooses the whole group; again clears only that group.
    const all = toggleGroupSelection(refreshed, [1]);
    expect(all.sort()).toEqual([1, 4, 5, 6]);
    expect(toggleGroupSelection(refreshed, all)).toEqual([1]);
  });
});
