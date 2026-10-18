import { ENGINE_ACTIONS, isTerminalStatus, runInput, runsOfSite, type RecentRun } from "./runState";

/** A transfer that is running on one of a website's connections (newest first). */
export interface ActiveSiteRun { run: RecentRun; siteId: string; writes: boolean; title: string; /** Waiting for a decision (review, approval, reconnect). */ needsUser: boolean }

/** Actions that change the site they run on; pulls and local exports only read it. */
const WRITING_ACTIONS: readonly string[] = [ENGINE_ACTIONS.push, ENGINE_ACTIONS.replace, ENGINE_ACTIONS.control];

function activeTitle(run: RecentRun, siteId: string) {
  const input = runInput(run);
  switch (run.actionId) {
    case ENGINE_ACTIONS.copy: return input.replaceSiteId === siteId ? "Refreshing from live" : "Making a local copy";
    case ENGINE_ACTIONS.pull: return input.action === "backup" ? "Backing up" : input.action === "export" ? "Exporting" : "Pulling";
    case ENGINE_ACTIONS.localExport: return "Exporting this site";
    case ENGINE_ACTIONS.push: return "Pushing to this site";
    case ENGINE_ACTIONS.replace: return "Find & Replace";
    case ENGINE_ACTIONS.control: return "Finishing an import";
    default: return "Transfer";
  }
}

/**
 * Running transfers of a website: started for one of its connections or refreshing it as a local
 * copy. `writes` is set when the transfer changes the site (a refresh into this local copy, a push,
 * Find & Replace or an import control), when its plugin and theme changes should wait.
 */
export function activeSiteRuns(runs: readonly RecentRun[], siteIds: readonly string[]): ActiveSiteRun[] {
  const seen = new Set<string>();
  const active: ActiveSiteRun[] = [];
  for (const siteId of siteIds) {
    for (const run of runsOfSite(runs, siteId)) {
      if (isTerminalStatus(run.status) || seen.has(run.runId)) continue;
      seen.add(run.runId);
      const input = runInput(run);
      const writes = (run.actionId === ENGINE_ACTIONS.copy && input.replaceSiteId === siteId) || (WRITING_ACTIONS.includes(run.actionId) && input.siteId === siteId);
      const needsUser = run.status === "waiting_for_approval" || run.resumable?.state === "needs-user" || run.resumable?.state === "resume-needed";
      active.push({ run, siteId, writes, title: activeTitle(run, siteId), needsUser });
    }
  }
  return active.sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
}
