import { useState } from "react";
import { Btn, StatusBadge, type StatusTone } from "@zoer/plugin-ui/controls";
import type { WordPressDeployment, WordPressManagedSite } from "../../lib/api";
import PluginSiteRuns from "./pluginEngine/PluginSiteRuns";
import PluginTransferHistory from "./pluginEngine/PluginTransferHistory";
import ExtensionChangeLog from "./WordPressUpdates";
import { siteAddressHost } from "./wordpressNames";
import { formatWhen } from "../../lib/formatWhen";
import FilterChips from "./FilterChips";

const RECEIPT_TITLES: Record<string, string> = { publish: "Published", replace: "Replaced live site", deploy: "Deployed", "hostinger-publish": "Published through Hostinger", "full-site": "Full site published", "site-create": "Website created", "site-provision": "Website created with Zoer Connect" };

function receiptTone(status: string): StatusTone {
  if (status === "succeeded" || status === "verified") return "success";
  if (status === "failed" || status === "outcome_unknown") return "error";
  return "warning";
}

/**
 * One place for what happened to a website: running transfers with their controls, the transfer
 * history (this site or every site), plugin and theme changes, and Hostinger publishing receipts.
 */
export default function SiteActivity({ site, transferSiteIds, siteIds, sites, canonicalId, deployments, loading, error, onRefresh, busy, onVerify }: {
  site: WordPressManagedSite;
  /** The connections whose transfers belong to this website (its Zoer Connect site for a live one). */ transferSiteIds: string[];
  /** Every connection ID of this website, for change receipts. */ siteIds: string[];
  sites: WordPressManagedSite[];
  canonicalId: (id: string) => string;
  /** This website's receipts. */ deployments: WordPressDeployment[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  busy: string | null;
  onVerify: (deployment: WordPressDeployment) => void;
}) {
  const [scope, setScope] = useState<"site" | "all">("site");
  const receipts = deployments.filter(item => item.type !== "extension-change");
  const historySiteId = transferSiteIds[0] ?? site.id;
  return <div className="min-w-0 space-y-6">
    {[...new Set(transferSiteIds)].map(id => <PluginSiteRuns key={`running:${id}`} siteId={id} activeOnly />)}
    <section aria-label="Transfers" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-heading">Transfers</h3>
        <FilterChips label="Whose transfers" options={[{ value: "site", label: "This site" }, { value: "all", label: "All sites" }] as const} value={scope} onChange={setScope} />
      </div>
      {scope === "site"
        ? <PluginTransferHistory key={`history:${historySiteId}`} siteId={historySiteId} />
        : <PluginTransferHistory sites={sites} canonicalId={canonicalId} heading={false} />}
    </section>
    {scope === "site" && <ExtensionChangeLog siteIds={siteIds} deployments={deployments} loading={loading} error={error} onRefresh={onRefresh} />}
    {scope === "site" && receipts.length > 0 && <section aria-label="Publishing receipts" className="min-w-0 space-y-3">
      <h3 className="text-sm font-semibold text-text-heading">Publishing through Hostinger</h3>
      <ul className="space-y-2">{receipts.slice(0, 50).map(item => <li key={item.id} className="min-w-0 rounded-md border border-border-muted p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-heading">{RECEIPT_TITLES[item.type] ?? (item.type.charAt(0).toUpperCase() + item.type.slice(1).replaceAll("-", " "))}{item.domain && <span className="font-normal text-text-secondary"> · {siteAddressHost(item.domain)}</span>}</p>
            {item.step && <p className="mt-1 break-words text-[13px] text-text-secondary">{item.step}</p>}
            <p className="mt-1 text-xs text-text-secondary">{formatWhen(item.updatedAt)}</p>
          </div>
          <div className="flex items-center gap-2">{item.status === "verification_required" && <Btn size="sm" loading={busy === `verify:${item.id}`} onClick={() => onVerify(item)}>Mark verified</Btn>}<StatusBadge tone={receiptTone(item.status)}>{item.status === "verification_required" ? "Needs verification" : item.status.charAt(0).toUpperCase() + item.status.slice(1).replaceAll("_", " ")}</StatusBadge></div>
        </div>
        {item.error && <p className="mt-2 break-words text-[12px] text-status-error">{item.error}</p>}
      </li>)}</ul>
    </section>}
  </div>;
}
