import type { WordPressManagedSite } from "../../lib/api";
import { consolidateWordPressSites } from "./wordpressSiteIdentity";
import type { SiteDeployLink } from "./siteStack";

export type WordPressSiteGroup =
  | { kind: "site"; site: WordPressManagedSite }
  /** A live site shown together with the local copies made from it, and the other live sites those were deployed to. */
  | { kind: "pair"; id: string; source: WordPressManagedSite; lives: WordPressManagedSite[]; copies: WordPressManagedSite[] };

const SEPARATED_KEY = "zoer.wordpress.separated-site-pairs";

/** IDs of live sites whose local copies the user chose to show as separate cards. */
export function readSeparatedSitePairs(): Set<string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SEPARATED_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeSeparatedSitePairs(ids: ReadonlySet<string>) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SEPARATED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage is a convenience; the toggle still works for this page load.
  }
}

/** The live site a local copy was made from, when it is still listed. */
export function wordPressSiteSource(sites: WordPressManagedSite[], site: WordPressManagedSite, connectionsSeparated: ReadonlySet<string> = new Set()): WordPressManagedSite | null {
  if (!site.sourceSiteId || site.sourceSiteId === site.id) return null;
  const identity = consolidateWordPressSites(sites, connectionsSeparated);
  return identity.sites.find((item) => item.id === identity.canonicalId(site.sourceSiteId!)) ?? null;
}

/** Local copies made from this site. */
export function wordPressSiteCopies(sites: WordPressManagedSite[], site: WordPressManagedSite, connectionsSeparated: ReadonlySet<string> = new Set()): WordPressManagedSite[] {
  const identity = consolidateWordPressSites(sites, connectionsSeparated);
  return sites.filter((item) => item.id !== site.id && item.sourceSiteId && identity.canonicalId(item.sourceSiteId) === identity.canonicalId(site.id));
}

/**
 * Other live sites of a pair's local copies (`site-deploy:` records), by pair: a live site joins
 * the card of the pair its local site is in, unless it is that pair's main site, a copy, or the
 * main site of a card of its own.
 */
function stackLives(sites: WordPressManagedSite[], pairOf: ReadonlyMap<string, string>, deploys: readonly SiteDeployLink[], canonicalId: (id: string) => string) {
  const sources = new Set(pairOf.values());
  const lives = new Map<string, string>();
  for (const deploy of deploys) {
    const live = canonicalId(deploy.liveSiteId), pair = pairOf.get(canonicalId(deploy.localSiteId));
    if (!pair || live === pair || pairOf.has(live) || sources.has(live) || lives.has(live) || !sites.some(site => site.id === live)) continue;
    lives.set(live, pair);
  }
  return lives;
}

/**
 * Groups local copies under the site they were copied from, unless that pair was separated, with
 * the other live sites they were deployed to. A pair takes the position of its earliest member so
 * the list order stays familiar.
 */
export function groupWordPressSites(sites: WordPressManagedSite[], separated: ReadonlySet<string>, connectionsSeparated: ReadonlySet<string> = new Set(), deploys: readonly SiteDeployLink[] = []): WordPressSiteGroup[] {
  const identity = consolidateWordPressSites(sites, connectionsSeparated);
  const inventory = sites;
  sites = identity.sites;
  const pairOf = new Map<string, string>();
  for (const site of sites) {
    const source = wordPressSiteSource(inventory, site, connectionsSeparated);
    if (source && !identity.aliases(source.id).some(alias => separated.has(alias.id))) pairOf.set(site.id, source.id);
  }
  const sourcesWithCopies = new Set(pairOf.values());
  const livesOf = stackLives(sites, pairOf, deploys, identity.canonicalId);
  const emitted = new Set<string>();
  const groups: WordPressSiteGroup[] = [];
  for (const site of sites) {
    const pairId = pairOf.get(site.id) ?? livesOf.get(site.id) ?? (sourcesWithCopies.has(site.id) ? site.id : null);
    if (!pairId) { groups.push({ kind: "site", site }); continue; }
    if (emitted.has(pairId)) continue;
    emitted.add(pairId);
    const source = sites.find((item) => item.id === pairId)!;
    groups.push({ kind: "pair", id: pairId, source, lives: sites.filter((item) => livesOf.get(item.id) === pairId), copies: sites.filter((item) => pairOf.get(item.id) === pairId) });
  }
  return groups;
}

export function wordPressSiteMatches(site: WordPressManagedSite, query: string): boolean {
  return `${site.name} ${site.domain || ""} ${site.managedUrl || ""} ${site.provider}`.toLowerCase().includes(query);
}

/** A pair stays together when any of its sites matches the search. */
export function filterWordPressSiteGroups(groups: WordPressSiteGroup[], query: string, aliases: (id: string) => WordPressManagedSite[] = () => []): WordPressSiteGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter((group) => group.kind === "site"
    ? [group.site, ...aliases(group.site.id)].some(site => wordPressSiteMatches(site, needle))
    : [group.source, ...aliases(group.source.id), ...group.lives, ...group.copies].some((site) => wordPressSiteMatches(site, needle)));
}
