import { describe, expect, test } from "bun:test";
import { bindHost } from "../src/host/bridge";
import { wordpressQueries } from "../src/lib/queries/wordpress";
import { securityClient, securityReportVerdict, securityQuarantinePath, securityFindingSubject, securityActionHistory, securityNavigationLink, type SecurityReport, type SecurityScan, type SecurityPlan } from "../src/components/extensions/wordpressSecurityClient";

const report = (status = "no_findings", checks: SecurityReport["checks"] = []): SecurityReport => ({ schemaVersion: 1, status, findingCount: 0, checks });
const check = (status: string) => ({ name: "test", status, coverage: {}, findings: [], errors: [] });
describe("local security UI policy", () => {
  test("security inventory has an isolated metadata-only route and cache key", async () => {
    const calls: any[] = [];
    const unbind = bindHost({ request: async (_method, input) => { calls.push(input); return { sites: [] }; }, subscribe: () => () => {} });
    try {
      const security = wordpressQueries.securitySites();
      expect(security.queryKey).not.toEqual(wordpressQueries.sites().queryKey);
      await (security.queryFn as () => Promise<unknown>)();
    } finally { unbind(); }
    expect(calls).toEqual([{ path: "/wordpress-manager/security-sites", method: undefined, body: undefined }]);
  });
  test("incomplete and errors take precedence over a no-findings or findings count", () => {
    expect(securityReportVerdict(report("no_findings", [check("not_checked")]))).toBe("Report incomplete");
    expect(securityReportVerdict({ ...report("findings", [check("error")]), findingCount: 2 })).toBe("Report has errors");
    expect(securityReportVerdict(report("incomplete", [check("incomplete")]))).toBe("Report incomplete");
    expect(securityReportVerdict(report("no_findings", [check("no_findings")]))).toBe("No findings in checked scope");
    expect(securityReportVerdict(report("no_findings", [{ ...check("no_findings"), errors: ["Core checksum fetch failed"] }]))).toBe("Report has errors");
    expect(securityReportVerdict(report())).toBe("Report status unavailable");
    expect(securityReportVerdict(undefined)).toBe("Not checked");
    expect(securityReportVerdict(report("unexpected"))).toBe("Report status unavailable");
  });
  test("quarantine candidates remain confined to ordinary plugin entries", () => {
    expect(securityQuarantinePath({ subject: "wp-content/plugins/zxui/loader.php" }, "files-and-persistence")).toBe("wp-content/plugins/zxui");
    expect(securityQuarantinePath({ subject: "wp-content/plugins/hello.php" }, "amwscan")).toBe("wp-content/plugins/hello.php");
    for (const subject of ["/wp-content/plugins/zxui/loader.php", "wp-content/plugins/../wp-config.php", "wp-content/plugins/zxui/../../wp-config.php", "wp-content/plugins/zxui/.hidden.php", "wp-content/uploads/loader.php", "wp-content/mu-plugins/zoer-local-copy.php", "wp-content/plugins/zoer-connect/loader.php", "wp-content/plugins/zxui\\evil/loader.php"]) {
      expect(securityQuarantinePath({ subject }, "amwscan")).toBeNull();
    }
  });
  test("core matches and database findings do not become plugin quarantine controls", () => {
    expect(securityQuarantinePath({ subject: "wp-content/plugins/zxui/loader.php", coreVerified: true }, "amwscan")).toBeNull();
    expect(securityQuarantinePath({ subject: "wp-content/plugins/zxui" }, "database-content")).toBeNull();
    expect(securityQuarantinePath({ subject: { table: "wp_options", column: "option_value" } })).toBeNull();
    expect(securityFindingSubject({ subject: { table: "custom", column: "value" } })).toBe('{"table":"custom","column":"value"}');
  });
  test("deduplicates imported action history without asserting site safety", () => {
    const action = { id: "operator-1", status: "completed", operation: "quarantine", createdAt: "2026-10-07T10:00:00Z", summary: "Exact plugin directory moved" };
    const scan: SecurityScan = { id: "scan", siteId: "local", status: "completed", phase: "done", createdAt: action.createdAt, actions: [action] };
    expect(securityActionHistory([scan, { ...scan, id: "other", actions: [action, { ...action, id: "repair", createdAt: "2026-10-07T11:00:00Z" }] }]).map(item => item.id)).toEqual(["repair", "operator-1"]);
  });
  test("database navigation does not accept script URLs, credentials or unreviewed hash destinations", () => {
    expect(securityNavigationLink("#/databases?id=existing")).toBe("#/databases?id=existing");
    expect(securityNavigationLink("https://zoer.example/phpmyadmin")).toBe("https://zoer.example/phpmyadmin");
    for (const value of ["javascript:alert(1)", "http://untrusted.example/", "https://user:password@example.test/", "#/operator", "//untrusted.example/"]) expect(securityNavigationLink(value)).toBeNull();
  });
  test("read-only scan and separately reviewed apply use the exact scoped host contract", async () => {
    const calls: Array<{ method: string; input: any }> = [];
    const unbind = bindHost({ request: async (method, input) => { calls.push({ method, input }); return {}; }, subscribe: () => () => {} });
    const plan: SecurityPlan = { id: "plan", siteId: "local", scanId: "scan", operation: "quarantine", files: [], fingerprint: "exact-fingerprint", confirmation: "QUARANTINE local", summary: "Test", warnings: [] };
    try {
      await securityClient.run("local", { files: true, database: false, core: true });
      await securityClient.plan("local", "scan", "quarantine", "wp-content/plugins/zxui");
      await securityClient.apply("local", plan, "QUARANTINE local");
    } finally { unbind(); }
    expect(calls.map(call => call.input.path)).toEqual(["/wordpress-manager/sites/local/security/scans", "/wordpress-manager/sites/local/security/scans/scan/plan", "/wordpress-manager/sites/local/security/plans/plan/apply"]);
    expect(calls[0].input.body).toEqual({ files: true, database: false, core: true });
    expect(calls[2].input.body).toEqual({ fingerprint: "exact-fingerprint", confirmation: "QUARANTINE local" });
    expect(calls.every(call => call.method === "api.request")).toBe(true);
  });
});
