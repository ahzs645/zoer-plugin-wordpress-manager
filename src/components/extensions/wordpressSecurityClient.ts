import { json } from "../../lib/api/_http";

export interface SecurityFinding {
  rule?: string; subject?: unknown; severity?: string; sha256?: string; id?: string; kind?: string; message?: string;
  /** Set by the host only after a checksum match for the exact scanned bytes. */
  coreVerified?: boolean;
}
export interface SecurityCheck { name: string; status: string; coverage: Record<string, unknown>; findings: SecurityFinding[]; errors: string[] }
export interface SecurityReport { schemaVersion: number; status: string; findingCount: number; checks: SecurityCheck[]; [key: string]: unknown }
export interface SecurityAction { id: string; status: string; operation: string; createdAt: string; summary: string; recoveryPath?: string; error?: string; [key: string]: unknown }
export interface SecurityScan { id: string; siteId: string; status: "running" | "completed" | "failed"; phase: string; createdAt: string; completedAt?: string | null; error?: string | null; historical?: boolean; remediationAvailable?: boolean; report?: SecurityReport; actions?: SecurityAction[] }
export interface SecurityTool { id: string; name: string; installedVersion?: string; repositoryVersion?: string; runtimeSha256?: string; sourceUrl?: string; upstreamVersion?: string; updateStatus: "not-checked" | "current" | "available" | "ahead" | "unknown"; note?: string; compatibilityNote?: string }
export interface SecurityCapabilities { available: boolean; reason?: string; databaseUrl?: string; phpMyAdminUrl?: string; remediation?: boolean; quarantineAvailable?: boolean; quarantineUnavailableReason?: string; controllerVersion?: string; runtimeVersion?: string; runtimeSha256?: string; repositoryRuntimeSha256?: string; repositoryCommit?: string; tools?: SecurityTool[]; profilingAvailable?: boolean; profilingSetupRequired?: boolean; profileModes?: string[]; profileQueriesReason?: string }
export interface PerformanceProfile { id: string; status: string; createdAt: string; mode: string; rows: Array<Record<string, unknown>>; summary: string | Record<string, unknown>; tools?: unknown; warning?: string; error?: string }
export interface PerformanceOptions { mode: "stage" | "hook" | "queries"; stage?: "bootstrap" | "main_query" | "template"; hook?: string; urlPath?: string }
export interface SecurityPlan {
  id: string; siteId: string; scanId: string; operation: "quarantine" | "repair-core"; path?: string;
  files: Array<{ path: string; sha256: string | null; bytes: number; missing?: boolean }>; replacements?: Array<{ path: string; sha256: string; bytes: number }>; fingerprint: string; confirmation: string; summary: string; warnings: string[];
  releaseIdentity?: { version: string; officialVersionMd5: string; versionFile: { path: string; sha256: string | null; bytes: number; missing?: boolean } };
}
export interface SecurityOptions { files: boolean; database: boolean; core: boolean }
const base = (id: string) => `/wordpress-manager/sites/${encodeURIComponent(id)}/security`;
export const securityClient = {
  capabilities: (id: string) => json<SecurityCapabilities>(`${base(id)}/capabilities`),
  scans: (id: string) => json<{ scans: SecurityScan[] }>(`${base(id)}/scans`),
  scan: (id: string, scanId: string) => json<{ scan: SecurityScan }>(`${base(id)}/scans/${encodeURIComponent(scanId)}`),
  run: (id: string, options: SecurityOptions) => json<{ scan: SecurityScan }>(`${base(id)}/scans`, { method: "POST", body: JSON.stringify(options) }),
  plan: (id: string, scanId: string, operation: SecurityPlan["operation"], path?: string) => json<{ plan: SecurityPlan }>(`${base(id)}/scans/${encodeURIComponent(scanId)}/plan`, { method: "POST", body: JSON.stringify({ operation, ...(path ? { path } : {}) }) }),
  apply: (id: string, plan: SecurityPlan, confirmation: string) => json<{ action: SecurityAction }>(`${base(id)}/plans/${encodeURIComponent(plan.id)}/apply`, { method: "POST", body: JSON.stringify({ fingerprint: plan.fingerprint, confirmation }) }),
  checkTools: (id: string) => json<{ tools: SecurityTool[] }>(`${base(id)}/tools/check-updates`, { method: "POST", body: "{}" }),
  profiles: (id: string) => json<{ profiles: PerformanceProfile[] }>(`/wordpress-manager/sites/${encodeURIComponent(id)}/performance/profile`),
  profile: (id: string, input: PerformanceOptions) => json<{ profile: PerformanceProfile }>(`/wordpress-manager/sites/${encodeURIComponent(id)}/performance/profile`, { method: "POST", body: JSON.stringify(input) }),
  setupProfile: (id: string) => json<SecurityCapabilities>(`/wordpress-manager/sites/${encodeURIComponent(id)}/performance/setup`, { method: "POST", body: "{}" }),
};

export function securityReportVerdict(report?: SecurityReport): string {
  if (!report) return "Not checked";
  if (!report.checks.length) return "Report status unavailable";
  const states = [report.status, ...report.checks.map(check => check.status)];
  if (states.includes("error") || report.checks.some(check => check.errors.length > 0)) return "Report has errors";
  if (states.some(status => status === "incomplete" || status === "not_checked")) return "Report incomplete";
  if (states.some(status => !["no_findings", "findings"].includes(status))) return "Report status unavailable";
  if (states.includes("findings") || report.findingCount > 0 || report.checks.some(check => check.findings.length > 0)) return "Findings need review";
  return report.status === "no_findings" ? "No findings in checked scope" : "Report status unavailable";
}

export function securityFindingSubject(finding: SecurityFinding): string {
  if (typeof finding.subject === "string") return finding.subject;
  return finding.subject == null ? "Location not reported" : JSON.stringify(finding.subject);
}

/** Directory quarantine is reviewed by the backend; path/name alone is never evidence of malware. */
export function securityQuarantinePath(finding: SecurityFinding, checkName?: string): string | null {
  if (checkName && checkName !== "files-and-persistence" && checkName !== "amwscan") return null;
  if (finding.coreVerified === true || typeof finding.subject !== "string") return null;
  const parts = finding.subject.split("/");
  if (parts.length < 3 || parts[0] !== "wp-content" || parts[1] !== "plugins" || parts.some(part => !part || part === "." || part === ".." || part.includes("\\") || part.startsWith(".") || /[\u0000-\u001f\u007f]/.test(part))) return null;
  const plugin = parts[2];
  if (plugin === "zoer-connect" || plugin === "zoer-local-copy" || !/^[a-zA-Z0-9_-]+(?:\.php)?$/.test(plugin)) return null;
  return `wp-content/plugins/${plugin}`;
}

export function securityFindings(report?: SecurityReport) {
  return (report?.checks ?? []).flatMap(check => check.findings.map(finding => ({ check: check.name, finding })));
}

export function securityActionHistory(scans: SecurityScan[]): SecurityAction[] {
  const unique = new Map<string, SecurityAction>();
  for (const scan of scans) for (const action of scan.actions ?? []) if (!unique.has(action.id)) unique.set(action.id, action);
  return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function securityNavigationLink(value?: string): string | null {
  if (!value) return null;
  if (value.startsWith("#/databases") || value.startsWith("#/computer/")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
