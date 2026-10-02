import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { resourceQueries } from "../../lib/queries/resources";
import { wordpressQueries } from "../../lib/queries/wordpress";
import { useWordPressLocalCopies, type WordPressLocalCopyJob } from "../../lib/queries/wordpress-transfer";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { controlClass, fieldLabelClass, radioClass, selectClass } from "@zoer/plugin-ui/controls";

function copyStatus(copy: WordPressLocalCopyJob) {
  if (copy.phase === "complete") return copy.replaceSiteId ? "Local copy refreshed" : "Local copy ready";
  if (copy.phase === "creating") return copy.replaceSiteId ? "Preparing the existing local site" : "Preparing local WordPress";
  if (copy.phase === "importing") return "Importing database and verifying the website";
  return `Copying files · ${copy.index.toLocaleString()} / ${copy.totalFiles.toLocaleString()}`;
}

/** A copy imports its source's site title, so its address is what tells copies apart. */
function copyLabel(site: { name: string; managedUrl?: string | null; url?: string | null }) {
  try { return `${site.name} · ${new URL(site.managedUrl || site.url || "").host}`; } catch { return site.name; }
}

export default function WordPressLocalCopy({ siteId, pullId }: { siteId: string; pullId: string | null }) {
  const client = useQueryClient();
  const refreshed = useRef(new Set<string>());
  const connectors = useQuery({ ...resourceQueries.connectors(), refetchInterval: 10000 });
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const ddev = connectors.data?.find(c => c.id === "ddev");
  const available = ddev?.active === true;
  const copies = useWordPressLocalCopies(siteId);
  const existing = sites.filter(site => site.provider === "ddev" && site.sourceSiteId === siteId);
  const [mode, setMode] = useState<"new" | "refresh">("new");
  const [name, setName] = useState("");
  const [replaceSiteId, setReplaceSiteId] = useState("");
  const running = copies.copies.some(copy => copy.phase !== "complete" && (copy.running || copy.busy) && !copy.error);
  useEffect(() => {
    const done = copies.copies.filter(copy => copy.phase === "complete" && copy.targetId && !refreshed.current.has(copy.id));
    if (!done.length) return;
    for (const copy of done) refreshed.current.add(copy.id);
    void client.invalidateQueries({ queryKey: wordpressQueries.sites().queryKey });
    void client.invalidateQueries({ queryKey: resourceQueries.computers().queryKey });
  }, [copies.copies, client]);
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!pullId) return;
    try {
      const target = existing.find(site => site.id === replaceSiteId);
      await copies.command(mode === "refresh" && target ? { action: "start", name: target.name, pullId, replaceSiteId: target.id } : { action: "start", name: name.trim(), pullId });
    } catch { /* shown below */ }
  }
  const canStart = available && !copies.pending && !running && (mode === "new" ? !!name.trim() : !!replaceSiteId);
  return <section className="min-w-0 space-y-3 rounded-lg border border-border-default p-3">
    <h3 className="font-medium">Local copies</h3>
    <p className="text-xs text-text-secondary">Create or refresh a DDEV site from a complete verified download. Plugins start inactive, scheduled tasks and outgoing mail/HTTP requests are disabled. Review integrations before enabling them.</p>
    <p className="text-xs text-text-secondary">Copies run on the Zoer server. You can close this dialog and come back later.</p>
    {!available && <p role="status" className="text-sm text-status-warning">{connectors.isLoading ? "Checking local WordPress availability…" : ddev?.unavailableReason || "DDEV is unavailable. Complete server setup before creating a local copy."}</p>}
    {pullId && <form onSubmit={start} className="min-w-0 space-y-3">
      <fieldset className="min-w-0 space-y-2" disabled={!available || copies.pending}>
        <legend className="sr-only">Local copy destination</legend>
        <label className="flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px]">
          <input type="radio" name="local-copy-mode" className={`${radioClass} mt-0.5`} checked={mode === "new"} onChange={() => setMode("new")} />
          <span><span className="block text-text-primary">Create new local copy</span><span className="block text-[12px] text-text-muted">A new DDEV site with its own administrator account.</span></span>
        </label>
        <label className={`flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px] ${existing.length ? "" : "opacity-60"}`}>
          <input type="radio" name="local-copy-mode" className={`${radioClass} mt-0.5`} checked={mode === "refresh"} disabled={!existing.length} onChange={() => setMode("refresh")} />
          <span><span className="block text-text-primary">Refresh an existing local copy</span><span className="block text-[12px] text-text-muted">{existing.length ? "Replaces its files and database with this download. Its local administrator account is kept." : "No local copy of this site yet."}</span></span>
        </label>
      </fieldset>
      {mode === "new" ? <label className="block"><span className={fieldLabelClass}>Local site name</span><input className={controlClass("default", "text-base sm:text-[14px]")} value={name} maxLength={60} onChange={e => setName(e.target.value)} required disabled={copies.pending || !available} /></label>
        : <label className="block"><span className={fieldLabelClass}>Local copy to refresh</span>
          <Select aria-label="Local copy to refresh" className={selectClass("default", "w-full")} value={replaceSiteId} onChange={e => setReplaceSiteId(e.target.value)} disabled={copies.pending || !available}>
            <option value="">Choose local copy</option>
            {existing.map(site => <option key={site.id} value={site.id} disabled={site.status !== "running"}>{copyLabel(site)}{site.status === "running" ? "" : " (start it first)"}</option>)}
          </Select>
        </label>}
      {running && <p className="text-xs text-text-secondary">Wait for the current copy to finish before starting another.</p>}
      <Btn type="submit" variant="primary" disabled={!canStart} loading={copies.pending}>{mode === "refresh" ? "Refresh local copy" : "Create local copy"}</Btn>
    </form>}
    {!pullId && copies.data && !copies.copies.length && <p className="text-sm text-text-secondary">No local copies yet. Finish a pull, then choose Make a local copy on its verified download.</p>}
    {copies.copies.map(copy => <div key={copy.id} className="min-w-0 space-y-2 border-t border-border-muted pt-2">
      <p className="break-words font-medium">{copy.name}</p>
      <p role="status">{copyStatus(copy)}</p>
      {copy.phase === "uploading" && copy.totalFiles > 0 && <progress className="h-2 w-full accent-indigo-500" aria-label="Files copied to local WordPress" value={copy.index} max={copy.totalFiles} />}
      {copy.error && <p role="alert" className="break-words text-status-error">{copy.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {copy.phase !== "complete" && !(copy.running || copy.busy) && <Btn disabled={!available || copies.pending} onClick={() => void copies.command({ action: "run", id: copy.id }).catch(() => {})}>{copy.error ? "Retry local copy" : "Resume local copy"}</Btn>}
        {copy.phase === "complete" && copy.targetUrl && <a className="underline" href={copy.targetUrl} target="_blank" rel="noreferrer">Open local website</a>}
        {copy.targetId && <a className="underline" href={`#/wordpress?site=${encodeURIComponent(copy.targetId)}`}>View local site</a>}
      </div>
    </div>)}
    {copies.error && <p role="alert" className="text-sm text-status-error">Could not load local copies: {copies.error.message}</p>}
    {copies.commandError && <p role="alert" className="text-status-error">{copies.commandError.message}</p>}
  </section>;
}
