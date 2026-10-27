import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, type WordPressCoreCheck, type WordPressManagedSite } from "../../lib/api";
import { wordpressKeys } from "../../lib/queries/wordpress";
import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { isDemoMode } from "@zoer/plugin-ui/workspace";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Modal as Modal } from "@zoer/plugin-ui/controls";
import { formatWhen } from "../../lib/formatWhen";

/** WordPress core updates of a local site; `compact` is the one line in the Overview summary (check, update, last operation). */
export default function WordPressCoreUpdates({ site, compact = false }: { site: WordPressManagedSite; compact?: boolean }) {
  const client = useQueryClient();
  const session = useOperationSession();
  const key = [...wordpressKeys.all(), "core-updates", site.id];
  const query = useQuery({ queryKey: key, queryFn: () => api.getWordPressCoreUpdates(site.id), enabled: !isDemoMode(), refetchInterval: q => q.state.data?.operation?.status === "running" ? 2000 : false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<WordPressCoreCheck | null>(null);
  const data = query.data, check = data?.check, operation = data?.operation;
  const running = operation?.status === "running";
  const needsRecovery = operation?.status === "failed" || operation?.status === "interrupted";
  async function refresh() {
    setBusy(true); setError("");
    try { session.assertCurrent(); const result = await api.checkWordPressCoreUpdates(site.id); if (session.isCurrent()) client.setQueryData(key, result); }
    catch (e) { if (session.isCurrent()) { setError(e instanceof Error ? e.message : "Update check failed."); void client.invalidateQueries({ queryKey: key }); } }
    finally { if (session.isCurrent()) setBusy(false); }
  }
  async function apply() {
    if (!review) return;
    setBusy(true); setError("");
    try { session.assertCurrent(); const result = await api.applyWordPressCoreUpdate(site.id, review); if (session.isCurrent()) { client.setQueryData(key, result); setReview(null); } }
    catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Unable to start the update."); }
    finally { if (session.isCurrent()) setBusy(false); }
  }
  async function downloadBackup() {
    if (!operation?.backup) return;
    setBusy(true); setError("");
    try {
      session.assertCurrent();
      const blob = await api.downloadWordPressPortableBackup(site.id, operation.backup.manifest.id, operation.backup.bundle.sha256);
      if (!session.isCurrent()) return;
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${site.name}-before-core-update.tar.gz`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Unable to download backup."); }
    finally { if (session.isCurrent()) setBusy(false); }
  }
  const failure = error || (query.error instanceof Error ? query.error.message : "");
  const reviewModal = review && <Modal title={`Update WordPress to ${review.latest}`} onClose={() => { if (!busy) setReview(null); }} footer={<><Btn disabled={busy} onClick={() => setReview(null)}>Cancel</Btn><Btn variant="primary" loading={busy} onClick={apply}>Back up and update</Btn></>}><div className="space-y-3 text-sm"><p><strong>{site.name}</strong> · {review.installed} → {review.latest}</p><p>Zoer will create a full-site archive and database backup, install this stable release, update the database, and verify core checksums and the installed version.</p><p>The site may briefly enter maintenance mode. The recovery backup is retained on the server. Restoration requires an operator; automatic rollback is not available for core updates.</p>{error && <p role="alert" className="text-status-warning">{error}</p>}</div></Modal>;
  if (compact) {
    const state = failure ? { text: "Check unavailable", tone: "text-status-warning" } : !check ? { text: query.isPending && !isDemoMode() ? "Checking…" : "Not checked", tone: "text-text-secondary" }
      : check.status === "available" ? { text: `${check.latest} available`, tone: "text-status-warning" } : check.status === "ahead" ? { text: `Newer than ${check.latest}`, tone: "text-text-secondary" } : { text: "Up to date", tone: "text-status-success" };
    const canUpdate = check?.status === "available" && check.compatible && check.supported && !running && !needsRecovery && !failure;
    return <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-text-primary">{check?.installed || site.wordpressVersion || "Not reported"}</span>
        <span role="status" title={check ? `Checked ${formatWhen(check.checkedAt)} · WordPress.org` : failure || undefined} className={`text-[12px] ${state.tone}`}>{running ? "Updating…" : state.text}</span>
        {canUpdate && <Btn size="sm" variant="primary" disabled={busy} onClick={() => setReview(check)}>Update</Btn>}
        <button type="button" aria-label="Check for WordPress updates" title="Check for updates" disabled={busy || running || site.status !== "running" || isDemoMode()} onClick={() => void refresh()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${busy && !review ? "animate-spin" : ""}`} aria-hidden="true" /></button>
      </div>
      {check && !check.compatible && <p className="text-[12px] text-status-warning">Requires {check.requirement}.</p>}
      {operation && (running || needsRecovery || operation.error) && <p role="status" className="break-words text-[12px] text-text-secondary">Core update {operation.status}: {operation.error || operation.step}{operation.backup && !running && <> · <button type="button" className="underline" disabled={busy} onClick={() => void downloadBackup()}>Download recovery backup</button></>}</p>}
      {reviewModal}
    </div>;
  }
  return <section aria-label="WordPress core updates" className="rounded-md border border-border-default p-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-text-heading">WordPress updates</h4><p className="mt-1 text-sm">Installed: {check?.installed || site.wordpressVersion || "Not reported"}</p></div><Btn icon={<RefreshCw className="h-4 w-4" />} loading={busy && !review} disabled={busy || running || site.status !== "running" || isDemoMode()} onClick={refresh}>Check for updates</Btn></div>
    {failure ? <p role="alert" className="mt-3 text-sm text-status-warning">Check unavailable: {failure}</p> : check ? <div className="mt-3 text-sm" role="status"><p>{check.status === "current" ? `Up to date · WordPress ${check.latest}` : check.status === "ahead" ? `Installed version is newer than WordPress.org's stable release (${check.latest}).` : `WordPress ${check.latest} is available.`}</p><p className="mt-1 text-xs text-text-secondary">Checked {formatWhen(check.checkedAt)} · WordPress.org</p>{!check.compatible && <p className="mt-2 text-status-warning">Requires {check.requirement}.</p>}{!check.supported && <p className="mt-2 text-text-secondary">Managed updates currently support standard-root, single-site WordPress installations.</p>}</div> : <p className="mt-3 text-sm text-text-secondary">{query.isPending && !isDemoMode() ? "Loading last check…" : "Updates have not been checked."}</p>}
    {check?.status === "available" && <Btn className="mt-3" variant="primary" disabled={busy || running || needsRecovery || !check.compatible || !check.supported || !!failure} onClick={() => setReview(check)}>Review WordPress update</Btn>}
    {operation && <div className="mt-3 border-t border-border-muted pt-3" role="status"><h5 className="text-sm font-medium">Latest core update · {operation.status}</h5><p className="mt-1 break-words text-sm">{operation.step}</p><p className="mt-1 text-xs text-text-secondary">Started {formatWhen(operation.startedAt)}{operation.completedAt ? ` · Finished ${formatWhen(operation.completedAt)}` : ""}</p>{operation.error && <p className="mt-1 break-words text-sm text-status-warning">{operation.error}</p>}{running && <p className="mt-1 text-xs text-text-secondary">Runs on the server. You can leave this page and return to see the result.</p>}{operation.backup && !running && <Btn className="mt-2" disabled={busy} onClick={downloadBackup}>Download recovery backup</Btn>}</div>}
    {reviewModal}
  </section>;
}
