import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import { resourceQueries } from "./resources";
import { getApiBase, json } from "../api/_http";
import type { WordPressManagedSite } from "../api";
export const wordpressKeys = { all: () => ["wordpress", getApiBase()] as const };
export const wordpressQueries = {
  sites: (fresh = false) => queryOptions({ queryKey: [...wordpressKeys.all(), "sites"], queryFn: async () => (await api.listWordPressManagedSites(fresh)).sites, staleTime: 30_000 }),
  securitySites: () => queryOptions({ queryKey: [...wordpressKeys.all(), "security-sites"], queryFn: async () => (await json<{ sites: WordPressManagedSite[] }>("/wordpress-manager/security-sites")).sites, staleTime: 30_000 }),
  site: (id: string, tab: string) => queryOptions({ queryKey: [...wordpressKeys.all(), "site", id, tab], queryFn: () => api.getWordPressManagedSite(id, tab), staleTime: 30_000 }),
  connections: () => queryOptions({ queryKey: [...wordpressKeys.all(), "connections"], queryFn: async () => (await api.listWordPressManagerConnections()).connections, staleTime: 60_000 }),
  deployments: () => queryOptions({ queryKey: [...wordpressKeys.all(), "deployments"], queryFn: async () => (await api.listWordPressDeployments()).deployments }),
  connectors: resourceQueries.connectors,
};
export function activeWordPressDeployment(status: string) { return ["queued", "preparing", "uploading", "importing", "verifying"].includes(status); }
