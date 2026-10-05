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
 * A site's plugin-engine runs (running ones, then recent ones) with their cards. Needs only the
 * site ID, so it renders even while the site itself does not answer (a push or rollback fences
 * it): the cards are how such a transfer is followed and controlled.
 */
export default function PluginSiteRuns({ siteId }: { siteId: string }) {
  const runs = useRecentRuns(SITE_RUN_ACTIONS);
  const siteRuns = runsOfSite(runs.data ?? [], siteId);
  const active = siteRuns.filter(run => !isTerminalStatus(run.status));
  const recent = recentTransferRuns(siteRuns);
  const pinned = recent.filter(endedBadly).length;
  const card = (run: RecentRun) => <PluginRunCard key={run.runId} recent={run} siteId={siteId} title={runTitle(run)} kind={run.actionId === ENGINE_ACTIONS.push ? "push" : run.actionId === ENGINE_ACTIONS.replace ? "replace" : "other"} />;
  return <section className="min-w-0 space-y-2" aria-label="Plugin-engine transfers of this site">
    <h4 className="text-sm font-semibold text-text-heading">Transfers</h4>
    {runs.isLoading && <p className="text-sm text-text-secondary">Loading transfers…</p>}
    {runs.error && <p role="alert" className="text-sm text-status-error">Could not load transfers: {engineErrorMessage(runs.error)} <Btn size="sm" onClick={() => void runs.refetch()}>Retry</Btn></p>}
    {active.length > 0 && <p className="text-xs text-text-secondary">Transfers run on the Zoer server. You can close this dialog or leave the page.</p>}
    {active.map(card)}
    {recent.length > 0 && <details data-zoer-disclosure open={!active.length || undefined}><summary className="flex min-h-11 cursor-pointer items-center text-sm text-text-secondary">Recent transfers ({recent.length}{pinned ? `, ${pinned} failed` : ""})</summary><div className="mt-2 space-y-2">{recent.map(card)}</div></details>}
    {runs.data && !siteRuns.length && <p className="text-sm text-text-secondary">No plugin-engine transfers of this site yet.</p>}
  </section>;
}
