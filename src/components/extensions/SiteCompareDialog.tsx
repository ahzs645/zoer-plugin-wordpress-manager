import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { Btn, Modal, StatusBadge, type StatusTone } from "@zoer/plugin-ui/controls";
import { wordpressQueries } from "../../lib/queries/wordpress";
import type { WordPressManagedSite } from "../../lib/api";
import { isLocalWordPress } from "./wordpressLifecycle";
import { COMPARE_STATE_LABELS, compareSites, compareSummary, extensionsReported, isDifference, type CompareRow, type CompareState } from "./siteCompare";

const STATE_TONES: Record<CompareState, StatusTone> = {
  "only-live": "warning",
  "only-local": "info",
  "version-differs": "warning",
  "status-differs": "neutral",
  same: "success",
  "not-reported": "neutral",
};

const KIND_LABELS: Record<CompareRow["kind"], string> = { core: "Core", php: "Server", plugin: "Plugin", theme: "Theme" };

/** A local copy can only be inspected while it runs; live sites always answer through their host. */
function inspectable(site: WordPressManagedSite) {
  return !isLocalWordPress(site) || site.status === "running";
}

/**
 * Live site and local copy side by side: WordPress and PHP versions, then plugins and themes that
 * differ. File-level differences are in the Push to live review, which this dialog links to.
 */
export default function SiteCompareDialog({ live, local, onClose, onStartSite, onReviewFiles }: {
  live: WordPressManagedSite;
  local: WordPressManagedSite;
  onClose: () => void;
  /** Starts a stopped local site (either side can be a DDEV site) so it can be inspected. */
  onStartSite?: (site: WordPressManagedSite) => void;
  /** Opens the Push to live review, which compares files with the live site. */
  onReviewFiles?: (local: WordPressManagedSite) => void;
}) {
  const [showSame, setShowSame] = useState(false);
  const liveReady = inspectable(live);
  const localReady = inspectable(local);
  const ready = liveReady && localReady;
  const stopped = [...(liveReady ? [] : [live]), ...(localReady ? [] : [local])];
  const livePlugins = useQuery({ ...wordpressQueries.site(live.id, "plugins"), enabled: liveReady });
  const liveThemes = useQuery({ ...wordpressQueries.site(live.id, "themes"), enabled: liveReady });
  const localPlugins = useQuery({ ...wordpressQueries.site(local.id, "plugins"), enabled: localReady });
  const localThemes = useQuery({ ...wordpressQueries.site(local.id, "themes"), enabled: localReady });
  const queries = [livePlugins, liveThemes, localPlugins, localThemes];
  // A disabled query stays pending forever, so only queries that run count as loading.
  const loading = ready && queries.some(query => query.isPending);
  const errors = [...new Set(queries.flatMap(query => [query.error?.message, ...(query.data?.errors ?? [])].filter((value): value is string => !!value)))];
  const report = (plugins: typeof livePlugins, themes: typeof liveThemes) => ({
    site: plugins.data?.site ?? null,
    plugins: plugins.data?.plugins ?? null,
    themes: themes.data?.themes ?? null,
    errors: [...(plugins.data?.errors ?? []), ...(themes.data?.errors ?? [])],
    failed: plugins.isError || themes.isError,
  });
  const liveReported = !loading && ready && extensionsReported(report(livePlugins, liveThemes));
  const localReported = !loading && ready && extensionsReported(report(localPlugins, localThemes));
  const unreported = loading || !ready ? [] : [...(liveReported ? [] : [live]), ...(localReported ? [] : [local])];

  const rows = useMemo(() => loading || !ready ? [] : compareSites({
    live: livePlugins.data?.site ?? live,
    local: localPlugins.data?.site ?? local,
    livePlugins: liveReported ? livePlugins.data?.plugins ?? [] : null,
    localPlugins: localReported ? localPlugins.data?.plugins ?? [] : null,
    liveThemes: liveReported ? liveThemes.data?.themes ?? [] : null,
    localThemes: localReported ? localThemes.data?.themes ?? [] : null,
  }), [loading, ready, live, local, liveReported, localReported, livePlugins.data, liveThemes.data, localPlugins.data, localThemes.data]);
  const summary = compareSummary(rows);
  const differences = rows.filter(isDifference);
  const others = rows.length - differences.length;
  const visible = showSame ? rows : differences;

  return <Modal mobileSheet size="lg" title={`Compare ${live.name}`} onClose={onClose} footer={<div className="flex flex-wrap justify-end gap-2">
    {onReviewFiles && local.capabilities.deploySource && <Btn icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => onReviewFiles(local)}>Compare files</Btn>}
    <Btn variant="primary" onClick={onClose}>Done</Btn>
  </div>}>
    <div className="space-y-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <SiteHeading label="Live" site={live} />
        <SiteHeading label="Local copy" site={local} />
      </div>
      {!ready ? <div className="space-y-2 rounded-md border border-border-default bg-surface-secondary/50 p-3">
        <p className="text-text-secondary">{stopped.map(site => site.name).join(" and ")} {stopped.length === 1 ? "is" : "are"} stopped. Start {stopped.length === 1 ? "it" : "them"} to compare plugins, themes and versions.</p>
        {onStartSite && <div className="flex flex-wrap gap-2">{stopped.map(site => <Btn key={site.id} size="sm" onClick={() => onStartSite(site)}>Start {site.name}</Btn>)}</div>}
      </div>
      : loading ? <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" />Reading both sites…</p>
      : <>
        {unreported.length > 0 && <p className="rounded-md border border-border-default bg-surface-secondary/50 p-2.5 text-[12px] text-text-secondary">
          {unreported.map(site => site.name).join(" and ")} didn't report {unreported.length === 1 ? "its" : "their"} plugins and themes, so they aren't compared. Only versions the hosts report are shown.
        </p>}
        <p role="status" className="text-text-secondary">
          {differences.length === 0 ? (unreported.length ? "No differences in what both sites report." : "No differences in WordPress, PHP, plugins or themes.") : `${differences.length} difference${differences.length === 1 ? "" : "s"}`}
          {differences.length > 0 && ` · ${(["version-differs", "only-live", "only-local", "status-differs"] as const).filter(state => summary[state]).map(state => `${summary[state]} ${COMPARE_STATE_LABELS[state].toLowerCase()}`).join(" · ")}`}
        </p>
        {visible.length > 0 && <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface-secondary/60 text-text-secondary"><tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Live</th><th className="px-3 py-2 font-medium">Local</th><th className="hidden px-3 py-2 font-medium sm:table-cell">Status</th></tr></thead>
            <tbody className="divide-y divide-border-muted">
              {visible.map(row => <tr key={row.key}>
                <td className="px-3 py-2"><span className="font-medium text-text-primary">{row.name}</span><span className="ml-1.5 text-text-muted">{KIND_LABELS[row.kind]}</span><span className="mt-1 block sm:hidden"><StatusBadge tone={STATE_TONES[row.state]}>{COMPARE_STATE_LABELS[row.state]}</StatusBadge></span></td>
                <td className="px-3 py-2 text-text-secondary">{row.live ?? "—"}</td>
                <td className="px-3 py-2 text-text-secondary">{row.local ?? "—"}</td>
                <td className="hidden px-3 py-2 sm:table-cell"><StatusBadge tone={STATE_TONES[row.state]}>{COMPARE_STATE_LABELS[row.state]}</StatusBadge></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
        {others > 0 && <Btn size="sm" variant="ghost" onClick={() => setShowSame(value => !value)}>{showSame ? "Hide matching items" : `Show ${others} matching or unreported item${others === 1 ? "" : "s"}`}</Btn>}
      </>}
      {errors.length > 0 && <p role="alert" className="text-[12px] text-status-warning">{errors.join(" ")}</p>}
      <p className="text-[12px] text-text-muted">Content, settings and uploads aren't compared here.{local.capabilities.deploySource && onReviewFiles ? " Compare files shows the changed theme, plugin and core files the way Push to live would send them." : ""}</p>
    </div>
  </Modal>;
}

function SiteHeading({ label, site }: { label: string; site: WordPressManagedSite }) {
  const host = (site.managedUrl || site.url || site.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return <div className="min-w-0 rounded-md border border-border-default p-2.5">
    <p className="text-[12px] text-text-secondary">{label}</p>
    <p className="truncate font-medium text-text-primary">{site.name}</p>
    <p className="truncate text-[12px] text-text-secondary">{host}</p>
  </div>;
}
