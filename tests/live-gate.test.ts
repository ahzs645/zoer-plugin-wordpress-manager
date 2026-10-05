import { describe, expect, test } from "bun:test";
import { assertActionAllowed, assertApprovalAllowed, assertWritableSite, GuardError, zoerOrigin } from "../tools/live-gate/guard";
import { compareSnapshots, snapshotFrom } from "../tools/live-gate/snap";

/** tools/live-gate: the test-site guard and the snapshot compare (no network). */
describe("live-gate guard", () => {
  test("ZOER_URL is required and normalised to the origin", () => {
    expect(() => zoerOrigin({})).toThrow(GuardError);
    expect(() => zoerOrigin({ ZOER_URL: "not a url" })).toThrow(GuardError);
    expect(zoerOrigin({ ZOER_URL: "https://zoer.example/api/" })).toBe("https://zoer.example");
    expect(zoerOrigin({ ZOER_URL: "https://zoer.example" })).toBe("https://zoer.example");
  });

  test("writes are refused outside the test sites unless the override names the site", () => {
    expect(() => assertWritableSite("ddev-zoer-connect-040-destination", {})).not.toThrow();
    expect(() => assertWritableSite("ddev-over-the-edge-local-393fed40", {})).toThrow(GuardError);
    expect(() => assertWritableSite("ddev-over-the-edge-local-393fed40", { LIVE_GATE_ALLOW_SITE: "ddev-over-the-edge" })).toThrow(GuardError);
    expect(() => assertWritableSite("ddev-over-the-edge-local-393fed40", { LIVE_GATE_ALLOW_SITE: "x, ddev-over-the-edge-local-393fed40" })).not.toThrow();
  });

  test("Hilltop Childcare is refused always, reads and override included", () => {
    expect(() => assertWritableSite("ddev-hilltop-childcare-1", { LIVE_GATE_ALLOW_SITE: "ddev-hilltop-childcare-1" })).toThrow(GuardError);
    expect(() => assertActionAllowed("read", { siteId: "external:lightpink-vulture-195751" }, {})).toThrow(GuardError);
  });

  test("reads pass, writes check every site field", () => {
    expect(() => assertActionAllowed("read", { siteId: "ddev-anything" }, {})).not.toThrow();
    expect(() => assertActionAllowed("external_write", { siteId: "ddev-zoer-connect-040-destination", sourceSiteId: "external:abc" }, {})).toThrow(GuardError);
    expect(() => assertActionAllowed("local_write", {}, {})).not.toThrow();
  });

  test("approvals need a reviewed test site", () => {
    const approval = (input: Record<string, unknown>) => ({ id: "a", payload: { structuredReview: { input } } });
    expect(() => assertApprovalAllowed(approval({ siteId: "ddev-zoer-connect-040-destination", control: "rollback" }), {})).not.toThrow();
    expect(() => assertApprovalAllowed(approval({ siteId: "hostinger:1:2" }), {})).toThrow(GuardError);
    expect(() => assertApprovalAllowed(approval({}), {})).toThrow(GuardError);
  });
});

describe("live-gate snapshots", () => {
  const diagnostics = (posts: number, active = true) => ({
    wordpress: { home: "https://a", siteurl: "https://a", prefix: "wp_", version: "6.8" },
    database: { tables: [{ name: "wp_posts", suffix: "posts", prefixed: true, rows: posts }, { name: "wp_options", suffix: "options", prefixed: true, rows: 100 + posts }] },
    plugins: [{ slug: "zoer-connect", version: "0.5.0", active }], muPlugins: [], themes: [{ slug: "twentytwentyfive", active: true }],
    postTypes: [{ name: "post", count: posts }],
  });

  test("an identical site compares equal", () => {
    expect(compareSnapshots(snapshotFrom("s", diagnostics(3)), snapshotFrom("s", diagnostics(3)))).toEqual([]);
  });

  test("row, plugin and post type changes are listed; ignored tables are not", () => {
    const diffs = compareSnapshots(snapshotFrom("s", diagnostics(3)), snapshotFrom("s", diagnostics(5, false)), ["options"]);
    expect(diffs).toEqual([
      "plugins: -[zoer-connect:active:0.5.0] +[zoer-connect:inactive:0.5.0]",
      "tables.posts: 3 → 5",
      "postTypes.post: 3 → 5",
    ]);
  });
});
