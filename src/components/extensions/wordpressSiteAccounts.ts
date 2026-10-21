import type { WordPressManagedSite } from "../../lib/api";
import type { HostingerTestSite } from "./hostingerTestSites";
import { isLocalWordPress } from "./wordpressLifecycle";

/** The site list filter: every site, local sites, or the sites of one provider account (`account:<connection ID>`). */
export type SiteScope = "all" | "local" | `account:${string}`;

const hostOf = (value: string | null | undefined) => {
  if (!value) return null;
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase(); } catch { return null; }
};

/**
 * The Hostinger account (connection ID) a live site is on: its Hostinger record's, or, for a Zoer
 * Connect site without one, the account Zoer created the website on. Local sites have none.
 */
/**
 * The website WordPress Manager created for a live site (its "WordPress with Zoer Connect" receipt,
 * matched by address and, when the site has a Hostinger record, by account), which it may delete.
 * Websites it did not create, and receipts already deleted or still being set up, give null.
 */
export function createdWebsiteOf(site: WordPressManagedSite, aliases: readonly WordPressManagedSite[], created: readonly HostingerTestSite[]): HostingerTestSite | null {
  if (isLocalWordPress(site)) return null;
  const members = [site, ...aliases];
  const account = members.find(member => member.provider === "hostinger" && member.connectionId)?.connectionId ?? null;
  const hosts = new Set(members.flatMap(member => [hostOf(member.url), hostOf(member.domain), hostOf(member.managedUrl)]).filter((host): host is string => !!host));
  return created.find(item => !item.deleted && !item.running && hosts.has(item.domain.toLowerCase()) && (!account || item.connectionId === account)) ?? null;
}

export function siteAccountId(site: WordPressManagedSite, aliases: readonly WordPressManagedSite[], created: readonly HostingerTestSite[]): string | null {
  if (isLocalWordPress(site)) return null;
  const members = [site, ...aliases];
  const hosted = members.find(member => member.provider === "hostinger" && member.connectionId);
  if (hosted) return hosted.connectionId;
  const hosts = new Set(members.flatMap(member => [hostOf(member.url), hostOf(member.domain), hostOf(member.managedUrl)]).filter((host): host is string => !!host));
  return created.find(item => !item.deleted && hosts.has(item.domain.toLowerCase()))?.connectionId ?? null;
}

/**
 * Whether a site is shown under a scope. An account keeps its live sites together with their local
 * copies, so a live site's card stays whole.
 */
export function siteInScope(site: WordPressManagedSite, scope: SiteScope, accountOf: (site: WordPressManagedSite) => string | null, sourceOf: (site: WordPressManagedSite) => WordPressManagedSite | null): boolean {
  if (scope === "all") return true;
  if (scope === "local") return isLocalWordPress(site);
  const account = scope.slice("account:".length);
  if (!isLocalWordPress(site)) return accountOf(site) === account;
  const source = sourceOf(site);
  return !!source && !isLocalWordPress(source) && accountOf(source) === account;
}
