import type { WordPressManagedSite } from "../../lib/api";
import { commitCatalog } from "../../lib/queries/plugin-engine";

/**
 * A site's stack: a local site's main live site is its `site-link:` record; every other live
 * site it was deployed to (Deploy to a new Hostinger website, on any account) is a
 * `site-deploy:<live site>` record naming the local site. The site list shows them on one card.
 */
export interface SiteDeployLink { liveSiteId: string; localSiteId: string }
export const DEPLOY_KIND = "site-deploy";
const deployId = (liveSiteId: string) => `${DEPLOY_KIND}:${liveSiteId}`;

export function parseSiteDeploy(record: { kind?: string; data?: unknown }): SiteDeployLink | null {
  const data = record.data as Partial<SiteDeployLink> | undefined;
  if (record.kind !== DEPLOY_KIND || !data || typeof data.liveSiteId !== "string" || typeof data.localSiteId !== "string" || !data.liveSiteId || !data.localSiteId || data.liveSiteId === data.localSiteId) return null;
  return { liveSiteId: data.liveSiteId, localSiteId: data.localSiteId };
}

const deployRecord = (local: Pick<WordPressManagedSite, "id" | "name">, liveSiteId: string) =>
  ({ id: deployId(liveSiteId), kind: DEPLOY_KIND, title: `Live site of ${local.name}`, data: { v: 1, localSiteId: local.id, liveSiteId, linkedAt: new Date().toISOString() } });

/** Adds `liveSiteId` to the stack of `local` as another live site. */
export async function addStackLive(local: Pick<WordPressManagedSite, "id" | "name">, liveSiteId: string) {
  await commitCatalog({ records: [deployRecord(local, liveSiteId)] }, DEPLOY_KIND);
}

/** Takes another live site off the card; the website itself is not changed. */
export async function removeStackLive(liveSiteId: string) {
  await commitCatalog({ deletes: [deployId(liveSiteId)] }, DEPLOY_KIND);
}

/** Makes `liveSiteId` the main live site of `local` (Push to live, Pull from live); the previous main one stays on the card. */
export async function makeMainLive(local: Pick<WordPressManagedSite, "id" | "name">, liveSiteId: string, previousLiveId: string | null) {
  await commitCatalog({
    records: [
      { id: `site-link:${local.id}`, kind: "site-link", title: `Live site of ${local.name}`, data: { v: 1, targetSiteId: local.id, sourceSiteId: liveSiteId, linkedAt: new Date().toISOString() } },
      ...(previousLiveId && previousLiveId !== liveSiteId ? [deployRecord(local, previousLiveId)] : []),
    ],
    deletes: [deployId(liveSiteId)],
  }, DEPLOY_KIND);
}

/** A card's own name (`site-group-name:<card>`, the card's main live site ID); the sites keep theirs. */
export const GROUP_NAME_KIND = "site-group-name";
export function parseGroupName(record: { kind?: string; data?: unknown }): { groupId: string; name: string } | null {
  const data = record.data as { groupId?: unknown; name?: unknown } | undefined;
  if (record.kind !== GROUP_NAME_KIND || typeof data?.groupId !== "string" || typeof data.name !== "string" || !data.groupId || !data.name.trim()) return null;
  return { groupId: data.groupId, name: data.name.trim().slice(0, 100) };
}
/** Names the card of `groupId`; an empty name goes back to the main site's name. */
export async function renameGroup(groupId: string, name: string) {
  const id = `${GROUP_NAME_KIND}:${groupId}`, trimmed = name.trim().slice(0, 100);
  await commitCatalog(trimmed ? { records: [{ id, kind: GROUP_NAME_KIND, title: trimmed, data: { v: 1, groupId, name: trimmed } }] } : { deletes: [id] }, GROUP_NAME_KIND);
}
