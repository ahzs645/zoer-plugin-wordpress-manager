import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, CheckboxField, EmptyState, Modal, Select, controlClass, selectClass } from "@zoer/plugin-ui/controls";
import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { ApiError, getApiBase } from "../../lib/api/_http";
import type { WordPressManagedSite } from "../../lib/api";
import { securityClient, securityActionHistory, securityFindingSubject, securityFindings, securityNavigationLink, securityQuarantinePath, securityReportVerdict, type SecurityOptions, type SecurityPlan } from "./wordpressSecurityClient";
import { SecurityCoverage, WordPressPerformance, WordPressSecurityTools } from "./WordPressSecurityTools";

export default function WordPressSecurity({ site, onStart }: { site: WordPressManagedSite; onStart: () => void }) {
  const session = useOperationSession(), client = useQueryClient();
  const local = site.provider === "ddev";
  const prefix = ["wordpress-security", getApiBase(), site.id];
  const capabilities = useQuery({ queryKey: [...prefix, "capabilities"], queryFn: () => securityClient.capabilities(site.id), enabled: local, retry: false });
  const available = capabilities.data?.available === true;
  const history = useQuery({ queryKey: [...prefix, "scans"], queryFn: () => securityClient.scans(site.id), enabled: local && available, retry: false, refetchInterval: query => query.state.data?.scans.some(scan => scan.status === "running") ? 3000 : false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [options, setOptions] = useState<SecurityOptions>({ files: true, database: true, core: true });
  const [busy, setBusy] = useState<string | null>(null), [profilingBusy, setProfilingBusy] = useState(false), [error, setError] = useState("");
  const [plan, setPlan] = useState<SecurityPlan | null>(null), [confirmation, setConfirmation] = useState("");
  const [filter, setFilter] = useState("review"), [page, setPage] = useState(0);
  const scans = history.data?.scans ?? [];
  const currentId = selectedId || scans[0]?.id || null;
  const detail = useQuery({ queryKey: [...prefix, "scan", currentId], queryFn: () => securityClient.scan(site.id, currentId!), enabled: available && !!currentId, retry: false, refetchInterval: query => query.state.data?.scan.status === "running" ? 3000 : false });
  const scan = detail.data?.scan ?? scans.find(item => item.id === currentId);
  const report = scan?.report;
  const replacements = new Map((plan?.replacements ?? []).map(file => [file.path, file]));
  const running = scans.some(item => item.status === "running") || scan?.status === "running";
  const locked = !!busy || running || profilingBusy;
  const findings = securityFindings(report);
  const coreMatches = findings.filter(item => item.finding.coreVerified === true);
  const filtered = findings.filter(item => filter === "all" || (filter === "core" ? item.finding.coreVerified === true : item.finding.coreVerified !== true));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 50) - 1), currentPage = Math.min(page, lastPage);
  const visibleFindings = filtered.slice(currentPage * 50, (currentPage + 1) * 50);
  const actions = securityActionHistory(scan ? [scan, ...scans.filter(item => item.id !== scan.id)] : scans);
  const coreChanges = findings.some(({ finding }) => finding.rule === "modified-core-file" || finding.rule === "missing-core-file");
  const remediation = available && capabilities.data?.remediation !== false && scan?.status === "completed" && scan.remediationAvailable !== false && scan.historical !== true;
  const capError = capabilities.error instanceof ApiError && capabilities.error.status === 404 ? "Update the Zoer host to enable scanning and reports." : capabilities.error instanceof Error ? capabilities.error.message : "";
  async function refresh() { await client.invalidateQueries({ queryKey: prefix }); }
  async function run() {
    setBusy("scan"); setError("");
    try {
      session.assertCurrent(); const result = await securityClient.run(site.id, options);
      if (session.isCurrent()) { setSelectedId(result.scan.id); setPage(0); setFilter("review"); client.setQueryData([...prefix, "scan", result.scan.id], result); await refresh(); }
    } catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Unable to start scan."); }
    finally { if (session.isCurrent()) setBusy(null); }
  }
  async function review(operation: SecurityPlan["operation"], path?: string) {
    if (!scan) return;
    setBusy("plan"); setError("");
    try {
      session.assertCurrent(); const result = await securityClient.plan(site.id, scan.id, operation, path);
      if (session.isCurrent()) {
        if (result.plan.siteId !== site.id || result.plan.scanId !== scan.id || !result.plan.id || !result.plan.fingerprint || !result.plan.confirmation) throw new Error("The host returned an invalid or mismatched review plan.");
        setPlan(result.plan); setConfirmation("");
      }
    } catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Unable to plan remediation."); }
    finally { if (session.isCurrent()) setBusy(null); }
  }
  async function apply() {
    if (!plan) return;
    setBusy("apply"); setError("");
    try { session.assertCurrent(); await securityClient.apply(site.id, plan, confirmation); if (session.isCurrent()) { setPlan(null); setConfirmation(""); await refresh(); } }
    catch (e) { if (session.isCurrent()) { setError(e instanceof Error ? e.message : "Remediation failed. Review action history before retrying."); await refresh(); } }
    finally { if (session.isCurrent()) setBusy(null); }
  }
  function download() {
    if (!scan?.report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(scan, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `wordpress-security-${scan.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  if (!local) return <EmptyState title="Scan a local copy" description="Pull or restore this website into a DDEV local copy, then scan that copy. Provider and external sites are not scanned directly." />;
  return <div className="min-w-0 space-y-5">
    <section aria-label="Local security scan" className="rounded-md border border-border-default p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">Scan & report</h3><p className="mt-1 text-sm text-text-secondary">Read-only inspection of this local DDEV website's files, database and core checksums. Site PHP is not loaded by the scanner.</p></div><Btn disabled={!available || locked || site.status !== "running" || !Object.values(options).some(Boolean)} loading={busy === "scan"} onClick={run}>Run scan</Btn></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><CheckboxField checked={options.files} onChange={files => setOptions(current => ({ ...current, files }))} label="Files and persistence" description="Content markers, loaders and optional AMWScan." disabled={locked} /><CheckboxField checked={options.database} onChange={database => setOptions(current => ({ ...current, database }))} label="Database" description="Content, accounts, triggers and cron inventory." disabled={locked} /><CheckboxField checked={options.core} onChange={core => setOptions(current => ({ ...current, core }))} label="Core integrity" description="Compare with the official release checksums." disabled={locked} /></div>
      {site.status !== "running" && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><p>Start this local site to run a scan.</p><Btn onClick={onStart}>Start local site</Btn></div>}
      {capabilities.isPending && <p className="mt-3 text-sm text-text-secondary">Checking host scanning support…</p>}
      {(capError || capabilities.data?.reason || (!capabilities.isPending && !available)) && <p role="status" className="mt-3 text-sm text-status-warning">{capError || capabilities.data?.reason || "Scanning is not available on this host."}</p>}
      <div className="mt-3 flex flex-wrap gap-3 text-sm"><a className="text-accent underline" href={securityNavigationLink(capabilities.data?.databaseUrl) || "#/databases"}>Databases</a>{securityNavigationLink(capabilities.data?.phpMyAdminUrl) && <a className="text-accent underline" href={securityNavigationLink(capabilities.data?.phpMyAdminUrl)!} target="_blank" rel="noopener noreferrer">Open phpMyAdmin</a>}</div>
    </section>
    {(error || history.error || detail.error) && <p role="alert" className="break-words text-sm text-status-warning">{error || (history.error instanceof Error ? history.error.message : detail.error instanceof Error ? detail.error.message : "Report unavailable.")}</p>}
    {available && <section aria-label="Scan reports" className="min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Scan reports</h3><Btn loading={history.isFetching} onClick={() => void refresh()}>Refresh reports</Btn></div>
      {!!scans.length && <label className="block text-sm">Report<Select searchable className={selectClass("default", "mt-1 w-full")} value={currentId || ""} onChange={e => { setSelectedId(e.target.value); setPage(0); setPlan(null); }}><option value="" disabled>Select a report</option>{scans.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.status}</option>)}</Select></label>}
      {!scan && !history.isFetching && !history.error && <p className="text-sm text-text-secondary">No scan reports yet.</p>}
      {scan && <div className="min-w-0 rounded-md border border-border-default p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">{scan.status === "running" ? "Scan running" : scan.status === "failed" ? "Scan failed" : securityReportVerdict(report)}</h4><p className="mt-1 text-sm text-text-secondary">{scan.phase}</p><p className="mt-1 text-xs text-text-secondary">Started {new Date(scan.createdAt).toLocaleString()}{scan.completedAt ? ` · Completed ${new Date(scan.completedAt).toLocaleString()}` : ""}</p></div>{report && <Btn onClick={download}>Download report</Btn>}</div>{scan.error && <p className="mt-2 break-words text-sm text-status-warning">{scan.error}</p>}
        {scan.status === "running" && <p className="mt-2 text-xs text-text-secondary">Runs on the host. You can leave and return to this report.</p>}
        {report && <>{(scan.historical === true || scan.remediationAvailable === false) && <p className="mt-3 text-sm text-status-warning">Historical evidence: run a new scan to review changes to current bytes. This report cannot prepare a remediation plan.</p>}<div role="status" className="mt-3 rounded border border-status-warning/25 bg-status-warning/5 p-3 text-sm"><p className="font-medium">{securityReportVerdict(report)} · {report.findingCount} reported findings</p><p className="mt-1 text-text-secondary">This report describes the site at scan time. Imported containment actions may be newer; run a new scan to check the current state. Heuristic matches need review. No findings in checked scope is not a guarantee of safety. System cron, process memory, shared memory and unverified plugin/theme releases remain outside this report's coverage.</p></div><div className="mt-4 space-y-2">{report.checks.map((check, index) => <details key={`${check.name}-${index}`} className="min-w-0 rounded border border-border-muted p-3"><summary data-zoer-disclosure="" className="cursor-pointer py-1 text-sm">{check.name} · {check.status.replaceAll("_", " ")} · {check.findings.length} findings</summary><div className="mt-3 min-w-0 text-xs text-text-secondary">{check.errors.map((message, errorIndex) => <p key={errorIndex} className="mb-2 break-words text-status-warning">{message}</p>)}<SecurityCoverage value={check.coverage} /></div></details>)}</div>
          <section aria-label="Scan findings" className="mt-5 min-w-0 space-y-3">{capabilities.data?.quarantineAvailable === false && <p className="text-sm text-status-warning">{capabilities.data.quarantineUnavailableReason || "Quarantine is unavailable on this local filesystem. Review findings without applying quarantine."}</p>}<div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Findings</h4><Select aria-label="Filter scan findings" presentation="dropdown" searchable={false} className={selectClass("compact")} value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="review">Needs review ({findings.length - coreMatches.length})</option><option value="core">Official core matches ({coreMatches.length})</option><option value="all">All reported ({findings.length})</option></Select></div><p className="text-xs text-text-secondary">Only findings explicitly matched to official core checksums are grouped as core matches. A familiar filename alone does not establish that a file is safe.</p>
            {visibleFindings.map(({ check, finding }, index) => <article key={`${check}-${currentPage}-${index}`} className="min-w-0 rounded border border-border-muted p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="break-words text-sm font-medium">{finding.rule || finding.kind || "Scanner finding"}</h5><p className="mt-1 break-all font-mono text-xs">{securityFindingSubject(finding)}</p><p className="mt-1 text-xs text-text-secondary">{check} · {finding.severity || "Review"}{finding.coreVerified === true ? " · Matches official core" : ""}</p>{finding.message && <p className="mt-2 break-words text-xs text-text-secondary">{finding.message}</p>}</div>{securityQuarantinePath(finding, check) && <Btn disabled={!remediation || capabilities.data?.quarantineAvailable === false || locked || site.status !== "running"} onClick={() => review("quarantine", securityQuarantinePath(finding, check)!)}>Review quarantine</Btn>}</div>{finding.sha256 && <details className="mt-2 text-xs text-text-secondary"><summary data-zoer-disclosure="" className="cursor-pointer py-2">Evidence SHA-256</summary><p className="break-all font-mono">{finding.sha256}</p></details>}</article>)}
            {!visibleFindings.length && <p className="text-sm text-text-secondary">No findings in this filter.</p>}
            {filtered.length > 50 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><p>Showing {currentPage * 50 + 1}–{Math.min((currentPage + 1) * 50, filtered.length)} of {filtered.length}</p><div className="flex gap-2"><Btn disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Btn><Btn disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</Btn></div></div>}
          </section>{coreChanges && <div className="mt-4 border-t border-border-muted pt-3"><p className="mb-2 text-xs text-text-secondary">Core repair replaces only files in an exact reviewed official-release plan. Custom plugins and themes are not automatically repaired.</p><Btn disabled={!remediation || locked || site.status !== "running"} onClick={() => review("repair-core")}>Review core repair</Btn></div>}
        </>}
      </div>}
    </section>}
    {available && <section aria-label="Security action history" className="space-y-3"><h3 className="text-sm font-semibold">Action history</h3><p className="text-xs text-text-secondary">Recorded remediation actions for this local site, including imported operator actions when available. Historical reports can precede these actions. A completed action does not certify the whole website as safe.</p>{!actions.length && <p className="text-sm text-text-secondary">{history.isFetching ? "Loading action history…" : history.error ? "Action history unavailable." : "No recorded actions."}</p>}{actions.map(action => <details key={action.id} className="rounded border border-border-muted p-3"><summary data-zoer-disclosure="" className="cursor-pointer py-1 text-sm">{action.operation} · {action.status} · {new Date(action.createdAt).toLocaleString()}</summary><p className="mt-2 break-words text-sm">{action.summary}</p>{action.error && <p className="mt-2 text-sm text-status-warning">{action.error}</p>}{action.recoveryPath && <p className="mt-2 break-all text-xs text-text-secondary">Private recovery location: {action.recoveryPath}</p>}<p className="mt-2 break-all font-mono text-xs text-text-secondary">{action.id}</p></details>)}</section>}
    {capabilities.data && <><WordPressSecurityTools key={`${site.id}-tools`} site={site} capabilities={capabilities.data} disabled={locked} onChanged={() => void capabilities.refetch()} /><WordPressPerformance key={`${site.id}-performance`} site={site} capabilities={capabilities.data} disabled={locked} onChanged={() => void capabilities.refetch()} onBusy={setProfilingBusy} /></>}
    {plan && <Modal title={plan.operation === "quarantine" ? "Review quarantine" : "Review core repair"} onClose={() => { if (busy !== "apply") setPlan(null); }} footer={<><Btn disabled={busy === "apply"} onClick={() => setPlan(null)}>Cancel</Btn><Btn variant="danger" disabled={confirmation !== plan.confirmation || busy === "apply" || running || profilingBusy || site.status !== "running"} loading={busy === "apply"} onClick={apply}>Apply reviewed plan</Btn></>}><div className="min-w-0 space-y-3 text-sm"><p className="font-medium">{site.name}</p><p>{plan.summary}</p>{plan.releaseIdentity && <section aria-label="Core release baseline" className="space-y-1 rounded border border-border-muted p-2 text-xs"><p className="font-medium">WordPress release {plan.releaseIdentity.version}</p><p className="break-all font-mono">{plan.releaseIdentity.versionFile.path}</p><p className="break-all">{plan.releaseIdentity.versionFile.missing ? "Version file currently missing" : `Version-file baseline SHA-256 ${plan.releaseIdentity.versionFile.sha256 || "Not reported"}`}</p><p className="break-all font-mono">Official version file MD5 {plan.releaseIdentity.officialVersionMd5}</p></section>}{plan.path && <p className="break-all font-mono text-xs">{plan.path}</p>}<p className="break-all font-mono text-xs text-text-secondary">Fingerprint: {plan.fingerprint}</p>{plan.warnings.map((warning, index) => <p key={index} className="text-status-warning">{warning}</p>)}<details><summary data-zoer-disclosure="" className="cursor-pointer py-2">Exact file manifest ({plan.files.length} files)</summary><div tabIndex={0} className="max-h-60 overflow-auto rounded border border-border-muted p-2 text-xs"><ul className="space-y-3">{plan.files.map(file => { const replacement = replacements.get(file.path); return <li key={file.path} className="break-all"><p className="font-mono">{file.path}</p>{file.missing ? <p>Missing — will create exclusively</p> : <><p>Current: {file.bytes.toLocaleString()} bytes</p><p className="font-mono">Current SHA-256 {file.sha256 || "Not reported"}</p></>}{replacement && <><p className="mt-1">Replacement: {replacement.bytes.toLocaleString()} bytes</p><p className="font-mono">Replacement SHA-256 {replacement.sha256}</p></>}</li>; })}</ul></div></details><label className="block">Type <strong>{plan.confirmation}</strong> to confirm<input aria-label="Remediation confirmation" className={controlClass("default", "mt-2 w-full")} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>{error && <p role="alert" className="text-status-warning">{error}</p>}</div></Modal>}
  </div>;
}
