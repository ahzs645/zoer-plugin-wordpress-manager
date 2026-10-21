import { Globe2 } from "lucide-react";
import { EmptyState } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";
import { useCatalogKind } from "../../lib/queries/plugin-engine";
import HostingerSiteTools from "./HostingerSiteTools";
import PublicationStatus from "./pluginEngine/PublicationStatus";
import { parsePublicationCheck, publicationView } from "./pluginEngine/publicationCheck";

const TONE: Record<string, string> = { success: "text-status-success", warning: "text-status-warning", error: "text-status-error", running: "text-text-primary", info: "text-text-primary", neutral: "text-text-secondary" };

/**
 * A live site's Caching section: what visitors receive (the public website check, with Recheck
 * and Clear caches and recheck) and, for a Hostinger website, its hosting cache tools.
 */
export default function CachingTab({ site, hostinger, publicEndpoint, onReconnect }: {
  site: WordPressManagedSite | null;
  /** The site's Hostinger record, when it has one (hosting cache tools). */ hostinger: WordPressManagedSite | null;
  /** The site's Zoer Connect endpoint, whose public pages can be checked. */ publicEndpoint: { id: string; origin: string } | null;
  onReconnect?: () => void;
}) {
  if (!site) return <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Select a WordPress site" />;
  if (!publicEndpoint && !hostinger) return <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Nothing to check yet" description="Connect Zoer Connect on this site to check what visitors receive, or load its Hostinger account for the hosting cache." />;
  return <div className="min-w-0 space-y-4">
    {publicEndpoint
      ? <PublicationStatus key={publicEndpoint.id} siteId={publicEndpoint.id} siteUrl={publicEndpoint.origin} onReconnect={onReconnect} />
      : <p className="rounded-lg border border-border-default p-4 text-sm text-text-secondary">Checking what visitors receive needs Zoer Connect on this site.</p>}
    {hostinger && <HostingerSiteTools key={hostinger.id} site={hostinger} />}
  </div>;
}

/** The public website check's verdict as one item of the Overview summary; opens Caching. */
export function PublicWebsiteSummary({ siteId, onOpen }: { siteId: string; onOpen: () => void }) {
  const checks = useCatalogKind("publication-check");
  const check = parsePublicationCheck((checks.data ?? []).find(record => record.id === `publication-check:${siteId}`));
  const view = check ? publicationView(check) : null;
  return <button type="button" onClick={onOpen} className="min-w-0 text-left text-[13px] hover:underline">
    <span className={`font-medium ${view ? TONE[view.tone] ?? "text-text-secondary" : "text-text-secondary"}`}>{view ? view.label : "Not checked"}</span>
    {check?.checkedAt && <span className="block truncate text-[12px] text-text-secondary">Checked {new Date(check.checkedAt).toLocaleString()}</span>}
  </button>;
}
