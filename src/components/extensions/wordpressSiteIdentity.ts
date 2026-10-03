import type { WordPressManagedSite } from "../../lib/api";

const KEY = "zoer.wordpress.separated-site-connections";
export function readSeparatedSiteConnections(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}
export function writeSeparatedSiteConnections(ids: ReadonlySet<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch { /* Optional display preference. */ }
}

/** Match installation addresses, never titles, shared accounts, www aliases or redirects. */
export function wordPressInstallationAddress(site: WordPressManagedSite): string | null {
  if (!["hostinger", "zoer-connect"].includes(site.provider) || !site.url) return null;
  try {
    const url = new URL(site.url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

/** Presentation aliases only: credentials, grants, jobs and source IDs retain their owners. */
export function consolidateWordPressSites(sites: WordPressManagedSite[], separated: ReadonlySet<string> = new Set()) {
  const addresses = new Map<string, WordPressManagedSite[]>();
  for (const site of sites) {
    const address = wordPressInstallationAddress(site);
    if (address) addresses.set(address, [...(addresses.get(address) || []), site]);
  }
  const canonicalIds = new Map<string, string>();
  const connectors = new Map<string, WordPressManagedSite>();
  const aliases = new Map<string, WordPressManagedSite[]>();
  for (const members of addresses.values()) {
    const hosted = members.filter(site => site.provider === "hostinger");
    const external = members.filter(site => site.provider === "zoer-connect");
    // Ambiguous inventories stay separate; never choose an arbitrary connection.
    if (hosted.length !== 1 || external.length !== 1 || members.some(site => separated.has(site.id))) continue;
    const primary = hosted[0], connector = external[0];
    canonicalIds.set(connector.id, primary.id);
    connectors.set(primary.id, connector);
    aliases.set(primary.id, members);
  }
  const canonicalId = (id: string) => canonicalIds.get(id) ?? id;
  return { sites: sites.filter(site => !canonicalIds.has(site.id)), canonicalId,
    connector: (site: WordPressManagedSite) => connectors.get(canonicalId(site.id)) ?? site,
    aliases: (id: string) => aliases.get(canonicalId(id)) ?? sites.filter(site => site.id === id) };
}

/** Read-only history filtering includes both endpoints without rewriting stored jobs. */
export function wordPressTransferMatchesSite(item: { siteId: string; sourceSiteId?: string }, siteId: string, canonicalId: (id: string) => string): boolean {
  return !siteId || canonicalId(item.siteId) === canonicalId(siteId) || Boolean(item.sourceSiteId && canonicalId(item.sourceSiteId) === canonicalId(siteId));
}
