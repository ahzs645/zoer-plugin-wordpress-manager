import type { WordPressManagedSite } from "../../lib/api";
import type { HostEndpoint } from "../../host/actions";
import type { PullRecord } from "./pluginEngine/records";
import { consolidateWordPressSites } from "./wordpressSiteIdentity";

/** Only HTTPS installation links without credentials or query data may be shown. */
export function publishedWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

export interface PublishDestination { id: string; name: string; url: string }
export function localPublishDestinations(endpoints: HostEndpoint[], sites: WordPressManagedSite[], source: WordPressManagedSite) {
  const identity = consolidateWordPressSites(sites);
  const localSites = sites.filter(site => site.provider === "ddev" || site.provider === "playground" || site.environment === "local");
  const localAddresses = new Set(localSites.flatMap(site => [site.url, site.managedUrl].flatMap(value => { const url = publishedWebsiteUrl(value); return url ? [url.replace(/\/+$/, "")] : []; })));
  const destinations: PublishDestination[] = endpoints.flatMap(endpoint => {
    const url = publishedWebsiteUrl(endpoint.origin);
    if (endpoint.alias !== "site" || endpoint.id === source.id || !url || localSites.some(site => site.id === endpoint.id) || localAddresses.has(url.replace(/\/+$/, ""))) return [];
    return [{ id: endpoint.id, name: endpoint.label || sites.find(site => site.id === endpoint.id)?.name || url, url }];
  });
  const original = sites.find(site => site.id === source.sourceSiteId);
  const originalUrl = publishedWebsiteUrl(original?.url)?.replace(/\/+$/, "");
  const linked = source.sourceSiteId ? destinations.find(site => site.id === source.sourceSiteId || (identity.canonicalId(site.id) === identity.canonicalId(source.sourceSiteId!) && originalUrl && originalUrl === site.url.replace(/\/+$/, ""))) : undefined;
  return { destinations, preferredId: linked?.id ?? "" };
}

export function guidedPushSources(pulls: PullRecord[], sourceId?: string) {
  return sourceId ? pulls.filter(pull => pull.kind === "local-export" && pull.siteId === sourceId) : pulls;
}

export function pushReviewMessage(review: boolean, fence: "early" | "activation") {
  return review
    ? "Review is enabled: the site stays online while staging, then waits for your approval before activation."
    : fence === "early"
      ? "Review is off. The destination pauses when the import starts and stays paused until Finish or Roll back."
      : "Review is off. The site stays online while staging, then pauses during activation until Finish or Roll back.";
}

export function completedPushUrl({ kind, status, dryRun, rolledBack, url }: { kind: string; status: unknown; dryRun: unknown; rolledBack: boolean; url: unknown }) {
  return kind === "push" && status === "complete" && dryRun !== true && !rolledBack ? publishedWebsiteUrl(url) : null;
}
