import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Btn, Select, controlClass, selectClass } from "@zoer/plugin-ui/controls";
import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { ApiError, getApiBase } from "../../lib/api/_http";
import type { WordPressManagedSite } from "../../lib/api";
import { securityClient, securityNavigationLink, type SecurityCapabilities, type SecurityTool, type PerformanceOptions, type PerformanceProfile } from "./wordpressSecurityClient";

export function SecurityCoverage({ value }: { value: unknown }) {
  if (value == null) return <span>Not reported</span>;
  if (Array.isArray(value)) return <div className="space-y-2">{value.slice(0, 200).map((item, index) => <div key={index} className="border-l border-border-muted pl-2"><SecurityCoverage value={item} /></div>)}{value.length > 200 && <p>Showing 200 of {value.length} entries. Download the report for full coverage.</p>}</div>;
  if (typeof value === "object") return <dl className="min-w-0 space-y-2">{Object.entries(value).map(([key, item]) => <div key={key} className="min-w-0"><dt className="font-medium">{key}</dt><dd className="min-w-0 break-words pl-2"><SecurityCoverage value={item} /></dd></div>)}</dl>;
  return <span className="break-words">{String(value)}</span>;
}

function PerformanceSummary({ value }: { value: PerformanceProfile["summary"] }) {
  if (typeof value !== "object" || value === null || !("totalTime" in value)) return <SecurityCoverage value={value} />;
  const metrics = [["totalTime", "Total time", true], ["queryTime", "Query time", true], ["queryCount", "Queries", false], ["rowCount", "Rows", false]] as const;
  return <dl className="grid gap-3 sm:grid-cols-2">{metrics.map(([key, label, seconds]) => { const number = value[key]; return <div key={key}><dt className="font-medium">{label}</dt><dd className="mt-1">{typeof number === "number" && Number.isFinite(number) ? seconds ? `${number.toFixed(3)} s` : number.toLocaleString() : "Not reported"}</dd></div>; })}</dl>;
}
function downloadProfile(profile: PerformanceProfile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `wordpress-profile-${profile.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function WordPressSecurityTools({ site, capabilities, disabled, onChanged }: { site: WordPressManagedSite; capabilities: SecurityCapabilities; disabled: boolean; onChanged: () => void }) {
  const session = useOperationSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [checked, setChecked] = useState<SecurityTool[] | null>(null);
  async function check() {
    setBusy(true); setError("");
    try { session.assertCurrent(); const result = await securityClient.checkTools(site.id); if (session.isCurrent()) { setChecked(result.tools); onChanged(); } }
    catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Upstream checks unavailable."); }
    finally { if (session.isCurrent()) setBusy(false); }
  }
  return <section aria-label="Security tooling versions" className="min-w-0 rounded-md border border-border-default p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Tooling versions</h3><Btn disabled={disabled || busy} loading={busy} onClick={check}>Check upstream versions</Btn></div>
    <p className="mt-2 text-xs text-text-secondary">Controller: repository {capabilities.controllerVersion || "Not reported"} · runtime {capabilities.runtimeVersion || "Not reported"}. Upstream checks do not install updates or change the pinned scanner.</p>
    {capabilities.repositoryCommit && <p className="mt-1 break-all font-mono text-xs text-text-secondary">Repository commit: {capabilities.repositoryCommit}</p>}
    {capabilities.runtimeSha256 && <details className="mt-2 text-xs text-text-secondary"><summary data-zoer-disclosure="" className="cursor-pointer py-2">Reviewed runtime bundle</summary><p className="break-all font-mono">Runtime SHA-256 {capabilities.runtimeSha256}</p>{capabilities.repositoryRuntimeSha256 && <p className="mt-2 break-all font-mono">Repository SHA-256 {capabilities.repositoryRuntimeSha256}</p>}</details>}
    {error && <p role="alert" className="mt-2 text-sm text-status-warning">{error}</p>}
    <div className="mt-3 space-y-3">{(checked ?? capabilities.tools ?? []).map(tool => <article key={tool.id} className="min-w-0 border-t border-border-muted pt-3"><h4 className="text-sm font-medium">{tool.name}</h4><p className="mt-1 text-xs text-text-secondary">Installed {tool.installedVersion || "Not installed"} · Repository {tool.repositoryVersion || "Not reported"} · Upstream {tool.upstreamVersion || "Not checked"}</p><p className="mt-1 text-xs text-text-secondary">Update status: {(tool.updateStatus || "unknown").replaceAll("-", " ")}</p>{(tool.note || tool.compatibilityNote) && <p className="mt-1 text-xs text-text-secondary">{tool.note || tool.compatibilityNote}</p>}{(tool.runtimeSha256 || securityNavigationLink(tool.sourceUrl)) && <details className="mt-2 text-xs"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-text-secondary">Runtime digest and source</summary>{tool.runtimeSha256 && <p className="break-all font-mono">SHA-256 {tool.runtimeSha256}</p>}{securityNavigationLink(tool.sourceUrl) && <a className="mt-2 inline-block text-accent underline" href={securityNavigationLink(tool.sourceUrl)!} target="_blank" rel="noopener noreferrer">Official source</a>}</details>}</article>)}</div>
  </section>;
}

export function WordPressPerformance({ site, capabilities, disabled, onChanged, onBusy }: { site: WordPressManagedSite; capabilities: SecurityCapabilities; disabled: boolean; onChanged: () => void; onBusy: (busy: boolean) => void }) {
  const session = useOperationSession();
  const [mode, setMode] = useState<PerformanceOptions["mode"]>("stage"), [stage, setStage] = useState<NonNullable<PerformanceOptions["stage"]>>("bootstrap"), [hook, setHook] = useState("init"), [path, setPath] = useState("/");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const query = useQuery({ queryKey: ["wordpress-security", getApiBase(), site.id, "profiles"], queryFn: () => securityClient.profiles(site.id), enabled: capabilities.profilingAvailable === true, retry: false });
  const hookValid = /^[a-zA-Z0-9_.:-]{1,128}$/.test(hook);
  const pathValid = path.startsWith("/") && !path.startsWith("//") && path.length <= 300 && !/[\u0000-\u001f\u007f\\]/.test(path);
  const modes = capabilities.profileModes ?? ["stage", "hook"];
  async function run(setup = false) {
    setBusy(true); onBusy(true); setError("");
    try {
      session.assertCurrent();
      if (setup) await securityClient.setupProfile(site.id);
      else await securityClient.profile(site.id, { mode, urlPath: path, ...(mode === "stage" ? { stage } : mode === "hook" ? { hook } : {}) });
      if (session.isCurrent()) { onChanged(); await query.refetch(); }
    } catch (e) { if (session.isCurrent()) setError(e instanceof ApiError && e.status === 404 ? "Update the Zoer host to enable performance profiling." : e instanceof ApiError && e.status === 409 ? e.message || "Profiling setup is required." : e instanceof Error ? e.message : "Profiling failed."); }
    finally { if (session.isCurrent()) { setBusy(false); onBusy(false); } }
  }
  const setup = capabilities.profilingSetupRequired === true;
  return <section aria-label="Local performance profiling" className="min-w-0 rounded-md border border-border-default p-3"><h3 className="text-sm font-semibold">Performance profile</h3><p className="mt-2 text-sm text-text-secondary">WP-CLI profiling executes this local site's WordPress code. Enable the isolated profiling tool, then run a selected profile. It does not install a WordPress plugin or change the production site.</p>
    {capabilities.profilingAvailable !== true ? <p className="mt-3 text-sm text-status-warning">Profiling is unavailable on this host.</p> : setup ? <div className="mt-3"><p className="text-xs text-text-secondary">The pinned profile-command tooling must be copied into this site's isolated runtime first.</p><Btn className="mt-2" disabled={disabled || busy || site.status !== "running"} loading={busy} onClick={() => run(true)}>Enable profiling tool</Btn></div> : <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm">Profile mode<Select className={selectClass("default", "mt-1 w-full")} value={mode} onChange={e => setMode(e.target.value as PerformanceOptions["mode"])}><option value="stage" disabled={!modes.includes("stage")}>Stage</option><option value="hook" disabled={!modes.includes("hook")}>Hook</option><option value="queries" disabled={!modes.includes("queries")}>Queries (requires compatible tooling)</option></Select></label>
      {mode === "stage" ? <label className="min-w-0 text-sm">Stage<Select className={selectClass("default", "mt-1 w-full")} value={stage} onChange={e => setStage(e.target.value as NonNullable<PerformanceOptions["stage"]>)}><option value="bootstrap">Bootstrap</option><option value="main_query">Main query</option><option value="template">Template</option></Select></label> : mode === "hook" ? <label className="min-w-0 text-sm">Hook<input className={controlClass("default", "mt-1 w-full")} value={hook} onChange={e => setHook(e.target.value)} maxLength={128} /></label> : <p className="self-end text-xs text-text-secondary">Inspect query timing through the host's bounded profile output.</p>}
      <label className="min-w-0 text-sm">Local URL path<input className={controlClass("default", "mt-1 w-full")} value={path} onChange={e => setPath(e.target.value)} maxLength={300} /></label><Btn className="self-end" disabled={disabled || busy || site.status !== "running" || !modes.includes(mode) || !pathValid || (mode === "hook" && !hookValid)} loading={busy} onClick={() => run()}>Run profile</Btn>
    </div>}
    {capabilities.profileQueriesReason && <p className="mt-3 text-xs text-text-secondary">{capabilities.profileQueriesReason}</p>}
    {(error || query.error) && <p role="alert" className="mt-3 text-sm text-status-warning">{error || (query.error instanceof Error ? query.error.message : "Profile history unavailable.")}</p>}
    <div className="mt-4 space-y-2">{(query.data?.profiles ?? []).map(profile => <details key={profile.id} className="rounded border border-border-muted p-3"><summary data-zoer-disclosure="" className="cursor-pointer py-1 text-sm">{profile.mode} · {profile.status} · {new Date(profile.createdAt).toLocaleString()}</summary><div className="mt-3 break-words text-xs text-text-secondary"><PerformanceSummary value={profile.summary} /><Btn className="mt-3" onClick={() => downloadProfile(profile)}>Download profile</Btn>{profile.warning && <p className="mt-2 text-status-warning">{profile.warning}</p>}{profile.error && <p className="mt-2 text-status-warning">{profile.error}</p>}<details className="mt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2">Profile rows ({profile.rows.length})</summary><SecurityCoverage value={profile.rows} /></details>{profile.tools != null && <details className="mt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2">Profile tooling</summary><SecurityCoverage value={profile.tools} /></details>}</div></details>)}</div>
  </section>;
}
