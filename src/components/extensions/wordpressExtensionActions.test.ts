import { describe, expect, test } from "bun:test";
import { wordpressExtensionActions } from "./wordpressExtensionActions";

describe("wordpressExtensionActions", () => {
  test("does not offer mutations for must-use or drop-in plugins", () => {
    expect(wordpressExtensionActions("plugin", "must-use", true)).toEqual([]);
    expect(wordpressExtensionActions("plugin", "dropin", true)).toEqual([]);
  });

  test("offers normal plugin lifecycle actions", () => {
    expect(wordpressExtensionActions("plugin", "active", true)).toEqual(["update", "deactivate", "uninstall"]);
    expect(wordpressExtensionActions("plugin", "inactive", false)).toEqual(["activate", "uninstall"]);
  });

  test("does not offer uninstall for the active theme", () => {
    expect(wordpressExtensionActions("theme", "active", true)).toEqual(["update"]);
    expect(wordpressExtensionActions("theme", "inactive", false)).toEqual(["activate", "uninstall"]);
  });
});
