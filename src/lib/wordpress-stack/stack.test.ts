import { describe, expect, test } from "bun:test";
import { cloneLink, compareStack, exportStack, gitKey, normalizeGitUrl, parseStackFile, parseStackLink, playgroundBlueprint, stackText } from "./stack";

const sha = "a".repeat(64);
const sample = {
  schemaVersion: 1,
  name: "Apex stack",
  plugins: [
    { slug: "apex-interactions", source: { resource: "git:directory", url: "https://github.com/ahzs645/apex.git", ref: "v1.5.0", refType: "tag", path: "apex-wordpress/plugin/apex-interactions" }, activate: true },
    { slug: "query-monitor", source: { resource: "wordpress.org/plugins", slug: "query-monitor", version: "3.16.4" } },
    { slug: "release-only", source: { resource: "url", url: "https://github.com/o/r/releases/download/v2/release-only.zip", sha256: sha }, activate: true },
  ],
  themes: [
    { slug: "apex-gutenberg", source: { resource: "git:directory", url: "git@github.com:ahzs645/apex.git", path: "apex-wordpress/theme/apex-gutenberg" }, activate: true, requires: ["apex-interactions"] },
    { slug: "twentytwentyfive", source: { resource: "wordpress.org/themes", slug: "twentytwentyfive" } },
  ],
};

describe("stack files", () => {
  test("parse, normalise Git URLs and round-trip", () => {
    const stack = parseStackFile(JSON.stringify(sample));
    expect(stack.themes[0]!.source).toEqual({ resource: "git:directory", url: "https://github.com/ahzs645/apex", path: "apex-wordpress/theme/apex-gutenberg" });
    expect(stack.plugins[0]!.source).toMatchObject({ url: "https://github.com/ahzs645/apex", ref: "v1.5.0", refType: "tag" });
    expect(parseStackFile(stackText(stack))).toEqual(stack);
  });

  test("reject unsafe or inconsistent entries", () => {
    const bad = (patch: (value: any) => void) => { const value = structuredClone(sample); patch(value); return () => parseStackFile(value); };
    expect(bad(v => { v.schemaVersion = 2; })).toThrow("schemaVersion");
    expect(bad(v => { v.plugins[2].source.sha256 = undefined; })).toThrow("sha256");
    expect(bad(v => { v.plugins[2].source.url = "http://github.com/x.zip"; })).toThrow("HTTPS");
    expect(bad(v => { v.plugins[2].source.url = "https://u:p@github.com/x.zip"; })).toThrow("credentials");
    expect(bad(v => { v.plugins[0].source.url = "https://token@github.com/o/r"; })).toThrow("Git URL");
    expect(bad(v => { v.plugins[0].source.path = "../secrets"; })).toThrow("path");
    expect(bad(v => { v.plugins[1].source.resource = "wordpress.org/themes"; })).toThrow("cannot come from");
    expect(bad(v => { v.plugins[1].slug = "other"; })).toThrow("differ");
    expect(bad(v => { v.plugins.push({ ...v.plugins[1] }); })).toThrow("twice");
    expect(bad(v => { v.plugins.push({ slug: "zoer-connect", source: { resource: "wordpress.org/plugins", slug: "zoer-connect" } }); })).toThrow("Zoer Connect");
    expect(bad(v => { v.themes[1].activate = true; })).toThrow("one theme");
    expect(bad(v => { v.themes[0].requires = ["missing"]; })).toThrow("requires missing");
    expect(() => parseStackFile("{")).toThrow("JSON");
  });

  test("Git URL keys match HTTPS, SSH and .git spellings", () => {
    expect(normalizeGitUrl("https://github.com/Owner/Repo.git/")).toBe("https://github.com/Owner/Repo");
    expect(gitKey("git@github.com:owner/repo.git")).toBe(gitKey("https://GitHub.com/Owner/Repo"));
    expect(normalizeGitUrl("https://github.com/owner/repo?token=x")).toBeNull();
  });

  test("export uses Git sources for repository-linked extensions and wordpress.org otherwise", () => {
    const { stack, notes } = exportStack({
      name: "Local",
      plugins: [{ slug: "zoer-connect", version: "0.7.0", active: true }, { slug: "campus-manager", version: "1.4.0", active: true }, { slug: "akismet", version: "5.3", active: false }, { slug: "local-only", version: "0.1.0" }],
      themes: [{ slug: "acme", version: "0.2.1", active: true }],
      links: [
        { repoId: "r1", name: "campusmanager", slug: "campus-manager", folder: "dist/campus-manager", kind: "plugin", gitUrl: "https://github.com/o/campusmanager", ref: { ref: "v1.4.0", refType: "tag" } },
        { repoId: "r2", name: "scratch", slug: "local-only", folder: ".", kind: "plugin", gitUrl: null },
        { repoId: "r3", name: "acme", slug: "acme", folder: ".", kind: "theme", gitUrl: "https://github.com/o/acme", ref: { ref: "main", refType: "branch" } },
      ],
    });
    expect(stack.plugins.map(entry => entry.slug)).toEqual(["akismet", "campus-manager", "local-only"]);
    expect(stack.plugins[1]).toEqual({ slug: "campus-manager", source: { resource: "git:directory", url: "https://github.com/o/campusmanager", ref: "v1.4.0", refType: "tag", path: "dist/campus-manager" }, activate: true });
    expect(stack.plugins[0]).toEqual({ slug: "akismet", source: { resource: "wordpress.org/plugins", slug: "akismet", version: "5.3" } });
    expect(stack.themes[0]).toEqual({ slug: "acme", source: { resource: "git:directory", url: "https://github.com/o/acme", ref: "main", refType: "branch" }, activate: true });
    expect(notes).toEqual([expect.objectContaining({ slug: "local-only" })]);
    expect(() => parseStackFile(stack)).not.toThrow();
  });

  test("export leaves out WordPress's bundled Hello Dolly (hello.php), but not a plugin that only shares the slug", () => {
    const plugins = [{ slug: "hello", name: "Hello Dolly", version: "1.7.2" }, { slug: "akismet", version: "5.3" }];
    expect(exportStack({ name: "Local", plugins, themes: [], links: [] }).stack.plugins.map(entry => entry.slug)).toEqual(["akismet"]);
    expect(exportStack({ name: "Local", plugins: [{ slug: "hello", name: "Hello Banner", version: "2.0" }], themes: [], links: [] }).stack.plugins.map(entry => entry.slug)).toEqual(["hello"]);
  });

  test("compare orders required plugins first, the activated theme last, and matches repositories", () => {
    const stack = parseStackFile(sample);
    const plan = compareStack(stack, { plugins: [{ slug: "query-monitor", version: "3.16.4", active: false }, { slug: "release-only", version: "2", active: false }], themes: [{ slug: "twentytwentyfive", version: "1.0", active: true }] }, [{ id: "r1", name: "apex", gitUrl: "https://github.com/AHZS645/apex" }]);
    expect(plan.map(item => [item.entry.slug, item.state])).toEqual([["apex-interactions", "missing"], ["query-monitor", "installed"], ["release-only", "inactive"], ["twentytwentyfive", "installed"], ["apex-gutenberg", "missing"]]);
    expect(plan[0]!.repository?.id).toBe("r1");
    expect(compareStack(stack, { plugins: [{ slug: "query-monitor", version: "3.0" }], themes: [] }, [])[1]).toMatchObject({ state: "different-version", installedVersion: "3.0" });
    expect(compareStack(stack, { plugins: [], themes: [] }, [])[0]!.repository).toBeNull();
  });

  test("links: GitHub blob/raw/tree/repository and clone links", () => {
    expect(parseStackLink("https://github.com/o/r/blob/main/stacks/site.json")).toEqual({ repository: "https://github.com/o/r", ref: "main", path: "stacks/site.json" });
    expect(parseStackLink("https://raw.githubusercontent.com/o/r/v1/zoer-wordpress.json")).toEqual({ repository: "https://github.com/o/r", ref: "v1", path: "zoer-wordpress.json" });
    expect(parseStackLink("https://github.com/o/r/tree/main/site")).toEqual({ repository: "https://github.com/o/r", ref: "main", path: "site/zoer-wordpress.json" });
    expect(parseStackLink("https://github.com/o/r")).toEqual({ repository: "https://github.com/o/r", ref: null, path: "zoer-wordpress.json" });
    expect(parseStackLink("https://gitlab.com/g/r")).toEqual({ repository: "https://gitlab.com/g/r", ref: null, path: "zoer-wordpress.json" });
    expect(parseStackLink("http://github.com/o/r")).toBeNull();
    expect(cloneLink({ resource: "git:directory", url: "https://github.com/o/r", ref: "v1.2", refType: "tag" })).toBe("/#/repos?clone=https%3A%2F%2Fgithub.com%2Fo%2Fr&ref=v1.2");
    expect(cloneLink({ resource: "git:directory", url: "https://github.com/o/r", ref: "a".repeat(40), refType: "commit" })).toBe("/#/repos?clone=https%3A%2F%2Fgithub.com%2Fo%2Fr");
  });

  test("Playground blueprint uses Playground resource shapes", () => {
    const blueprint = playgroundBlueprint(parseStackFile(sample));
    expect(blueprint.steps[0]).toEqual({ step: "login" });
    expect(blueprint.steps[1]).toEqual({ step: "installPlugin", pluginData: { resource: "git:directory", url: "https://github.com/ahzs645/apex", ref: "v1.5.0", refType: "tag", path: "apex-wordpress/plugin/apex-interactions" }, options: { activate: true, targetFolderName: "apex-interactions" } });
    expect(blueprint.steps[2]).toMatchObject({ pluginData: { resource: "url", url: "https://downloads.wordpress.org/plugin/query-monitor.3.16.4.zip" } });
    expect(blueprint.steps.at(-1)).toEqual({ step: "installTheme", themeData: { resource: "wordpress.org/themes", slug: "twentytwentyfive" }, options: { activate: false, targetFolderName: "twentytwentyfive" } });
  });
});
