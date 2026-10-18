import { Btn } from "@zoer/plugin-ui/controls";
import { useRecentRuns } from "../../../lib/queries/plugin-engine";
import PluginRunCard from "./PluginRunCard";
import { endedBadly, ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, recentTransferRuns, runInput, runsOfSite, SITE_RUN_ACTIONS, type RecentRun } from "./runState";

const RUN_TITLES: Record<string, string> = { [ENGINE_ACTIONS.pull]: "Pull", [ENGINE_ACTIONS.localExport]: "Local export", [ENGINE_ACTIONS.push]: "Push", [ENGINE_ACTIONS.replace]: "Find & Replace", [ENGINE_ACTIONS.copy]: "Local copy" };
const CONTROL_TITLES: Record<string, string> = { approve: "Approve import", finish: "Finish import", rollback: "Roll back import", cleanup: "Clean up import" };

export function runTitle(run: RecentRun) {
  const input = runInput(run);
  if (run.actionId === ENGINE_ACTIONS.pull && (input.action === "backup" || input.action === "export")) return input.action === "backup" ? "Backup" : "Export";
  if (run.actionId === ENGINE_ACTIONS.control) return CONTROL_TITLES[String(input.control)] ?? "Import control";
  return RUN_TITLES[run.actionId] ?? run.actionId;
}

/**
 * A site's transfer runs (running ones, then recent ones) with their cards. Needs only the
 * site ID, so it renders even while the site itself does not answer (a push or rollback fences
 * it): the cards are how such a transfer is followed and controlled. `compact` (the site page's
 * summary) renders nothing until the site has a transfer.
 */
export default function PluginSiteRuns({ siteId, compact = false, activeOnly = false }: { siteId: string; compact?: boolean; /** Only running transfers and recent failures that can be retried, with their controls; nothing when there are none (Activity lists the rest). */ activeOnly?: boolean }) {
  const runs = useRecentRuns(SITE_RUN_ACTIONS);
  const siteRuns = runsOfSite(runs.data ?? [], siteId);
  const active = siteRuns.filter(run => !isTerminalStatus(run.status));
  const recent = recentTransferRuns(siteRuns);
  const pinned = recent.filter(endedBadly).length;
  if (compact && !siteRuns.length) return null;
  // A failure stays "needs attention" for a week, until the same kind of transfer succeeds again.
  const failed = recent.filter(run => endedBadly(run) && Date.now() - Date.parse(run.finishedAt ?? run.createdAt) <= 7 * 24 * 3_600_000 && !siteRuns.some(other => other.actionId === run.actionId && other.status === "succeeded" && other.createdAt > run.createdAt));
  if (activeOnly && !active.length && !failed.length) return null;
  const card = (run: RecentRun) => <PluginRunCard allowRecovery={!siteRuns.some(other => other.runId !== run.runId && other.createdAt > run.createdAt && runInput(other).pullId === runInput(run).pullId)} key={run.runId} recent={run} siteId={siteId} title={runTitle(run)} kind={run.actionId === ENGINE_ACTIONS.push ? "push" : run.actionId === ENGINE_ACTIONS.replace ? "replace" : "other"} />;
  return <section className="min-w-0 space-y-2" aria-label="Transfers of this site">
    <h4 className="text-sm font-semibold text-text-heading">{activeOnly ? active.length ? "Running now" : "Needs attention" : "Transfers"}</h4>
    {runs.isLoading && <p className="text-sm text-text-secondary">Loading transfers…</p>}
    {runs.error && <p role="alert" className="text-sm text-status-error">Could not load transfers: {engineErrorMessage(runs.error)} <Btn size="sm" onClick={() => void runs.refetch()}>Retry</Btn></p>}
    {active.length > 0 && <p className="text-xs text-text-secondary">Transfers run on the Zoer server. You can close this dialog or leave the page.</p>}
    {active.map(card)}
    {activeOnly && failed.length > 0 && <>{active.length > 0 && <h4 className="pt-2 text-sm font-semibold text-text-heading">Needs attention</h4>}{failed.map(card)}</>}
    {!activeOnly && recent.length > 0 && <details open={!active.length || undefined}><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm text-text-secondary">Recent transfers ({recent.length}{pinned ? `, ${pinned} failed` : ""})</summary><div className="mt-2 space-y-2">{recent.map(card)}</div></details>}
    {!activeOnly && runs.data && !siteRuns.length && <p className="text-sm text-text-secondary">No transfers of this site yet.</p>}
  </section>;
}
