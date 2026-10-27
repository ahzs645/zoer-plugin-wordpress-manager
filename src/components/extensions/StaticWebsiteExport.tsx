import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { ActionMenu, Btn, InlineAlert, Modal, Select, StatusBadge, controlClass, textareaClass, useDialogs } from "@zoer/plugin-ui/controls";
import { isDemoMode } from "@zoer/plugin-ui/workspace";
import { api, type WordPressManagedSite, type WordPressStaticExportFinding, type WordPressStaticExportJob, type WordPressStaticExportOptions, type WordPressStaticExportPreflight } from "../../lib/api";
import { getApiBase } from "../../lib/api/_http";
import { initialStaticExportDraft, staticExportActive, staticExportBytes, staticExportFilename, staticExportOptions, staticExportPreviewPath, staticExportTimestamp, type StaticExportDraft } from "./staticExportOptions";

const STATUS = { queued: "Queued", running: "Building", ready: "Ready", failed: "Failed", cancelled: "Cancelled" } as const;
const PHASE: Record<string, string> = {
  queued: "Waiting to start", inspecting: "Checking the site", crawling: "Collecting pages and assets", rendering: "Rendering pages",
  rewriting: "Updating links", packaging: "Preparing ZIP", validating: "Checking output", ready: "Export ready", cancelled: "Export cancelled", failed: "Export failed",
};

function Findings({ findings }: { findings: WordPressStaticExportFinding[] }) {
  if (!findings.length) return <p className="text-sm text-text-secondary">No dynamic features were detected on the checked pages.</p>;
  return <ul className="space-y-3">{findings.map((finding, index) => <li key={`${finding.code}:${finding.url ?? ""}:${index}`} className="min-w-0 space-y-1 text-sm">
    <div className="flex items-start gap-2"><span className="shrink-0"><StatusBadge tone={finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "info"} variant="dot">{finding.severity === "error" ? "Needs a change" : finding.severity === "warning" ? "Review" : "Note"}</StatusBadge></span><p className="min-w-0 break-words text-text-primary">{finding.message}</p></div>
    {finding.url && <p className="break-all pl-2 text-xs text-text-muted">{finding.url}</p>}
  </li>)}</ul>;
}

function draftFromOptions(options: WordPressStaticExportOptions): StaticExportDraft {
  return { mode: options.mode, paths: options.paths.join("\n"), linkMode: options.linkMode ?? "relative", basePath: options.basePath, maxPages: String(options.maxPages), maxAssets: String(options.maxAssets), maxMiB: String(Math.max(1, Math.ceil(options.maxBytes / 1024 ** 2))) };
}

/** A saved static artifact is independent of the source site's running state. */
export default function StaticWebsiteExport({ site, paused = false }: { site: WordPressManagedSite; paused?: boolean }) {
  const client = useQueryClient();
  const dialogs = useDialogs();
  const key = ["wordpress", "static-exports", site.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.listWordPressStaticExports(site.id),
    enabled: !isDemoMode(),
    refetchInterval: state => state.state.data?.exports.some(staticExportActive) ? 2000 : 15000,
  });
  const [configure, setConfigure] = useState(false);
  const [draft, setDraft] = useState<StaticExportDraft>({ ...initialStaticExportDraft });
  const [preflight, setPreflight] = useState<WordPressStaticExportPreflight | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const jobs = query.data?.exports ?? [];
  const active = jobs.some(staticExportActive);
  const canBuild = site.provider === "ddev" && site.status === "running" && !paused && !active;

  function update(field: keyof StaticExportDraft, value: string) {
    setDraft(previous => ({ ...previous, [field]: value })); setPreflight(null); setError(null);
  }
  function open(options?: WordPressStaticExportOptions) {
    setDraft(options ? draftFromOptions(options) : { ...initialStaticExportDraft }); setPreflight(null); setError(null); setConfigure(true);
  }
  function remember(job: WordPressStaticExportJob) {
    client.setQueryData<{ exports: WordPressStaticExportJob[] }>(key, previous => ({ exports: [job, ...(previous?.exports ?? []).filter(row => row.id !== job.id)] }));
  }
  async function inspect() {
    if (lock.current || !canBuild) return;
    lock.current = true; setBusy("inspect"); setError(null); setPreflight(null);
    try { setPreflight((await api.inspectWordPressStaticExport(site.id, staticExportOptions(draft))).preflight); }
    catch (caught) { setError(caught); } finally { lock.current = false; setBusy(null); }
  }
  async function build() {
    if (lock.current || !preflight || !canBuild || preflight.findings.some(finding => finding.severity === "error")) return;
    lock.current = true; setBusy("build"); setError(null);
    try {
      // Use the inspected options, not a separately reconstructed form payload.
      remember((await api.startWordPressStaticExport(site.id, preflight.options)).export);
      setConfigure(false); setPreflight(null);
      await query.refetch();
    } catch (caught) { setError(caught); } finally { lock.current = false; setBusy(null); }
  }
  async function cancel(job: WordPressStaticExportJob) {
    if (lock.current || !staticExportActive(job)) return;
    lock.current = true; setBusy(`cancel:${job.id}`); setError(null);
    try { remember((await api.cancelWordPressStaticExport(site.id, job.id)).export); await query.refetch(); }
    catch (caught) { setError(caught); } finally { lock.current = false; setBusy(null); }
  }
  async function download(job: WordPressStaticExportJob) {
    if (lock.current || job.status !== "ready" || !job.sha256) return;
    lock.current = true; setBusy(`download:${job.id}`); setError(null);
    try {
      const data = await api.downloadWordPressStaticExport(site.id, job.id, job.sha256);
      const url = URL.createObjectURL(data);
      const link = document.createElement("a"); link.href = url; link.download = staticExportFilename(site.name, job.id);
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) { setError(caught); } finally { lock.current = false; setBusy(null); }
  }
  async function remove(job: WordPressStaticExportJob) {
    if (lock.current || staticExportActive(job)) return;
    lock.current = true; setBusy(`delete:${job.id}`); setError(null);
    try {
      const accepted = await dialogs.confirm({ title: "Delete saved export", description: "Removes this export and its saved files from Zoer. Your WordPress site and copies already downloaded are kept.", confirmLabel: "Delete export", tone: "danger" });
      if (!accepted) return;
      await api.deleteWordPressStaticExport(site.id, job.id);
      client.setQueryData<{ exports: WordPressStaticExportJob[] }>(key, previous => ({ exports: (previous?.exports ?? []).filter(row => row.id !== job.id) }));
      await query.refetch();
    } catch (caught) { setError(caught); } finally { lock.current = false; setBusy(null); }
  }

  return <section aria-label="Export static website" className="mt-5 min-w-0 space-y-3 rounded-lg border border-border-default p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h4 className="text-sm font-semibold text-text-heading">Export static website</h4><p className="mt-1 text-[13px] text-text-secondary">Save public pages and assets for hosting elsewhere.</p></div>
      <Btn size="sm" disabled={!canBuild || !!busy || isDemoMode()} onClick={() => open()}>Configure export</Btn>
    </div>
    {site.status !== "running" && <p className="text-sm text-text-secondary">Start this site to build an export. Saved exports remain available below.</p>}
    {paused && <p className="text-sm text-text-secondary">Wait for the running transfer to finish before exporting.</p>}
    {query.error != null && <InlineAlert error={query.error} onRetry={() => void query.refetch()} />}
    {error != null && !configure && <InlineAlert error={error} onDismiss={() => setError(null)} />}
    {query.isPending && !query.error && <p role="status" className="text-sm text-text-secondary">Loading saved exports…</p>}
    {!query.isPending && !query.error && !jobs.length && <p className="text-sm text-text-muted">No static exports yet.</p>}
    {jobs.length > 0 && <div className="space-y-3"><div className="flex items-center justify-between gap-2"><h5 className="text-xs font-medium text-text-secondary">Saved exports</h5><Btn size="sm" variant="ghost" iconOnly icon={<RefreshCw className="h-3.5 w-3.5" />} aria-label="Refresh static exports" tooltip="Refresh static exports" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Btn></div>
      {jobs.map((job, index) => {
        const preview = staticExportPreviewPath(job);
        return <div key={job.id} className="min-w-0 space-y-2 border-t border-border-muted pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-words text-sm font-medium">{job.options.mode === "site" ? "Whole website" : `${job.options.paths.length} selected ${job.options.paths.length === 1 ? "page" : "pages"}`}{index === 0 ? " · Latest" : ""}</p><StatusBadge tone={job.status === "ready" ? "success" : job.status === "failed" ? "error" : staticExportActive(job) ? "running" : "neutral"}>{STATUS[job.status]}</StatusBadge></div>
          <p className="text-xs text-text-secondary"><time dateTime={job.createdAt}>{staticExportTimestamp(job.createdAt)}</time> · {job.progress.pages} pages · {job.progress.assets} assets · {staticExportBytes(job.progress.bytes)}{job.zipBytes !== undefined ? ` · ZIP ${staticExportBytes(job.zipBytes)}` : ""}</p>
          {staticExportActive(job) && <p role="status" aria-live="polite" className="text-sm">{PHASE[job.phase] ?? (job.phase || "Building export")}{job.progress.queued ? ` · ${job.progress.queued} queued` : ""}</p>}
          {job.status === "failed" && <InlineAlert error={new Error(job.error || "This export failed. Check its findings and try again.")} />}
          <div className="flex flex-wrap items-center gap-2">
            {job.status === "ready" && job.sha256 && <Btn size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} disabled={!!busy} loading={busy === `download:${job.id}`} onClick={() => void download(job)}>Download ZIP</Btn>}
            {preview && <a href={`${getApiBase()}${preview}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-accent underline underline-offset-2 sm:min-h-8"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Preview export</a>}
            {staticExportActive(job) && <Btn size="sm" disabled={!!busy} loading={busy === `cancel:${job.id}`} onClick={() => void cancel(job)}>Cancel export</Btn>}
            {(job.status === "failed" || job.status === "cancelled") && <Btn size="sm" disabled={!canBuild || !!busy} onClick={() => open(job.options)}>Try again</Btn>}
            <ActionMenu label="Static export actions" items={[{ label: "Delete saved export", icon: <Trash2 className="h-3.5 w-3.5" />, tone: "danger", disabled: !!busy || staticExportActive(job), loading: busy === `delete:${job.id}`, onClick: () => void remove(job) }]} />
          </div>
          <details className="min-w-0"><summary data-zoer-disclosure="" className="min-h-11 cursor-pointer py-2 text-sm text-text-secondary sm:min-h-0">Export details{job.findings.length ? ` · ${job.findings.length} ${job.findings.length === 1 ? "finding" : "findings"}` : ""}</summary><div className="space-y-3 pb-2 pt-1"><p className="break-words text-xs text-text-secondary">{job.options.linkMode === "root" ? `Destination path: ${job.options.basePath}` : "Portable relative links"} · Page limit: {job.options.maxPages} · Asset limit: {job.options.maxAssets} · Size limit: {staticExportBytes(job.options.maxBytes)}</p><Findings findings={job.findings} />{job.status === "ready" && <p className="text-xs text-text-secondary">Content reflects when this export was built. Forms, search and external services need the alternatives identified above.</p>}</div></details>
        </div>;
      })}
    </div>}
    {configure && <Modal title="Export static website" size="lg" onClose={() => { if (!busy) setConfigure(false); }} footer={<><Btn disabled={!!busy} onClick={() => setConfigure(false)}>Close</Btn><Btn disabled={!!busy || !canBuild} loading={busy === "inspect"} onClick={() => void inspect()}>{preflight ? "Check again" : "Check site"}</Btn>{preflight && <Btn variant="primary" disabled={!!busy || !canBuild || preflight.findings.some(finding => finding.severity === "error")} loading={busy === "build"} onClick={() => void build()}>Build export</Btn>}</>}>
      <div className="min-w-0 space-y-4 text-sm">
        <label className="block space-y-1"><span>What to export</span><Select aria-label="What to export" disabled={!!busy} value={draft.mode} onChange={event => update("mode", event.target.value)}><option value="site">Whole website</option><option value="selected">Selected pages</option></Select></label>
        {draft.mode === "site" ? <p className="text-xs text-text-secondary">Follows public links from the homepage within the limits below.</p> : <label className="block space-y-1"><span>Page paths</span><textarea aria-label="Page paths" className={textareaClass()} disabled={!!busy} rows={4} value={draft.paths} onChange={event => update("paths", event.target.value)} placeholder={"/about/\n/news/?query-7-page=2"} /><span className="block text-xs text-text-secondary">One path per line. Includes their assets and pagination; other page links stay on the source site.</span></label>}
        <label className="block space-y-1"><span>Link format</span><Select aria-label="Link format" disabled={!!busy} value={draft.linkMode} onChange={event => update("linkMode", event.target.value)}><option value="relative">Portable relative links</option><option value="root">Links under a destination path</option></Select></label>
        {draft.linkMode === "root" ? <label className="block space-y-1"><span>Destination path</span><input aria-label="Destination path" className={controlClass()} disabled={!!busy} value={draft.basePath} onChange={event => update("basePath", event.target.value)} placeholder="/resources/" /><span className="block text-xs text-text-secondary">Use / for a website root, or a folder such as /resources/.</span></label> : <p className="text-xs text-text-secondary">Portable links keep the export usable in different website folders and content packages.</p>}
        <details><summary data-zoer-disclosure="" className="min-h-11 cursor-pointer py-2 text-sm sm:min-h-0">Options</summary><div className="grid min-w-0 grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
          <label className="min-w-0 space-y-1"><span>Page limit</span><input aria-label="Page limit" type="number" min="1" max="500" step="1" className={controlClass()} disabled={!!busy} value={draft.maxPages} onChange={event => update("maxPages", event.target.value)} /></label>
          <label className="min-w-0 space-y-1"><span>Asset limit</span><input aria-label="Asset limit" type="number" min="1" max="5000" step="1" className={controlClass()} disabled={!!busy} value={draft.maxAssets} onChange={event => update("maxAssets", event.target.value)} /></label>
          <label className="min-w-0 space-y-1"><span>Size limit in MiB</span><input aria-label="Size limit in MiB" type="number" min="1" max="256" step="1" className={controlClass()} disabled={!!busy} value={draft.maxMiB} onChange={event => update("maxMiB", event.target.value)} /></label>
          <p className="text-xs text-text-secondary sm:col-span-3">Pagination adds pages. Exceeding a limit stops the build and reports what needs changing.</p>
        </div></details>
        {error != null && <InlineAlert error={error} onDismiss={() => setError(null)} />}
        {preflight && <section aria-label="Static export checks" className="space-y-3 border-t border-border-default pt-4">
          <h4 className="font-semibold text-text-heading">Site check</h4><p>{preflight.sampledPages} {preflight.sampledPages === 1 ? "page" : "pages"} checked · {preflight.pages.length} candidate {preflight.pages.length === 1 ? "page" : "pages"} discovered</p>
          <p className="text-xs text-text-secondary">This is a sample of linked public pages. The build discovers more pages and checks collected assets.</p>
          <Findings findings={preflight.findings} />
          {preflight.pages.length > 0 && <details><summary data-zoer-disclosure="" className="min-h-11 cursor-pointer py-2 text-sm sm:min-h-0">Discovered pages</summary><ul className="space-y-1 pt-2 text-xs text-text-secondary">{preflight.pages.slice(0, 30).map(page => <li key={page.url} className="break-all">{page.url}</li>)}</ul>{preflight.pages.length > 30 && <p className="mt-2 text-xs text-text-muted">{preflight.pages.length - 30} more candidate pages.</p>}</details>}
        </section>}
      </div>
    </Modal>}
  </section>;
}
