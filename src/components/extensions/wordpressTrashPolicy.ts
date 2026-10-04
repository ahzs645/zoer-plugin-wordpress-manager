/** Trashed DDEV sites (S9 `runtime.list.v1 { includeArchived: true }` through `sites.trash`). */
export interface TrashedSite { id: string; name: string; status: string; archivedAt: string; scheduledPurgeAt: string; owned: boolean }

/** S9 removal plan (`runtime.removal-plan.v1` through `site.removal-plan`). */
export interface SiteRemovalPlan {
  resourceId: string;
  name: string;
  confirmationPhrase: string;
  steps: string[];
  warnings: string[];
  retainedResources: string[];
  fingerprintSha256: string;
}

/** Soonest purge first; unknown dates last. */
export function sortTrashedSites(sites: readonly TrashedSite[]): TrashedSite[] {
  const at = (site: TrashedSite) => { const time = Date.parse(site.scheduledPurgeAt); return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY; };
  return [...sites].sort((left, right) => at(left) - at(right) || left.name.localeCompare(right.name));
}

/** "Purged in 3 days" / "Purge due" from the scheduled purge date. */
export function purgeLabel(scheduledPurgeAt: string, now = Date.now()): string {
  const time = Date.parse(scheduledPurgeAt);
  if (!Number.isFinite(time)) return "Purge date unknown";
  const days = Math.ceil((time - now) / 86_400_000);
  if (days <= 0) return "Purge due";
  return days === 1 ? "Purged in 1 day" : `Purged in ${days} days`;
}

/** The removal request: only the exact phrase of an unchanged plan may be sent. */
export function removalRequest(plan: SiteRemovalPlan, typed: string): { siteId: string; fingerprintSha256: string; confirmation: string } | null {
  if (typed !== plan.confirmationPhrase || !/^[a-f0-9]{64}$/.test(plan.fingerprintSha256)) return null;
  return { siteId: plan.resourceId, fingerprintSha256: plan.fingerprintSha256, confirmation: typed };
}
