import { useState } from "react";
import { Btn, EmptyState, Select, selectClass } from "@zoer/plugin-ui/controls";
import type { WordPressDeployment, WordPressManagedSite } from "../../lib/api";
import WordPressCoreUpdates from "./WordPressCoreUpdates";
import { wordpressExtensionLogLabel, wordpressExtensionLogSlugs, wordpressExtensionLogs, wordpressExtensionLogStatus } from "./wordpressUpdateLogs";

export default function WordPressUpdates({ site, siteIds, deployments, loading, error, onRefresh, onExtensions }: {
  site: WordPressManagedSite | null;
  siteIds: string[];
  deployments: WordPressDeployment[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onExtensions: (kind: "plugins" | "themes") => void;
}) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!site) return <EmptyState title="Select a site" />;
  const logs = wordpressExtensionLogs(deployments, siteIds);
  const filtered = logs.filter(log => filter === "all" || log.details.kind === filter);
  return <div className="min-w-0 space-y-5">
    {site.provider === "ddev" ? <WordPressCoreUpdates key={site.id} site={site} /> : <section className="rounded-md border border-border-default p-3"><h3 className="text-sm font-semibold text-text-heading">WordPress core</h3><p className="mt-1 text-sm">Installed: {site.wordpressVersion || "Not reported"}</p><p className="mt-2 text-xs text-text-secondary">Managed core checks and updates are available for local DDEV sites. Use your hosting dashboard or WordPress administrator for this connection.</p></section>}
    <section className="rounded-md border border-border-default p-3"><h3 className="text-sm font-semibold text-text-heading">Plugin and theme updates</h3><p className="mt-1 text-sm text-text-secondary">Review installed versions and available updates before applying a change.</p><div className="mt-3 flex flex-wrap gap-2"><Btn onClick={() => onExtensions("plugins")}>Manage plugins</Btn><Btn onClick={() => onExtensions("themes")}>Manage themes</Btn></div><p className="mt-3 text-xs text-text-secondary">Automatic update policy is managed in WordPress or your hosting dashboard. Zoer does not change that policy here.</p></section>
    <section aria-label="Extension change logs" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-text-heading">Extension change logs</h3><div className="flex flex-wrap gap-2"><Select aria-label="Filter extension logs" presentation="dropdown" searchable={false} className={selectClass("compact")} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Plugins and themes</option><option value="plugin">Plugins</option><option value="theme">Themes</option></Select><Btn loading={loading} onClick={onRefresh}>Refresh logs</Btn></div></div>
      <p className="text-xs text-text-secondary">Saved Zoer receipts for this website's connections. Queued provider requests are awaiting verification.</p>
      <details><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-xs text-text-secondary">Log coverage</summary><p className="mt-1 text-xs text-text-secondary">Changes made directly in WordPress or hPanel are not included. Failed extension requests are recorded in Zoer's audit log; core updates show their latest operation above. Website health after a change is not recorded in these receipts.</p></details>
      {error && <p role="alert" className="text-sm text-status-warning">Logs unavailable: {error}</p>}
      {loading && !filtered.length ? <p className="text-sm text-text-secondary">Loading logs…</p> : !filtered.length ? !error && <p className="text-sm text-text-secondary">No saved {filter === "all" ? "extension" : filter} change receipts.</p> : <div className="space-y-2">{filtered.map(log => <article key={log.id} className="min-w-0 rounded-md border border-border-muted p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="text-sm font-medium text-text-heading">{wordpressExtensionLogLabel(log)}</h4><p className="mt-1 break-words text-sm text-text-secondary">{wordpressExtensionLogSlugs(log).join(", ") || "Extensions not reported"}</p><p className="mt-1 text-xs text-text-secondary">Requested {new Date(log.createdAt).toLocaleString()}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`text-xs ${log.status === "failed" || log.status === "outcome_unknown" ? "text-status-warning" : "text-text-secondary"}`}>{wordpressExtensionLogStatus(log)}</span><Btn size="sm" aria-expanded={expanded === log.id} onClick={() => setExpanded(expanded === log.id ? null : log.id)}>{expanded === log.id ? "Hide details" : "View details"}</Btn></div></div>
        {log.error && <p className="mt-2 break-words text-sm text-status-warning">{log.error}</p>}
        {expanded === log.id && <dl className="mt-3 grid min-w-0 grid-cols-1 gap-1 border-t border-border-muted pt-3 text-xs text-text-secondary sm:grid-cols-[auto_1fr]"><dt>Last reported step</dt><dd className="break-words">{log.step}</dd><dt>Updated</dt><dd>{new Date(log.updatedAt).toLocaleString()}</dd>{log.completedAt && <><dt>Completed</dt><dd>{new Date(log.completedAt).toLocaleString()}</dd></>}<dt>Receipt</dt><dd className="break-all font-mono">{log.id}</dd><dt>Website state after change</dt><dd>Not recorded in this receipt.</dd>{typeof log.details.rollback === "string" && <><dt>Recovery policy</dt><dd>{log.details.rollback.replaceAll("-", " ")}</dd></>}</dl>}
      </article>)}</div>}
    </section>
  </div>;
}
