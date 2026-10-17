import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Globe2, Server, X } from "lucide-react";
import { Btn, Modal, Select, selectClass } from "@zoer/plugin-ui/controls";
import { hostEndpoints } from "../../host/actions";
import type { WordPressManagedSite } from "../../lib/api";
import { useWordPressDiagnostics, useZoerConnection } from "../../lib/queries/wordpress-transfer";
import GuidedPush from "./pluginEngine/GuidedPush";
import PluginSiteRuns from "./pluginEngine/PluginSiteRuns";
import { isTerminalStatus, isTransferFence, runsOfSite, SITE_RUN_ACTIONS, TRANSFER_FENCE_NOTICE } from "./pluginEngine/runState";
import { useRecentRuns } from "../../lib/queries/plugin-engine";
import { pushReadiness, zoerConnectSettingsUrl } from "./wordpressTransfer/availability";
import { localPublishDestinations } from "./publishGuidance";

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/**
 * Local → live in one dialog: the destination (preselected for a local copy of a connected
 * site), its readiness, then the guided push (export → compare → push) and the push's run cards
 * for review, Finish or Roll back. Replaces "Publish local changes → Continue to Push → the
 * destination's full Transfers dialog".
 */
export default function PushToLiveDialog({ source, sites, onClose, onHosting, onStartSource }: {
  source: WordPressManagedSite; sites: WordPressManagedSite[]; onClose: () => void; /** Starts the local site (its inventory and export need it running). */ onStartSource?: () => void;
  /** Hostinger account publication, for local sites that have it. */ onHosting?: () => void;
}) {
  const endpoints = useQuery({ queryKey: ["wordpress-manager", "publish-destinations"], queryFn: () => hostEndpoints.list("site"), staleTime: 30_000 });
  const { destinations, preferredId } = localPublishDestinations(endpoints.data?.endpoints ?? [], sites, source);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  useEffect(() => { if (endpoints.isSuccess && destinationId === null) setDestinationId(preferredId || (destinations.length === 1 ? destinations[0].id : "")); }, [endpoints.isSuccess, destinationId, preferredId, destinations]);
  const destination = destinations.find(site => site.id === destinationId) ?? null;
  const conn = useZoerConnection(destination?.id ?? "", !!destination);
  const connection = conn.connection;
  const diagnostics = useWordPressDiagnostics(destination?.id, { enabled: !!connection });
  const runs = useRecentRuns(SITE_RUN_ACTIONS);
  const busy = !!destination && runsOfSite(runs.data ?? [], destination.id).some(run => !isTerminalStatus(run.status));
  const readiness = connection ? pushReadiness(connection) : [];
  const ready = !!connection && connection.status.push && connection.status.publish;
  const loadError = conn.error instanceof Error ? conn.error.message : "";
  const linked = !!preferredId && destination?.id === preferredId;

  return <Modal mobileSheet size="wide" title="Push to live" onClose={onClose}>
    <div className="min-w-0 space-y-4 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" aria-label="Push direction">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium"><Server className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" /><span className="truncate">{source.name}</span></span>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" /><span className="sr-only">to</span>
        {destination && (linked || destinations.length === 1)
          ? <span className="inline-flex min-w-0 items-center gap-1.5 font-medium"><Globe2 className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" /><span className="truncate">{host(destination.url)}</span>{destinations.length > 1 && <button type="button" className="text-xs font-normal text-text-secondary underline" onClick={() => setDestinationId("")}>Change</button>}</span>
          : <Select searchable aria-label="Live site" className={selectClass("compact", "min-w-48 flex-1")} value={destinationId ?? ""} onChange={event => setDestinationId(event.target.value)}>
            <option value="">Choose live site</option>
            {destinations.map(site => <option key={site.id} value={site.id}>{site.name} · {host(site.url)}</option>)}
          </Select>}
      </div>

      {endpoints.isLoading && <p role="status" className="text-text-secondary">Loading live sites…</p>}
      {endpoints.error && <p role="alert" className="text-status-error">Could not load live sites. <Btn size="sm" onClick={() => void endpoints.refetch()}>Retry</Btn></p>}
      {endpoints.isSuccess && !destinations.length && <div className="space-y-2 rounded-lg border border-border-default p-3">
        <p className="font-medium">No live site connected yet</p>
        <p className="text-text-secondary">Install Zoer Connect on the live WordPress site, then use <strong>Connect existing site</strong> on the WordPress page.</p>
      </div>}

      {destination && conn.isLoading && <p role="status" className="text-text-secondary">Checking {host(destination.url)}…</p>}
      {destination && loadError && <div className="space-y-2"><p>{isTransferFence(loadError) ? TRANSFER_FENCE_NOTICE : "Could not reach the live site's connection."}</p><Btn size="sm" onClick={() => void conn.refetch()}>Retry</Btn></div>}
      {destination && !conn.isLoading && !loadError && !connection && <p role="status" className="text-status-warning">This live site's connection key is missing. Open it on the WordPress page and paste its Zoer Connect info again.</p>}

      {connection && !ready && <section aria-label="Live site setup" className="space-y-2 rounded-lg border border-status-warning/40 p-3">
        <p className="font-medium">Finish setup on the live site</p>
        <ul className="space-y-1">{readiness.map(item => <li key={item.key} className="flex items-start gap-1.5">{item.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />}<span>{item.ok ? item.label : item.fix}</span></li>)}</ul>
        <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-9 items-center rounded-md border border-border-default px-3 text-[13px] hover:bg-surface-hover" href={zoerConnectSettingsUrl(connection.url)} target="_blank" rel="noreferrer">Open Zoer Connect settings</a><Btn size="sm" loading={conn.commandPending} onClick={() => void conn.command({ action: "test" }).catch(() => undefined)}>Check again</Btn></div>
      </section>}

      {connection && ready && busy && <p role="status" className="text-status-warning">Another transfer to {host(connection.url)} is still running. Finish, roll back or cancel it under Recent transfers first.</p>}
      {connection && ready && <GuidedPush key={destination!.id} source={source} onStartSource={onStartSource} destinationId={destination!.id} connection={connection} destination={diagnostics.data} />}
      {destination && <details data-zoer-disclosure open={busy || undefined} className="min-w-0"><summary className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Recent transfers to {host(destination.url)}</summary><div className="mt-2"><PluginSiteRuns siteId={destination.id} /></div></details>}
      {onHosting && <p className="border-t border-border-muted pt-3 text-xs text-text-secondary">Publishing to a Hostinger site without Zoer Connect? <button type="button" className="underline" onClick={onHosting}>Use your Hostinger account instead</button>.</p>}
    </div>
  </Modal>;
}
