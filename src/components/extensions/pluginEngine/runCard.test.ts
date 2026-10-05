import { expect, test } from "bun:test";
import { skippedFiles } from "./PluginRunCard";

test("the run card lists the files a push left out", () => {
  expect(skippedFiles({ count: 3, reason: "not accepted by Zoer Connect", files: [{ path: "wp-content/plugins/akismet/.htaccess", reason: "hidden file or folder" }, { path: 7 }] }))
    .toEqual({ count: 3, reason: "not accepted by Zoer Connect", files: [{ path: "wp-content/plugins/akismet/.htaccess", reason: "hidden file or folder" }] });
  expect(skippedFiles(undefined)).toBeNull();
  expect(skippedFiles({ count: 0, files: [] })).toBeNull();
});
