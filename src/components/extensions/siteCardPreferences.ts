import type { WordPressManagedSite } from "../../lib/api";
import type { WordPressSiteGroup } from "./wordpressSiteGroups";

export const SITE_CARD_PREFERENCES_KEY = "zoer.wordpress.site-card-preferences.v1";
export interface SiteCardPreferences {
  order: string[];
  collapsed: string[];
  faviconSites: Record<string, string>;
}
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && !!id))] : [];

export function readSiteCardPreferences(): SiteCardPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(SITE_CARD_PREFERENCES_KEY) || "null");
    return {
      order: strings(value?.order), collapsed: strings(value?.collapsed),
      faviconSites: Object.fromEntries(Object.entries(value?.faviconSites && typeof value.faviconSites === "object" ? value.faviconSites : {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    };
  } catch { return { order: [], collapsed: [], faviconSites: {} }; }
}

export function saveSiteCardPreferences(value: SiteCardPreferences): boolean {
  try { localStorage.setItem(SITE_CARD_PREFERENCES_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

// A site's ID survives switching between a standalone card and a group led by that site.
export const siteCardId = (group: WordPressSiteGroup) => group.kind === "pair" ? group.id : group.site.id;
export const siteCardMembers = (group: WordPressSiteGroup): WordPressManagedSite[] => group.kind === "pair" ? [group.source, ...group.lives, ...group.copies] : [group.site];

export function orderedSiteCards(groups: WordPressSiteGroup[], order: readonly string[]): WordPressSiteGroup[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return groups.map((group, i) => ({ group, rank: rank.get(siteCardId(group)) ?? order.length + i }))
    .sort((a, b) => a.rank - b.rank).map(item => item.group);
}

/** Move relative to an anchor, keeping filtered and temporarily unavailable cards in the saved order. */
export function moveSiteCard(saved: readonly string[], current: readonly string[], id: string, target: string, after: boolean): string[] {
  const order = [...new Set([...saved, ...current])];
  if (id === target || !current.includes(id) || !current.includes(target)) return order;
  const rest = order.filter(item => item !== id);
  rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, id);
  return rest;
}

export function siteCardFaviconSite(group: WordPressSiteGroup, choices: SiteCardPreferences["faviconSites"]): WordPressManagedSite {
  const members = siteCardMembers(group);
  return members.find(site => site.id === choices[siteCardId(group)]) ?? members[0]!;
}
