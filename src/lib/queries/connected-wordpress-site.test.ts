import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { HostEndpoint } from "../../host/actions";
import type { WordPressManagedSite } from "../api";
import { rememberConnectedWordPressSite } from "./connected-wordpress-site";
import { wordpressQueries } from "./wordpress";

const endpoint: HostEndpoint = { id: "ep_new", alias: "site", origin: "https://new.example.org/blog", label: "New site", generation: "generation-1", testedAt: "2026-10-19T12:00:00Z", createdAt: "2026-10-19T12:00:00Z" };
const oldEndpoint: HostEndpoint = { ...endpoint, id: "ep_old", origin: "https://old.example.org", label: "Old site" };

test("a confirmed site is visible and usable as a transfer endpoint before provider discovery returns", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await rememberConnectedWordPressSite(client, oldEndpoint);
  const sitesKey = wordpressQueries.sites().queryKey;
  const endpointsKey = wordpressQueries.endpoints().queryKey;
  const securityKey = wordpressQueries.securitySites().queryKey;
  client.setQueryData(securityKey, []);
  const staleSites = client.getQueryData<WordPressManagedSite[]>(sitesKey)!;
  const staleEndpoints = client.getQueryData<{ endpoints: HostEndpoint[] }>(endpointsKey)!;
  // Both requests began before the add. Even a transport that cannot abort must not restore them.
  let finishSites!: (sites: WordPressManagedSite[]) => void;
  let finishEndpoints!: (endpoints: { endpoints: HostEndpoint[] }) => void;
  const sitesObserver = new QueryObserver(client, { queryKey: sitesKey, queryFn: () => new Promise<WordPressManagedSite[]>(resolve => { finishSites = resolve; }) });
  const endpointObserver = new QueryObserver(client, { queryKey: endpointsKey, queryFn: () => new Promise<{ endpoints: HostEndpoint[] }>(resolve => { finishEndpoints = resolve; }) });
  const unsubscribe = sitesObserver.subscribe(() => {});
  const unsubscribeEndpoints = endpointObserver.subscribe(() => {});
  await rememberConnectedWordPressSite(client, endpoint);
  expect(sitesObserver.getCurrentResult().data?.map(site => site.id)).toEqual(["ep_old", "ep_new"]);
  expect(endpointObserver.getCurrentResult().data?.endpoints).toEqual([oldEndpoint, endpoint]);
  finishSites(staleSites); finishEndpoints(staleEndpoints);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(client.getQueryData<WordPressManagedSite[]>(sitesKey)?.map(site => site.id)).toEqual(["ep_old", "ep_new"]);
  expect(client.getQueryData<{ endpoints: HostEndpoint[] }>(endpointsKey)?.endpoints).toEqual([oldEndpoint, endpoint]);
  // External sites never enter the metadata-only local scanner inventory.
  expect(client.getQueryData<WordPressManagedSite[]>(securityKey)).toEqual([]);
  unsubscribe(); unsubscribeEndpoints(); client.clear();
});

test("a background inventory error retains the saved site and an updated connection is not duplicated", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await rememberConnectedWordPressSite(client, endpoint);
  const updated = { ...endpoint, label: "Renamed site", generation: "generation-2" };
  await rememberConnectedWordPressSite(client, updated);
  const sitesKey = wordpressQueries.sites().queryKey;
  await expect(client.fetchQuery({ queryKey: sitesKey, queryFn: async () => { throw new Error("Hostinger discovery unavailable"); } })).rejects.toThrow("Hostinger discovery unavailable");
  const sites = client.getQueryData<WordPressManagedSite[]>(sitesKey)!;
  expect(sites).toHaveLength(1);
  expect(sites[0]).toMatchObject({ id: endpoint.id, name: "Renamed site", domain: "new.example.org", url: endpoint.origin, provider: "zoer-connect", status: "connected", environment: "production", wordpressVersion: null, updates: null, vulnerabilities: null });
  // The host only confirmed an endpoint; this does not invent site health, admin or publishing powers.
  expect(sites[0]!.capabilities).toEqual({ preview: true, admin: false, extensions: false, backups: false, deploySource: false, deployTarget: false, siteHealth: false, rollback: false });
  expect(client.getQueryData<{ endpoints: HostEndpoint[] }>(wordpressQueries.endpoints().queryKey)?.endpoints).toEqual([updated]);
  client.clear();
});
