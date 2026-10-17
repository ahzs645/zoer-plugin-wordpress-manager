import { expect, test } from "bun:test";
import { themeOverrideWarnings } from "./ThemeOverrideWarnings";

// Shapes as read live on 2026-10-17: the local list from the Zoer host route on 040-source and the
// `site.test { themeOverrides }` items from Zoer Connect 0.7.0 on 040-destination.
const local = [{ title: "Index", slug: "index", safeToRemove: false }, { title: "Header", slug: "header", safeToRemove: false }, { title: "Styles", slug: "theme.json", safeToRemove: false }];
const live = [{ type: "part", slug: "footer", title: "Footer", modified: "2026-10-17 20:52:18", path: "parts/footer.html", hasThemeFile: true }];

test("warns about unsaved local copies and about live copies that hide pushed files", () => {
  expect(themeOverrideWarnings(["zoer-site-editor-test"], [local], [live], "Source Brand Site", "example.com")).toEqual([
    { key: "local:zoer-site-editor-test", text: "zoer-site-editor-test: Index, Header, Styles were edited in the Site Editor on Source Brand Site and are not in the theme files, so this push won't include them. Save them to the theme's repository first (Development tab)." },
    { key: "live:zoer-site-editor-test", text: "zoer-site-editor-test: example.com has its own saved copy of Footer. Visitors will keep seeing that instead of the pushed files until it is reset in Appearance → Editor on the live site." },
  ]);
});

test("copies already saved in the theme files, or none at all, need no warning", () => {
  expect(themeOverrideWarnings(["a"], [local.map(item => ({ ...item, safeToRemove: true }))], [[]], "S", "d")).toEqual([]);
  expect(themeOverrideWarnings(["a", "b"], [], [], "S", "d")).toEqual([]);
});
