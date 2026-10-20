import { Server } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";

const host = (site: WordPressManagedSite) => (site.managedUrl || site.url || site.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** Development on a live site's page: plugins and themes are built on one of its local copies, then pushed back as code. */
export default function LiveSiteDevelopment({ site, copies, onSelect, onMakeCopy }: { site: WordPressManagedSite; copies: WordPressManagedSite[]; onSelect: (site: WordPressManagedSite) => void; onMakeCopy: () => void }) {
  return <section aria-label="Develop on a local copy" className="space-y-3 rounded-lg border border-border-default p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-text-heading">Develop on a local copy</h4>
      <Btn size="sm" variant={copies.length ? "secondary" : "primary"} onClick={onMakeCopy}>{copies.length ? "Make another local copy" : "Make a local copy"}</Btn>
    </div>
    <p className="text-sm text-text-secondary">{site.name} is a live site. Build and test plugins and themes on a local copy of it, then push the code back here; live content stays as it is.</p>
    {copies.length > 0 ? <ul className="divide-y divide-border-muted rounded-md border border-border-muted">{copies.map(copy => <li key={copy.id} className="flex min-w-0 flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 truncate font-medium"><Server className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />{copy.name}</span><span className="block truncate text-[12px] text-text-secondary">{host(copy)} · {copy.status}</span></span>
      <Btn size="sm" variant="primary" onClick={() => onSelect(copy)}>Develop on this copy</Btn>
    </li>)}</ul> : <p className="text-sm text-text-secondary">No local copy yet. Making one downloads this site into a local WordPress site through Zoer Connect.</p>}
  </section>;
}
