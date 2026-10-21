import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Globe2, Server, X } from "lucide-react";
import { Btn, Modal, Select, selectClass } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";
import { wordpressQueries } from "../../lib/queries/wordpress";
import { useWordPressDiagnostics, useZoerConnection } from "../../lib/queries/wordpress-transfer";
import { OneClickPushPanel } from "./pluginEngine/OneClickPush";
import { isTransferFence, TRANSFER_FENCE_NOTICE } from "./pluginEngine/runState";
import { pushReadiness, zoerConnectSettingsUrl } from "./wordpressTransfer/availability";
import { localPublishDestinations } from "./publishGuidance";

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const SIDE_TAG = "shrink-0 rounded border border-border-muted px-1.5 py-px text-[11px] font-normal text-text-secondary";

/**
 * Local → live in one dialog: the destination (preselected for a local copy of a connected
 * site), its readiness, then one form. Pressing Push starts the export, the comparison and the
 * push together; the dialog then follows them (also after it is closed and opened again).
 */
export default function PushToLiveDialog({ source, sites, onClose, onHosting, onStartSource, destinationId: chosenId = null, stack = [], accountOf = () => null }: {
  source: WordPressManagedSite; sites: WordPressManagedSite[]; onClose: () => void; /** Opens on this live site (another live site of the local site's card) instead of its main one. */ destinationId?: string | null; /** Starts the local site (its inventory and export need it running). */ onStartSource?: () => void;
  /** Hostinger account publication, for local sites that have it. */ onHosting?: () => void;
  /** The live sites on the local site's card, main first; offered before every other live site. */ stack?: readonly string[];
  /** The Hostinger account name a live site is on. */ accountOf?: (siteId: string) => string | null;
}) {
  const endpoints = useQuery(wordpressQueries.endpoints());
  const { destinations, preferredId } = localPublishDestinations(endpoints.data?.endpoints ?? [], sites, source);
  const onCard = stack.flatMap(id => destinations.filter(site => site.id === id));
  const others = destinations.filter(site => !onCard.includes(site));
  const [destinationId, setDestinationId] = useState<string | null>(null);
  useEffect(() => { if (endpoints.isSuccess && destinationId === null) setDestinationId((chosenId && destinations.some(site => site.id === chosenId) ? chosenId : null) ?? onCard[0]?.id ?? (preferredId || (destinations.length === 1 ? destinations[0].id : ""))); }, [endpoints.isSuccess, destinationId, preferredId, destinations, chosenId, onCard]);
  const destination = destinations.find(site => site.id === destinationId) ?? null;
  const conn = useZoerConnection(destination?.id ?? "", !!destination);
  const connection = conn.connection;
  const diagnostics = useWordPressDiagnostics(destination?.id, { enabled: !!connection });
  const readiness = connection ? pushReadiness(connection) : [];
  const ready = !!connection && connection.status.push && connection.status.publish;
  const loadError = conn.error instanceof Error ? conn.error.message : "";
  const label = (site: { name: string; url: string }) => site.name && site.name !== host(site.url) ? site.name : host(site.url);

  return <Modal mobileSheet size="wide" title="Push to live" onClose={onClose}>
    <div className="min-w-0 space-y-4 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-secondary px-3 py-2" aria-label="Push direction">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium"><Server className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" /><span className="truncate">{source.name}</span><span className={SIDE_TAG}>Local</span></span>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" /><span className="sr-only">to</span>
        {destination
          ? <span className="inline-flex min-w-0 items-center gap-1.5 font-medium"><Globe2 className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" /><span className="truncate">{host(destination.url)}</span>{accountOf(destination.id) && <span className={SIDE_TAG}>{accountOf(destination.id)}</span>}<span className={SIDE_TAG}>Live</span></span>
          : <span className="text-text-secondary">Choose a live site</span>}
      </div>

      {destinations.length > 1 && <div className="min-w-0 space-y-2">
        {onCard.length > 0 && <div role="radiogroup" aria-label={`Live sites of ${source.name}`} className="divide-y divide-border-muted overflow-hidden rounded-md border border-border-muted">
          {onCard.map(site => <button key={site.id} type="button" role="radio" aria-checked={site.id === destinationId} onClick={() => setDestinationId(site.id)}
            className={`flex w-full min-w-0 items-center gap-2 p-2 text-left transition ${site.id === destinationId ? "bg-accent-subtle shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-hover"}`}>
            <Globe2 className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{host(site.url)}{stack[0] === site.id && <span className="font-normal text-text-secondary"> · main</span>}</span>
              {label(site) !== host(site.url) && <span className="block truncate text-[12px] text-text-secondary">{label(site)}</span>}</span>
            {accountOf(site.id) && <span title={`Hostinger account ${accountOf(site.id)}`} className="max-w-[40%] shrink-0 truncate rounded border border-border-default bg-surface-secondary px-1.5 text-[11px] leading-4 text-text-secondary">{accountOf(site.id)}</span>}
            {site.id === destinationId && <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
          </button>)}
        </div>}
        {others.length > 0 && <Select searchable aria-label={onCard.length ? "Another live site" : "Live site"} className={selectClass("compact", "w-full")} value={others.some(site => site.id === destinationId) ? destinationId ?? "" : ""} onChange={event => setDestinationId(event.target.value)}
          optionDetails={Object.fromEntries(others.map(site => { const account = accountOf(site.id); return [site.id, { description: `${account ? `${account} · ` : ""}${host(site.url)}`, keywords: `${account ?? ""} ${host(site.url)}` }]; }))}>
          <option value="">{onCard.length ? "Another live site…" : "Choose live site"}</option>
          {others.map(site => { const account = accountOf(site.id); return <option key={site.id} value={site.id}>{label(site)}{account ? ` · ${account}` : ""}</option>; })}
        </Select>}
      </div>}

      {endpoints.isLoading && <p role="status" className="text-text-secondary">Loading live sites…</p>}
      {endpoints.error && <p role="alert" className="text-status-error">Could not load live sites. <Btn size="sm" onClick={() => void endpoints.refetch()}>Retry</Btn></p>}
      {endpoints.isSuccess && !destinations.length && <div className="space-y-2 rounded-lg border border-border-default p-3">
        <p className="font-medium">No live site connected yet</p>
        <p className="text-text-secondary">Install Zoer Connect on the live site and use <strong>Connect existing site</strong>, or create a Hostinger website with <strong>WordPress with Zoer Connect</strong>.</p>
      </div>}

      {destination && <OneClickPushPanel key={destination.id} source={source} destinationId={destination.id} destinationHost={host(destination.url)} connection={connection && ready ? connection : null} destination={diagnostics.data} onStartSource={onStartSource}
        fallback={<>
          {conn.isLoading && <p role="status" className="text-text-secondary">Checking {host(destination.url)}…</p>}
          {loadError && <div className="space-y-2"><p>{isTransferFence(loadError) ? TRANSFER_FENCE_NOTICE : "Could not reach the live site's connection."}</p><Btn size="sm" onClick={() => void conn.refetch()}>Retry</Btn></div>}
          {!conn.isLoading && !loadError && !connection && <p role="status" className="text-status-warning">This live site's connection key is missing. Open it on the WordPress page and paste its Zoer Connect info again.</p>}
          {connection && !ready && <section aria-label="Live site setup" className="space-y-2 rounded-lg border border-status-warning/40 p-3">
            <p className="font-medium">Finish setup on the live site</p>
            <ul className="space-y-1">{readiness.map(item => <li key={item.key} className="flex items-start gap-1.5">{item.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />}<span>{item.ok ? item.label : item.fix}</span></li>)}</ul>
            <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-9 items-center rounded-md border border-border-default px-3 text-[13px] hover:bg-surface-hover" href={zoerConnectSettingsUrl(connection.url)} target="_blank" rel="noreferrer">Open Zoer Connect settings</a><Btn size="sm" loading={conn.commandPending} onClick={() => void conn.command({ action: "test" }).catch(() => undefined)}>Check again</Btn></div>
          </section>}
        </>} />}

      <p className="border-t border-border-muted pt-3 text-xs text-text-secondary">Earlier pushes and pulls are under the site's <strong>Activity</strong>.{onHosting && !(connection && ready) && <> Publishing to a Hostinger site without Zoer Connect? <button type="button" className="underline" onClick={onHosting}>Use your Hostinger account</button>.</>}</p>
    </div>
  </Modal>;
}
