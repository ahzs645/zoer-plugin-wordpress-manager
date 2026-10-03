import { useState } from "react";
import { wordPressTransferMatchesSite } from "../wordpressSiteIdentity";
import { History } from "lucide-react";
import type { TransferHistoryItem, TransferHistoryKind } from "../../../lib/api/types/wordpress-transfer";
import type { WordPressManagedSite } from "../../../lib/api/types/wordpress-manager";
import { useTransferHistory } from "../../../lib/queries/wordpress-transfer";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import { formatTransferBytes } from "../wordpressPullProgress";
import { filterTransfers, formatDuration } from "./transferLabels";

export const HISTORY_KIND_LABELS: Record<TransferHistoryKind, string> = { pull: "Pull", push: "Push", replace: "Find & Replace", "local-copy": "Local copy" };

function statusTone(status: string) {
  if (["complete", "ready", "succeeded"].includes(status)) return "text-status-success";
  if (["failed", "error"].includes(status)) return "text-status-error";
  if (["rolled_back", "cancelled"].includes(status)) return "text-text-muted";
  return "text-status-warning";
}

function errorText(error: TransferHistoryItem["lastError"]) {
  if (!error) return "";
  return typeof error === "string" ? error : error.message;
}

/** All transfers across sites, newest first (`GET /transfers`). */
export default function TransferHistory({ sites, canonicalId = id => id }: { sites: WordPressManagedSite[]; canonicalId?: (id: string) => string }) {
  const [siteId, setSiteId] = useState("");
  const [kind, setKind] = useState("");
  const history = useTransferHistory();
  const items = filterTransfers(history.data ?? [], { siteId: "", kind }).filter(item => wordPressTransferMatchesSite(item, siteId, canonicalId));
  const siteChoices = [...new Map((history.data ?? []).flatMap(item => [[canonicalId(item.siteId), item.siteName], ...(item.sourceSiteId ? [[canonicalId(item.sourceSiteId), item.sourceName ?? item.sourceSiteId]] : [])] as Array<[string, string]>)).entries()]
    .map(([id, name]) => ({ id, name: sites.find(site => site.id === id)?.name ?? name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return <section className="min-w-0 space-y-4" aria-label="Transfer history">
    <div className="flex items-center gap-2"><History className="h-4 w-4 shrink-0" aria-hidden="true" /><h4 className="text-base font-semibold text-text-heading">Transfer history</h4></div>
    <p className="text-sm text-text-secondary">Pulls, pushes, Find & Replace jobs and local copies across every site. Open a site's Transfers dialog to control a running transfer.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Site</span>
        <Select searchable aria-label="Filter transfers by site" className={selectClass("default", "w-full")} value={canonicalId(siteId)} onChange={event => setSiteId(event.target.value)}>
          <option value="">All sites</option>
          {siteChoices.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </Select>
      </label>
      <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Type</span>
        <Select aria-label="Filter transfers by type" className={selectClass("default", "w-full")} value={kind} onChange={event => setKind(event.target.value)}>
          <option value="">All types</option>
          {Object.entries(HISTORY_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </label>
    </div>
    {history.isLoading && <p className="text-sm text-text-secondary">Loading transfers…</p>}
    {history.error && <p role="alert" className="text-sm text-status-error">Could not load transfer history: {history.error.message} <Btn size="sm" onClick={() => void history.refetch()}>Retry</Btn></p>}
    {history.data && !items.length && <p className="text-sm text-text-secondary">{history.data.length ? "No transfers match these filters." : "No transfers yet."}</p>}
    <ul className="min-w-0 space-y-2">
      {items.map(item => {
        const start = Date.parse(item.startedAt), end = item.finishedAt ? Date.parse(item.finishedAt) : NaN;
        const error = errorText(item.lastError);
        return <li key={`${item.kind}:${item.id}`} className="min-w-0 rounded-md border border-border-muted bg-surface-primary/50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary"><span className="mr-2 rounded border border-border-muted px-1.5 py-0.5 text-[12px] font-normal text-text-secondary">{HISTORY_KIND_LABELS[item.kind] ?? item.kind}</span>
                <span className="break-words">{item.sourceName ? `${item.sourceName} → ${item.siteName}` : item.siteName}</span></p>
              <p className="mt-1 break-words text-[13px] text-text-secondary">{item.summary}</p>
            </div>
            <span className={`shrink-0 text-[12px] font-medium ${statusTone(item.status)}`}>{item.status.charAt(0).toUpperCase() + item.status.slice(1).replaceAll("_", " ")}</span>
          </div>
          <p className="mt-1 text-[12px] tabular-nums text-text-secondary">
            {Number.isFinite(start) ? new Date(start).toLocaleString() : item.startedAt}
            {Number.isFinite(start) && Number.isFinite(end) ? ` · ${formatDuration(end - start)}` : ""}
            {typeof item.bytes === "number" && item.bytes > 0 ? ` · ${formatTransferBytes(item.bytes)}` : ""}
          </p>
          {error && <p className="mt-1 break-words text-[12px] text-status-error">{error}</p>}
        </li>;
      })}
    </ul>
  </section>;
}
