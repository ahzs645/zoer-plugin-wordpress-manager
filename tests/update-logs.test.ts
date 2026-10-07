import { describe, expect, test } from "bun:test";
import type { WordPressDeployment } from "../src/lib/api";
import { wordpressExtensionActions, wordpressExtensionActionLabel, wordpressExtensionAutoUpdateLabel } from "../src/components/extensions/wordpressExtensionActions";
import { wordpressExtensionLogs, wordpressExtensionLogLabel, wordpressExtensionLogSlugs, wordpressExtensionLogStatus } from "../src/components/extensions/wordpressUpdateLogs";

const receipt = (values: Partial<WordPressDeployment> = {}): WordPressDeployment => ({
  id: "receipt", type: "extension-change", sourceSiteId: "local", targetSiteId: null, connectionId: null, domain: "shared.example",
  status: "succeeded", step: "plugin update", createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-07T12:00:10Z", completedAt: "2026-10-07T12:00:10Z", error: null,
  details: { kind: "plugin", operation: "update", slugs: ["akismet"] }, ...values,
});

describe("WordPress extension change logs", () => {
  test("scopes local and paired hosting receipts by IDs, not name/domain", () => {
    const local = receipt(), host = receipt({ id: "host", sourceSiteId: null, targetSiteId: "hosting" });
    const unrelated = receipt({ id: "other", sourceSiteId: "other", targetSiteId: "another" });
    const publish = receipt({ id: "publish", type: "full-site" });
    expect(wordpressExtensionLogs([local, host, unrelated, publish], ["local", "hosting"]).map(log => log.id)).toEqual(["receipt", "host"]);
    expect(wordpressExtensionLogs([unrelated], [])).toEqual([]);
  });
  test("uses requested time and stable receipt ID, independent of provider updates", () => {
    const older = receipt({ id: "older", updatedAt: "2026-10-08T00:00:00Z" });
    const latest = receipt({ id: "latest", createdAt: "2026-10-07T13:00:00Z" });
    expect(wordpressExtensionLogs([older, latest], ["local"]).map(log => log.id)).toEqual(["latest", "older"]);
  });
  test("does not describe acceptance, unknown outcome or failure as verified", () => {
    expect(wordpressExtensionLogStatus(receipt({ status: "queued" }))).toBe("Accepted · waiting for verification");
    expect(wordpressExtensionLogStatus(receipt({ status: "outcome_unknown" }))).toBe("Outcome unknown");
    expect(wordpressExtensionLogStatus(receipt({ status: "failed" }))).toBe("Failed");
    expect(wordpressExtensionLogStatus(receipt())).toBe("Verified");
  });
  test("shows deletion with the reviewed uninstall contract and only string slugs", () => {
    const log = receipt({ details: { kind: "plugin", operation: "uninstall", slugs: ["hello", {}, "akismet", null] } });
    expect(wordpressExtensionLogLabel(log)).toBe("Delete plugins");
    expect(wordpressExtensionLogSlugs(log)).toEqual(["hello", "akismet"]);
    expect(wordpressExtensionActionLabel("uninstall")).toBe("Delete");
    expect(wordpressExtensionActions("plugin", "inactive", false)).toEqual(["activate", "uninstall"]);
  });
  test("retains theme and protected extension restrictions", () => {
    expect(wordpressExtensionActions("theme", "active", true)).toEqual(["update"]);
    expect(wordpressExtensionActions("theme", "parent", true)).toEqual(["update"]);
    expect(wordpressExtensionActions("theme", "parent", false)).toEqual([]);
    expect(wordpressExtensionActions("theme", "inactive", false)).toEqual(["activate", "uninstall"]);
    expect(wordpressExtensionActions("plugin", "must-use", true)).toEqual([]);
    expect(wordpressExtensionActions("plugin", "dropin", true)).toEqual([]);
  });
  test("does not infer auto-update policy from missing or unknown inventory values", () => {
    expect(wordpressExtensionAutoUpdateLabel("on")).toBe("On");
    expect(wordpressExtensionAutoUpdateLabel("off")).toBe("Off");
    expect(wordpressExtensionAutoUpdateLabel("")).toBe("Not reported");
    expect(wordpressExtensionAutoUpdateLabel("unknown")).toBe("Not reported");
  });
  test("does not render arbitrary receipt detail objects as log text", () => {
    const malformed = receipt({ details: { kind: "plugin", operation: { credential: "secret" }, slugs: "hello" } });
    expect(wordpressExtensionLogLabel(malformed)).toBe("plugin update");
    expect(wordpressExtensionLogSlugs(malformed)).toEqual([]);
  });
});
