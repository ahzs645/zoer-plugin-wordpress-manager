import { ArrowDown, ArrowLeftRight, ArrowUp, Globe2, Link2, Loader2, Server } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";
import { useRecentRuns } from "../../lib/queries/plugin-engine";
import { findOneClickPush, pushSummary, type PushSummary } from "./pluginEngine/oneClickRuns";
import { ENGINE_ACTIONS } from "./pluginEngine/runState";

const host = (site: WordPressManagedSite) => (site.managedUrl || site.url || site.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const LOCAL = ["ddev", "kubernetes"];
const PUSH_ACTIONS = [ENGINE_ACTIONS.push, ENGINE_ACTIONS.localExport, ENGINE_ACTIONS.preview] as const;
const TONE: Record<PushSummary["tone"], string> = { running: "text-text-primary", warning: "text-status-warning", success: "text-status-success", error: "text-status-error", neutral: "text-text-secondary" };

function Node({ icon, label, site, onClick }: { icon: React.ReactNode; label: string; site: WordPressManagedSite; onClick?: () => void }) {
  const body = <>
    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">{icon}{label}</span>
    <span className="mt-0.5 block truncate font-medium text-text-primary">{site.name}</span>
    <span className="block truncate text-[12px] text-text-secondary">{host(site)}</span>
  </>;
  const className = "block min-w-0 flex-1 rounded-lg border border-border-default bg-surface-primary px-3 py-2 text-left";
  return onClick ? <button type="button" className={`${className} hover:bg-surface-hover`} onClick={onClick}>{body}</button> : <div className={className}>{body}</div>;
}

/** The newest push from `local` to `live` as one line; opens the Push to live dialog, which shows it in full. */
function LastPush({ local, live, onOpen }: { local: WordPressManagedSite; live: WordPressManagedSite | null; onOpen: () => void }) {
  const runs = useRecentRuns(PUSH_ACTIONS);
  const found = findOneClickPush(runs.data ?? [], local.id);
  if (!found) return null;
  const summary = pushSummary(found, live ? host(live) : "the live site");
  return <button type="button" onClick={onOpen} className={`flex min-h-8 max-w-full items-center gap-1.5 text-left text-xs ${TONE[summary.tone]} hover:underline`}>
    {summary.tone === "running" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />}<span className="min-w-0 break-words">{summary.text}</span>
  </button>;
}

/**
 * Local and live, the one place to move a site between its local copy and the live site (on
 * Overview and on Publish): the pair, Push to live (one press: export, compare and push run by
 * themselves) and Pull from live, and how the last push went. From the live side: its local copies.
 */
export default function SiteSyncCard({ site, live, copies, onPush, onRefresh, onSelect, onCompare, makeCopy, onGoLive, goLive, onLink, onAddCopy, paused = false }: {
  site: WordPressManagedSite;
  /** For a local site: the live site it was copied from, if any. */ live: WordPressManagedSite | null;
  /** For a live site: its local copies. */ copies: WordPressManagedSite[];
  onPush: (local: WordPressManagedSite) => void;
  onRefresh: (local: WordPressManagedSite, live: WordPressManagedSite) => void;
  onSelect: (site: WordPressManagedSite) => void;
  /** Compares a live site with one of its local copies. */ onCompare?: (live: WordPressManagedSite, local: WordPressManagedSite) => void;
  /** The live site's "Make a local copy" button. */ makeCopy?: React.ReactNode;
  /** Create a live site for a local site that has none (needs a Hostinger account). */ onGoLive?: () => void;
  /** A Create a live site process under way for this local site: its one-line state. */ goLive?: { text: string; tone: "running" | "warning" | "error" } | null;
  /** For a local site: link it to the site it is a copy of, or change that site. */ onLink?: () => void;
  /** For a live site: add an existing local site to its local copies. */ onAddCopy?: () => void;
  /** A transfer is changing this site: pushing and pulling wait for it. */ paused?: boolean;
}) {
  const pausedNote = paused && <p className="text-xs text-status-warning">A transfer is changing this site. Push and pull come back when it finishes.</p>;
  // A copy of another local site (for example a test of a test) names its source, not "live".
  const localSource = !!live && LOCAL.includes(live.provider);
  const target = localSource ? "source" : "live";
  if (LOCAL.includes(site.provider)) return <section aria-label={localSource ? "Copy and source" : "Local and live"} className="space-y-3 rounded-lg border border-border-default p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 className="text-sm font-semibold text-text-heading">{localSource ? "Copy and source" : "Local and live"}</h4>
      {goLive ? <button type="button" onClick={onGoLive} className={`flex min-h-8 max-w-full items-center gap-1.5 text-left text-xs hover:underline ${goLive.tone === "error" ? "text-status-error" : goLive.tone === "warning" ? "text-status-warning" : "text-text-primary"}`}>{goLive.tone === "running" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />}<span className="min-w-0 break-words">{goLive.text}</span></button>
        : <LastPush local={site} live={live} onOpen={() => onPush(site)} />}
    </div>
    {live ? <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <Node icon={<Server className="h-3 w-3" aria-hidden="true" />} label={localSource ? "This site · copy" : "This site · local"} site={site} />
      <ArrowLeftRight className="h-4 w-4 shrink-0 self-center text-text-muted" aria-hidden="true" />
      <Node icon={localSource ? <Server className="h-3 w-3" aria-hidden="true" /> : <Globe2 className="h-3 w-3" aria-hidden="true" />} label={localSource ? "Source · local" : "Live"} site={live} onClick={() => onSelect(live)} />
    </div> : <p className="text-sm text-text-secondary">No live site yet. Create one on Hostinger with a temporary domain, or link this site to a live site you already have.</p>}
    <div className="flex flex-wrap gap-2">
      {!live && onGoLive && <Btn variant="primary" icon={<Globe2 className="h-4 w-4" />} disabled={paused && !goLive} onClick={onGoLive}>{goLive ? "View live site setup" : "Create a live site"}</Btn>}
      {!live && onLink && <Btn icon={<Link2 className="h-4 w-4" />} onClick={onLink}>Link to a live site</Btn>}
      <Btn variant={!live && onGoLive ? "secondary" : "primary"} icon={<ArrowUp className="h-4 w-4" />} disabled={paused} onClick={() => onPush(site)}>{live ? `Push to ${target}` : "Push to a live site"}</Btn>
      {live && <Btn icon={<ArrowDown className="h-4 w-4" />} disabled={paused} onClick={() => onRefresh(site, live)}>Pull from {target}</Btn>}
      {live && onCompare && <Btn variant="ghost" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => onCompare(live, site)}>Compare</Btn>}
      {live && onLink && <Btn variant="ghost" icon={<Link2 className="h-4 w-4" />} onClick={onLink}>Change {target} site</Btn>}
    </div>
    {pausedNote}
  </section>;
  return <section aria-label="Local copies" className="space-y-3 rounded-lg border border-border-default p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-text-heading">Local copies</h4><div className="flex flex-wrap gap-2">{onAddCopy && <Btn size="sm" variant="ghost" icon={<Link2 className="h-3.5 w-3.5" />} onClick={onAddCopy}>Add a local site</Btn>}{makeCopy}</div></div>
    {copies.length > 0 ? <ul className="divide-y divide-border-muted rounded-md border border-border-muted">{copies.map(copy => <li key={copy.id} className="min-w-0 p-2.5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(copy)}>
          <span className="flex items-center gap-1.5 truncate font-medium"><Server className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />{copy.name}</span>
          <span className="block truncate text-[12px] text-text-secondary">{host(copy)} · {copy.status}</span>
        </button>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onCompare && <Btn size="sm" variant="ghost" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => onCompare(site, copy)}>Compare</Btn>}
          <Btn size="sm" icon={<ArrowDown className="h-3.5 w-3.5" />} disabled={paused} onClick={() => onRefresh(copy, site)}>Pull</Btn>
          <Btn size="sm" variant="primary" icon={<ArrowUp className="h-3.5 w-3.5" />} disabled={paused} onClick={() => onPush(copy)}>Push to live</Btn>
        </div>
      </div>
      <LastPush local={copy} live={site} onOpen={() => onPush(copy)} />
    </li>)}</ul> : <p className="text-sm text-text-secondary">No local copy yet. Make one to change the site safely, then push the changes back here. A local site you already have can be added instead.</p>}
    {pausedNote}
  </section>;
}
