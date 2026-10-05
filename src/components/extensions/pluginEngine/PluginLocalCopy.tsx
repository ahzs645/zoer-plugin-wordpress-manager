import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, CheckboxField, Select, controlClass, fieldLabelClass, radioClass, selectClass } from "@zoer/plugin-ui/controls";
import { engineKeys, startEngineAction, useCatalogKind, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { resourceQueries } from "../../../lib/queries/resources";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import PluginRunCard from "./PluginRunCard";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";
import { parseLocalCopyRecord, refreshCandidates, type LocalCopyRecord, type PullRecord } from "./records";

const COPY_ACTIONS = [ENGINE_ACTIONS.copy] as const;

/**
 * `copy.local` for a site on the plugin engine: a new DDEV copy or a refresh of an earlier copy
 * (`replaceSiteId`), optionally from an existing verified pull (`pullSetId`). Dry runs create a
 * scratch site and archive it afterwards; they cannot refresh an existing copy.
 */
export default function PluginLocalCopy({ siteId, siteName, pull = null, onClearPull }: { siteId: string; siteName: string; pull?: PullRecord | null; onClearPull?: () => void }) {
  const client = useQueryClient();
  const connectors = useQuery({ ...resourceQueries.connectors(), refetchInterval: 10_000 });
  const ddev = connectors.data?.find(c => c.id === "ddev");
  const available = ddev?.active === true;
  const copies = useCatalogKind("local-copy");
  const candidates = refreshCandidates((copies.data ?? []).map(parseLocalCopyRecord).filter((c): c is LocalCopyRecord => !!c), siteId);
  const runs = useRecentRuns(COPY_ACTIONS);
  const siteRuns = (runs.data ?? []).filter(run => runInput(run).siteId === siteId).slice(0, 5);
  const running = siteRuns.some(run => !isTerminalStatus(run.status));
  const [mode, setMode] = useState<"new" | "refresh">("new");
  const [name, setName] = useState(siteName ? `${siteName} local`.slice(0, 60) : "");
  const [replaceSiteId, setReplaceSiteId] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const finished = useRef(new Set<string>());

  // A finished copy adds or changes a local site: refresh the site list once.
  useEffect(() => {
    const done = siteRuns.filter(run => run.status === "succeeded" && !finished.current.has(run.runId));
    if (!done.length) return;
    for (const run of done) finished.current.add(run.runId);
    void client.invalidateQueries({ queryKey: wordpressQueries.sites().queryKey });
    void client.invalidateQueries({ queryKey: engineKeys.catalog("local-copy") });
  }, [siteRuns, client]);

  const refresh = mode === "refresh";
  const canStart = available && !starting && !running && (refresh ? !!replaceSiteId : !!name.trim() && name.trim().length <= 60);
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    setStarting(true); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.copy, {
        siteId, copyId: newHexId(),
        ...(refresh ? { replaceSiteId } : { name: name.trim() }),
        ...(pull?.setId ? { pullSetId: pull.setId } : {}),
        ...(dryRun && !refresh ? { dryRun: true } : {}),
      });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The local copy could not start.")); }
    finally { setStarting(false); }
  }

  return <section className="min-w-0 space-y-3 rounded-lg border border-status-warning/40 p-3" aria-label="Local copies with the plugin engine">
    <h3 className="font-medium">Local copy · plugin engine (test)</h3>
    <p className="text-xs text-text-secondary">Creates or refreshes a separate DDEV site from {pull ? `the download of ${new Date(pull.createdAt).toLocaleString()}` : "a new complete pull of this site"}. Plugins start inactive; scheduled tasks and outgoing mail/HTTP requests stay disabled. You can close this dialog while it runs.</p>
    {pull && onClearPull && <Btn size="sm" variant="ghost" onClick={onClearPull}>Pull again instead</Btn>}
    {!available && <p role="status" className="text-sm text-status-warning">{connectors.isLoading ? "Checking local WordPress availability…" : ddev?.unavailableReason || "DDEV is unavailable. Complete server setup before creating a local copy."}</p>}
    <form onSubmit={start} className="min-w-0 space-y-3">
      <fieldset className="min-w-0 space-y-2" disabled={!available || starting}>
        <legend className="sr-only">Local copy destination</legend>
        <label className="flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px]">
          <input type="radio" name={`plugin-copy-mode-${siteId}`} className={`${radioClass} mt-0.5`} checked={!refresh} onChange={() => setMode("new")} />
          <span><span className="block text-text-primary">Create new local copy</span><span className="block text-[12px] text-text-muted">A new DDEV site with its own administrator account.</span></span>
        </label>
        <label className={`flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px] ${candidates.length ? "" : "opacity-60"}`}>
          <input type="radio" name={`plugin-copy-mode-${siteId}`} className={`${radioClass} mt-0.5`} checked={refresh} disabled={!candidates.length} onChange={() => setMode("refresh")} />
          <span><span className="block text-text-primary">Refresh an earlier plugin-engine copy</span><span className="block text-[12px] text-text-muted">{candidates.length ? "Replaces its files and database. Its local administrator account is kept." : "No plugin-engine copy of this site yet."}</span></span>
        </label>
      </fieldset>
      {refresh
        ? <label className="block"><span className={fieldLabelClass}>Local copy to refresh</span>
          <Select aria-label="Local copy to refresh" className={selectClass("default", "w-full")} value={replaceSiteId} onChange={event => setReplaceSiteId(event.target.value)} disabled={starting || !available}>
            <option value="">Choose local copy</option>
            {candidates.map(copy => <option key={copy.targetId} value={copy.targetId}>{copy.name || copy.siteName || copy.targetId}{copy.targetUrl ? ` · ${copy.targetUrl.replace(/^https?:\/\//, "")}` : ""}</option>)}
          </Select>
        </label>
        : <label className="block"><span className={fieldLabelClass}>Local site name</span><input className={controlClass("default", "text-base sm:text-[14px]")} value={name} maxLength={60} onChange={event => setName(event.target.value)} required disabled={starting || !available} /></label>}
      <CheckboxField label="Dry run" description={refresh ? "Not available when refreshing an existing copy." : "Builds a scratch site named zoer-dryrun-…, verifies the import and archives the scratch site. Your sites are unchanged."} checked={dryRun && !refresh} onChange={setDryRun} disabled={refresh || starting} />
      {running && <p className="text-xs text-text-secondary">Wait for the current copy of this site to finish before starting another.</p>}
      <Btn type="submit" variant="primary" className="w-full sm:w-auto" disabled={!canStart} loading={starting}>{dryRun && !refresh ? "Start dry run" : refresh ? "Refresh local copy" : "Create local copy"}</Btn>
    </form>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {runs.error && <p role="alert" className="text-sm text-status-error">Could not load local copies: {engineErrorMessage(runs.error)}</p>}
    {siteRuns.length > 0 && <div className="min-w-0 space-y-2">{siteRuns.map(run => <PluginRunCard key={run.runId} recent={run} title={runInput(run).replaceSiteId ? "Refresh local copy" : "Local copy"} />)}</div>}
  </section>;
}
