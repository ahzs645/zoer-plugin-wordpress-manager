import { expect, test } from "bun:test";
import { hiddenBySiteEditor } from "./ThemeSiteEditorChanges";
import { jobLabel } from "./developmentJobs";

// Seen live on 040-source (2026-10-17): a header saved in the Site Editor kept showing after its file was updated.
test("an update names the files a Site Editor copy shows instead", () => {
  const changes = [{ path: "parts/header.html" }, { path: "style.css" }, { path: "theme.json" }];
  expect(hiddenBySiteEditor(changes, [{ path: "parts/header.html" }, { path: "templates/index.html" }])).toEqual(["parts/header.html"]);
  expect(hiddenBySiteEditor(changes, [])).toEqual([]);
});

test("a rollback is named after what it undid", () => {
  const jobs = [{ id: "u", operation: "update" }, { id: "c", operation: "capture" }];
  expect(jobLabel({ operation: "rollback", rollbackOf: "u" }, jobs, "theme")).toBe("Rolled back theme code");
  expect(jobLabel({ operation: "rollback", rollbackOf: "c" }, jobs, "theme")).toBe("Undid saving Site Editor changes to the repository");
  expect(jobLabel({ operation: "rollback", rollbackOf: "gone" }, jobs, "plugin")).toBe("Undo");
  expect(jobLabel({ operation: "update" }, jobs, "plugin")).toBe("Local plugin update");
});
