import { useEffect, useState } from "react";
import { Btn, Modal, Select, fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import { useQuery } from "@tanstack/react-query";
import { hostEndpoints } from "../../host/actions";
import type { WordPressManagedSite } from "../../lib/api";
import { localPublishDestinations, type PublishDestination } from "./publishGuidance";

export default function LocalPublishChoice({ source, sites, onClose, onContinue, onHosting }: {
  source: WordPressManagedSite; sites: WordPressManagedSite[]; onClose: () => void;
  onContinue: (destination: PublishDestination) => void; onHosting: () => void;
}) {
  const endpoints = useQuery({ queryKey: ["wordpress-manager", "publish-destinations"], queryFn: () => hostEndpoints.list("site"), staleTime: 30_000 });
  const { destinations, preferredId } = localPublishDestinations(endpoints.data?.endpoints ?? [], sites, source);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  useEffect(() => { if (endpoints.isSuccess && destinationId === null) setDestinationId(preferredId); }, [endpoints.isSuccess, destinationId, preferredId]);
  const destination = destinations.find(site => site.id === destinationId);
  return <Modal mobileSheet title={`Publish local changes · ${source.name}`} onClose={onClose}>
    <div className="min-w-0 space-y-4 text-sm">
      <p>Choose the live destination for <strong>{source.name}</strong>. Continue opens Push with this local source selected; it does not export or publish anything.</p>
      <label className="block min-w-0"><span className={fieldLabelClass}>Connected destination</span><Select searchable aria-label="Publish destination" className={selectClass("default", "mt-2 w-full")} value={destinationId ?? ""} onChange={event => setDestinationId(event.target.value)}><option value="">Choose destination</option>{destinations.map(site => <option key={site.id} value={site.id}>{site.name} · {site.url}</option>)}</Select></label>
      {endpoints.isSuccess && !destinations.length && <p role="status" className="text-text-secondary">No live Zoer Connect destination is saved. Add the live website in WordPress Manager and save its connection info first. Hosting access alone does not enable Connect publishing.</p>}
      {endpoints.isLoading && <p role="status" className="text-text-secondary">Loading saved Connect destinations…</p>}
      {endpoints.error && <p role="alert" className="text-status-error">Could not load saved destinations. <Btn size="sm" onClick={() => void endpoints.refetch()}>Retry</Btn></p>}
      {destination && <p className="break-all text-text-secondary">Destination: <strong>{destination.url}</strong>. Enable Push and private storage in WordPress → Tools → Zoer Connect on that site.</p>}
      <ol className="list-decimal space-y-1 pl-5 text-text-secondary"><li>Prepare a verified local export.</li><li>Choose that export, compare files and review database options.</li><li>Request a dry run or a push, confirm the destination, then follow the transfer to Finish.</li></ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Btn variant="primary" disabled={!destination || source.status !== "running"} onClick={() => destination && onContinue(destination)}>Continue to Push</Btn><Btn onClick={onHosting}>Publish through hosting account</Btn></div>
      {source.status !== "running" && <p role="status" className="text-status-warning">Start the local site before preparing an export.</p>}
    </div>
  </Modal>;
}
