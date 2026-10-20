import type { QueryClient } from "@tanstack/react-query";
import type { HostEndpoint } from "../../host/actions";
import type { WordPressManagedSite } from "../api";
import { wordpressQueries } from "./wordpress";

/** Reflect the host's saved endpoint immediately, before slow provider discovery finishes. */
export async function rememberConnectedWordPressSite(client: QueryClient, endpoint: HostEndpoint): Promise<void> {
  const sitesKey = wordpressQueries.sites().queryKey;
  const endpointsKey = wordpressQueries.endpoints().queryKey;
  // Reads already in flight may predate the add. They must not hide the saved connection.
  await Promise.all([sitesKey, endpointsKey].map(queryKey => client.cancelQueries({ queryKey })));
  const site: WordPressManagedSite = {
    id: endpoint.id, provider: "zoer-connect", environment: "production", name: endpoint.label,
    sourceSiteId: null, domain: new URL(endpoint.origin).hostname, url: endpoint.origin,
    subdomain: null, managedUrl: null, status: "connected",
    wordpressVersion: null, phpVersion: null, updates: null, vulnerabilities: null,
    connectionId: null, username: null, softwareId: null,
    capabilities: { preview: true, admin: false, extensions: false, backups: false, deploySource: false, deployTarget: false, siteHealth: false, rollback: false },
    limitation: "Use Connect Zoer for permission-based Pull, Push and migration recovery. Manage plugins and hosting in WordPress.",
  };
  client.setQueryData<WordPressManagedSite[]>(sitesKey, current => [...(current ?? []).filter(item => item.id !== site.id), site]);
  client.setQueryData<{ endpoints: HostEndpoint[] }>(endpointsKey, current => ({ endpoints: [...(current?.endpoints ?? []).filter(item => item.id !== endpoint.id), endpoint] }));
}
