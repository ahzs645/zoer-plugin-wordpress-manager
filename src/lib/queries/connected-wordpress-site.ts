import type { QueryClient } from "@tanstack/react-query";
import type { HostEndpoint } from "../../host/actions";
import type { WordPressManagedSite } from "../api";
import { wordpressQueries } from "./wordpress";

const CONNECTED_SITE_NOTE = "Zoer Connect handles Pull, Push and migration recovery for this site. Manage its plugins and hosting in WordPress.";

/** Why a site's plugins and themes aren't managed here. A site already on Zoer Connect is not told to connect. */
export function extensionManagementNote(site: Pick<WordPressManagedSite, "provider" | "status" | "limitation">) {
  if (site.provider === "zoer-connect" && site.status === "connected") return CONNECTED_SITE_NOTE;
  return site.limitation || undefined;
}

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
    limitation: CONNECTED_SITE_NOTE,
  };
  client.setQueryData<WordPressManagedSite[]>(sitesKey, current => [...(current ?? []).filter(item => item.id !== site.id), site]);
  client.setQueryData<{ endpoints: HostEndpoint[] }>(endpointsKey, current => ({ endpoints: [...(current?.endpoints ?? []).filter(item => item.id !== endpoint.id), endpoint] }));
}
