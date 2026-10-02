import { expect, test } from "bun:test";
import { isActivePush, normalizePushJob } from "./wordpress-transfer";

test("0.3 push views gain a status and file progress", () => {
  const legacy = normalizePushJob({ id: "a", createdAt: "2026-09-01", phase: "verification_required", index: 3, fileCount: 7 });
  expect(legacy.status).toBe("verification");
  expect(legacy.kind).toBe("push");
  expect(legacy.progress).toEqual({ filesUploaded: 3, fileCount: 7 });
  expect(normalizePushJob({ id: "b", createdAt: "", phase: "uploading" }).status).toBe("paused");
  expect(normalizePushJob({ id: "c", createdAt: "", phase: "reading_database", status: "running", kind: "replace" }).kind).toBe("replace");
});

test("an idle runner is not active even when the status says running", () => {
  expect(isActivePush({ status: "running", runner: "idle" })).toBe(false);
  expect(isActivePush({ status: "running", runner: "running" })).toBe(true);
  expect(isActivePush({ status: "queued" })).toBe(true);
  expect(isActivePush({ status: "review" })).toBe(false);
});
