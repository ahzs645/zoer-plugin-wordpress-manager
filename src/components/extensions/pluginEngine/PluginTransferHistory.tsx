import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { Btn, Select, fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../../lib/api/types/wordpress-manager";
import { useCatalogKind, useRecentRuns, useSiteEngines } from "../../../lib/queries/plugin-engine";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import { formatTransferBytes } from "../wordpressPullProgress";
import { formatDuration } from "../wordpressTransfer/transferLabels";
import { ENGINE_ACTIONS, engineErrorMessage } from "./runState";
import { ENGINE_HISTORY_LABELS, filterEngineHistory, historyEmptyText, historySummaryHint, mergeEngineHistory, parseHistoryRecord, type EngineHistoryItem } from "./records";

const HISTORY_ACTIONS = [ENGINE_ACTIONS.pull, ENGINE_ACTIONS.localExport, ENGINE_ACTIONS.push, ENGINE_ACTIONS.replace, ENGINE_ACTIONS.copy, ENGINE_ACTIONS.restore] as const;

function statusTone(status: string) {
  if (["complete", "ready", "succeeded", "dry-run"].includes(status)) return "text-status-success";
  if (["failed", "error", "outcome_unknown"].includes(status)) return "text-status-error";
  if (["rolled_back", "cancelled"].includes(status)) return "text-text-muted";
  return "text-status-warning";
}
const statusText = (status: string) => status === "dry-run" ? "Dry run" : status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ").replaceAll("-", " ");

/**
 * Plugin-engine transfer history: `transfer-history` catalog records (including legacy items after
 * the operator migration) merged with `runs.recent` of the plugin-engine actions. With `siteId` the
 * list is fixed to that site; otherwise it renders only once the plugin engine has been used.
 */
export default function PluginTransferHistory({ siteId: fixedSiteId, sites: givenSites, canonicalId = id => id, disclosure = false }: { siteId?: string; sites?: WordPressManagedSite[]; canonicalId?: (id: string) => string; /** With `siteId`: a collapsed "History" disclosure whose heading says how many entries there are. */ disclosure?: boolean }) {
  const [siteId, setSiteId] = useState("");
  const [kind, setKind] = useState("");
  const listed = useQuery({ ...wordpressQueries.sites(), enabled: !givenSites });
  const sites = givenSites ?? listed.data ?? [];
  const records = useCatalogKind("transfer-history");
  const runs = useRecentRuns(HISTORY_ACTIONS);
  const engines = useSiteEngines(!fixedSiteId);
  const merged = mergeEngineHistory((records.data ?? []).map(parseHistoryRecord).filter((item): item is EngineHistoryItem => !!item), runs.data ?? []);
  const items = filterEngineHistory(merged, { siteId: fixedSiteId ?? siteId, kind, canonicalId });
  const name = (id: string | undefined, fallback?: string) => !id ? fallback ?? "" : sites.find(site => site.id === id)?.name ?? fallback ?? id;
  const used = merged.length > 0 || (engines.data ?? []).some(record => (record.data as { engine?: unknown })?.engine === "plugin");
  if (!fixedSiteId && !used) return null;
  const loading = records.isLoading || runs.isLoading;
  const error = records.error ?? runs.error;
  const siteChoices = [...new Map(merged.flatMap(item => [[canonicalId(item.siteId), name(item.siteId, item.siteName)], ...(item.sourceSiteId ? [[canonicalId(item.sourceSiteId), name(item.sourceSiteId)]] : [])] as Array<[string, string]>).filter(([id]) => id)).entries()]
    .map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));

  const list = <section className="min-w-0 space-y-4" aria-label="Plugin-engine transfer history">
    {!fixedSiteId && <>
      <div className="flex items-center gap-2"><FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" /><h4 className="text-base font-semibold text-text-heading">Plugin-engine transfers</h4></div>
      <p className="text-sm text-text-secondary">Transfers of sites on the plugin engine (test), plus migrated legacy records. Open a site's Transfers dialog to control a running transfer.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Site</span>
          <Select searchable aria-label="Filter plugin-engine transfers by site" className={selectClass("default", "w-full")} value={siteId ? canonicalId(siteId) : ""} onChange={event => setSiteId(event.target.value)}>
            <option value="">All sites</option>
            {siteChoices.map(site => <option key={site.id} value={site.id}>{site.label}</option>)}
          </Select>
        </label>
        <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Type</span>
          <Select aria-label="Filter plugin-engine transfers by type" className={selectClass("default", "w-full")} value={kind} onChange={event => setKind(event.target.value)}>
            <option value="">All types</option>
            {Object.entries(ENGINE_HISTORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
      </div>
    </>}
    {loading && <p className="text-sm text-text-secondary">Loading transfers…</p>}
    {error && <p role="alert" className="text-sm text-status-error">Could not load plugin-engine history: {engineErrorMessage(error)} <Btn size="sm" onClick={() => { void records.refetch(); void runs.refetch(); }}>Retry</Btn></p>}
    {!loading && !error && !items.length && <p className="text-sm text-text-secondary">{historyEmptyText({ siteScoped: !!fixedSiteId, anyHistory: merged.length > 0 })}</p>}
    <ul className="min-w-0 space-y-2">
      {items.map(item => {
        const start = Date.parse(item.startedAt), end = item.finishedAt ? Date.parse(item.finishedAt) : NaN;
        const site = name(item.siteId, item.siteName) || (item.kind === "restore" ? "New local site" : "");
        return <li key={item.key} className="min-w-0 rounded-md border border-border-muted bg-surface-primary/50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">
                <span className="mr-2 rounded border border-border-muted px-1.5 py-0.5 text-[12px] font-normal text-text-secondary">{ENGINE_HISTORY_LABELS[item.kind]}</span>
                <span className="mr-2 rounded border border-border-muted px-1.5 py-0.5 text-[12px] font-normal text-text-secondary">{item.engine === "legacy" ? "Legacy (migrated)" : "Plugin engine"}</span>
                <span className="break-words">{item.sourceSiteId ? `${name(item.sourceSiteId)} → ${site}` : site}</span>
              </p>
              {item.summary && <p className="mt-1 break-words text-[13px] text-text-secondary">{item.summary}</p>}
            </div>
            <span className={`shrink-0 text-[12px] font-medium ${statusTone(item.status)}`}>{statusText(item.status)}</span>
          </div>
          <p className="mt-1 text-[12px] tabular-nums text-text-secondary">
            {Number.isFinite(start) ? new Date(start).toLocaleString() : item.startedAt}
            {Number.isFinite(start) && Number.isFinite(end) ? ` · ${formatDuration(end - start)}` : ""}
            {typeof item.bytes === "number" && item.bytes > 0 ? ` · ${formatTransferBytes(item.bytes)}` : ""}
          </p>
          {item.error && <p className="mt-1 break-words text-[12px] text-status-error">{item.error}</p>}
        </li>;
      })}
    </ul>
  </section>;
  if (!(disclosure && fixedSiteId)) return list;
  const hint = historySummaryHint({ loading, count: items.length });
  return <details data-zoer-disclosure className="min-w-0">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">History{hint && <span className="text-xs font-normal text-text-secondary">{hint}</span>}</summary>
    <div className="mt-2">{list}</div>
  </details>;
}
