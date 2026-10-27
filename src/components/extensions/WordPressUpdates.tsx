import { useState } from "react";
import { Btn } from "@zoer/plugin-ui/controls";
import type { WordPressDeployment } from "../../lib/api";
import { extensionDisplayName } from "./wordpressNames";
import { wordpressExtensionLogLabel, wordpressExtensionLogSlugs, wordpressExtensionLogs, wordpressExtensionLogStatus } from "./wordpressUpdateLogs";
import { formatWhen } from "../../lib/formatWhen";
import FilterChips from "./FilterChips";
import { RefreshCw } from "lucide-react";

/** Activity's plugin and theme changes: the receipts Zoer saved for this website's connections. */
export default function ExtensionChangeLog({ siteIds, deployments, loading, error, onRefresh }: {
  siteIds: string[];
  deployments: WordPressDeployment[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "plugin" | "theme">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const logs = wordpressExtensionLogs(deployments, siteIds);
  const filtered = logs.filter(log => filter === "all" || log.details.kind === filter);
  return <section aria-label="Plugin and theme changes" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-text-heading">Plugin &amp; theme changes</h3>
      <div className="flex items-center gap-2"><FilterChips label="Filter plugin and theme changes" options={[{ value: "all", label: "All" }, { value: "plugin", label: "Plugins" }, { value: "theme", label: "Themes" }]} value={filter} onChange={setFilter} /><Btn size="sm" variant="ghost" iconOnly icon={<RefreshCw className="h-3.5 w-3.5" />} tooltip="Refresh" aria-label="Refresh plugin and theme changes" loading={loading} onClick={onRefresh}>{null}</Btn></div>
    </div>
    <p className="text-xs text-text-secondary">Changes made through Zoer. Changes made directly in WordPress or your hosting dashboard aren't listed here.</p>
    {error && <p role="alert" className="text-sm text-status-warning">Changes unavailable: {error}</p>}
    {loading && !filtered.length ? <p className="text-sm text-text-secondary">Loading changes…</p> : !filtered.length ? !error && <p className="text-sm text-text-secondary">No {filter === "all" ? "plugin or theme" : filter} changes yet.</p> : <ul className="space-y-2">{filtered.map(log => {
      const names = wordpressExtensionLogSlugs(log).map(slug => extensionDisplayName(null, slug));
      return <li key={log.id} className="min-w-0 rounded-md border border-border-muted p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-text-heading">{wordpressExtensionLogLabel(log)}{names.length > 0 && <span className="font-normal text-text-secondary">: {names.join(", ")}</span>}</h4>
            <p className="mt-1 text-xs text-text-secondary">{formatWhen(log.createdAt)} · <span className={log.status === "failed" || log.status === "outcome_unknown" ? "text-status-warning" : undefined}>{wordpressExtensionLogStatus(log)}</span></p>
          </div>
          <Btn size="sm" variant="ghost" aria-expanded={expanded === log.id} onClick={() => setExpanded(expanded === log.id ? null : log.id)}>{expanded === log.id ? "Hide details" : "Details"}</Btn>
        </div>
        {log.error && <p className="mt-2 break-words text-sm text-status-warning">{log.error}</p>}
        {expanded === log.id && <dl className="mt-3 grid min-w-0 grid-cols-1 gap-1 border-t border-border-muted pt-3 text-xs text-text-secondary sm:grid-cols-[auto_1fr] sm:gap-x-3"><dt>Last step</dt><dd className="break-words">{log.step}</dd><dt>Updated</dt><dd>{formatWhen(log.updatedAt)}</dd>{log.completedAt && <><dt>Completed</dt><dd>{formatWhen(log.completedAt)}</dd></>}{typeof log.details.rollback === "string" && <><dt>If it fails</dt><dd>{log.details.rollback.replaceAll("-", " ")}</dd></>}<dt>Receipt</dt><dd className="break-all font-mono">{log.id}</dd></dl>}
      </li>;
    })}</ul>}
  </section>;
}
