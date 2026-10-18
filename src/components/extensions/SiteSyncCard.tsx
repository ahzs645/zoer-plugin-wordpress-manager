import { ArrowDown, ArrowUp, Globe2, Server } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";

const host = (site: WordPressManagedSite) => (site.managedUrl || site.url || site.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

function Node({ icon, label, site }: { icon: React.ReactNode; label: string; site: WordPressManagedSite }) {
  return <div className="min-w-0 flex-1 rounded-lg border border-border-default p-2.5">
    <p className="flex items-center gap-1.5 text-[12px] text-text-secondary">{icon}{label}</p>
    <p className="truncate font-medium text-text-primary">{site.name}</p>
    <p className="truncate text-[12px] text-text-secondary">{host(site)}</p>
  </div>;
}

/**
 * The local ⇄ live pathway on a site's Overview: where this site's counterpart is and the two
 * moves between them. Push opens the guided Push to live dialog; Pull refreshes the local copy
 * (or makes one, from the live side).
 */
export default function SiteSyncCard({ site, live, copies, onPush, onRefresh, onSelect, makeCopy, paused = false }: {
  site: WordPressManagedSite;
  /** For a local site: the live site it was copied from, if any. */ live: WordPressManagedSite | null;
  /** For a live site: its local copies. */ copies: WordPressManagedSite[];
  onPush: (local: WordPressManagedSite) => void;
  onRefresh: (local: WordPressManagedSite, live: WordPressManagedSite) => void;
  onSelect: (site: WordPressManagedSite) => void;
  /** The live site's "Make a local copy" button. */ makeCopy?: React.ReactNode;
  /** A transfer is changing this site: pushing and pulling wait for it. */ paused?: boolean;
}) {
  const local = site.provider === "ddev";
  const arrows = <div className="flex shrink-0 items-center justify-center gap-0.5 text-text-secondary sm:flex-col" aria-hidden="true"><ArrowUp className="h-4 w-4" /><ArrowDown className="h-4 w-4" /></div>;
  if (local) return <section aria-label="Local and live" className="space-y-3 rounded-lg border border-border-default p-4">
    <h4 className="text-sm font-medium text-text-heading">Local and live</h4>
    {live ? <>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Node icon={<Server className="h-3.5 w-3.5" aria-hidden="true" />} label="This local site" site={site} />
        {arrows}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(live)}><Node icon={<Globe2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Live site" site={live} /></button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Btn variant="primary" icon={<ArrowUp className="h-4 w-4" />} disabled={paused} onClick={() => onPush(site)}>Push to live</Btn>
        <Btn icon={<ArrowDown className="h-4 w-4" />} disabled={paused} onClick={() => onRefresh(site, live)}>Pull from live</Btn>
      </div>
      <p className="text-xs text-text-secondary">{paused ? "A transfer is changing this site. Push and pull are available again when it finishes." : "Push sends your local changes (code only, or everything) with a review before the live site switches. Pull refreshes this copy from live."}</p>
    </> : <>
      <p className="text-sm text-text-secondary">Not linked to a live site.</p>
      <Btn icon={<ArrowUp className="h-4 w-4" />} disabled={paused} onClick={() => onPush(site)}>Push to a live site</Btn>
    </>}
  </section>;
  return <section aria-label="Local copies" className="space-y-3 rounded-lg border border-border-default p-4">
    <h4 className="text-sm font-medium text-text-heading">Local development</h4>
    {copies.length > 0 ? <ul className="space-y-2">{copies.map(copy => <li key={copy.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border-muted p-2.5 sm:flex-row sm:items-center">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(copy)}><span className="flex items-center gap-1.5 truncate font-medium"><Server className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{copy.name}</span><span className="block truncate text-[12px] text-text-secondary">{host(copy)} · {copy.status}</span></button>
      <div className="flex shrink-0 gap-2"><Btn size="sm" icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => onRefresh(copy, site)}>Pull</Btn><Btn size="sm" icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => onPush(copy)}>Push to live</Btn></div>
    </li>)}</ul> : <p className="text-sm text-text-secondary">Make a local copy to develop safely, then push your changes back here.</p>}
    {makeCopy}
  </section>;
}
