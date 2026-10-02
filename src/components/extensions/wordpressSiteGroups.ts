import type { WordPressManagedSite } from "../../lib/api";

export type WordPressSiteGroup =
  | { kind: "site"; site: WordPressManagedSite }
  /** A live site shown together with the local copies made from it. */
  | { kind: "pair"; id: string; source: WordPressManagedSite; copies: WordPressManagedSite[] };

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
export function wordPressSiteSource(sites: WordPressManagedSite[], site: WordPressManagedSite): WordPressManagedSite | null {
  if (!site.sourceSiteId || site.sourceSiteId === site.id) return null;
  return sites.find((item) => item.id === site.sourceSiteId) ?? null;
}

/** Local copies made from this site. */
export function wordPressSiteCopies(sites: WordPressManagedSite[], site: WordPressManagedSite): WordPressManagedSite[] {
  return sites.filter((item) => item.id !== site.id && item.sourceSiteId === site.id);
}

/**
 * Groups local copies under the site they were copied from, unless that pair was separated.
 * A pair takes the position of its earliest member so the list order stays familiar.
 */
export function groupWordPressSites(sites: WordPressManagedSite[], separated: ReadonlySet<string>): WordPressSiteGroup[] {
  const pairOf = new Map<string, string>();
  for (const site of sites) {
    const source = wordPressSiteSource(sites, site);
    if (source && !separated.has(source.id)) pairOf.set(site.id, source.id);
  }
  const sourcesWithCopies = new Set(pairOf.values());
  const emitted = new Set<string>();
  const groups: WordPressSiteGroup[] = [];
  for (const site of sites) {
    const pairId = pairOf.get(site.id) ?? (sourcesWithCopies.has(site.id) ? site.id : null);
    if (!pairId) { groups.push({ kind: "site", site }); continue; }
    if (emitted.has(pairId)) continue;
    emitted.add(pairId);
    const source = sites.find((item) => item.id === pairId)!;
    groups.push({ kind: "pair", id: pairId, source, copies: sites.filter((item) => pairOf.get(item.id) === pairId) });
  }
  return groups;
}

export function wordPressSiteMatches(site: WordPressManagedSite, query: string): boolean {
  return `${site.name} ${site.domain || ""} ${site.managedUrl || ""} ${site.provider}`.toLowerCase().includes(query);
}

/** A pair stays together when any of its sites matches the search. */
export function filterWordPressSiteGroups(groups: WordPressSiteGroup[], query: string): WordPressSiteGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter((group) => group.kind === "site"
    ? wordPressSiteMatches(group.site, needle)
    : [group.source, ...group.copies].some((site) => wordPressSiteMatches(site, needle)));
}
