import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, CheckboxField, Select, controlClass, fieldLabelClass, radioClass, selectClass, useDialogs } from "@zoer/plugin-ui/controls";
import { commitCatalog, engineKeys, startEngineAction, useCatalogKind, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { useWordPressDiagnostics } from "../../../lib/queries/wordpress-transfer";
import { resourceQueries } from "../../../lib/queries/resources";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import CopySettingsPanels from "./CopySettingsPanels";
import { type LocalUserMode } from "./LocalImportPanels";
import { copyInput, copyPresetRecord, copySettingsProblem, copySettingsSummary, defaultCopySettings, parseCopyPreset, type CopyPreset, type CopySettings } from "./refreshOptions";
import PluginRunCard, { localCopyStages } from "./PluginRunCard";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";
import { existingCopies, parseLocalCopyRecord, refreshCandidates, type LocalCopyRecord, type PullRecord } from "./records";

const COPY_ACTIONS = [ENGINE_ACTIONS.copy] as const;

/**
 * `copy.local`: a new DDEV copy or a refresh of an earlier copy (`replaceSiteId`), optionally from
 * an existing verified pull (`pullSetId`). Dry runs create a scratch site and archive it afterwards;
 * they cannot refresh an existing copy. Earlier copies (`local-copy:` records, including copies the
 * legacy host engine made, migrated by Zoer) are listed and can be refreshed.
 */
export default function PluginLocalCopy({ siteId, siteName, sourceUrl = null, pull = null, onClearPull, refreshSiteId }: { siteId: string; siteName: string; sourceUrl?: string | null; pull?: PullRecord | null; onClearPull?: () => void; /** Opens on "Refresh" with this local copy chosen. */ refreshSiteId?: string }) {
  const client = useQueryClient();
  const connectors = useQuery({ ...resourceQueries.connectors(), refetchInterval: 10_000 });
  const ddev = connectors.data?.find(c => c.id === "ddev");
  const available = ddev?.active === true;
  const copies = useCatalogKind("local-copy");
  const copyRecords = (copies.data ?? []).map(parseLocalCopyRecord).filter((c): c is LocalCopyRecord => !!c);
  const candidates = refreshCandidates(copyRecords, siteId);
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const existing = existingCopies(copyRecords, siteId);
  const runs = useRecentRuns(COPY_ACTIONS);
  const siteRuns = (runs.data ?? []).filter(run => runInput(run).siteId === siteId).slice(0, 5);
  const running = siteRuns.some(run => !isTerminalStatus(run.status));
  const [mode, setMode] = useState<"new" | "refresh">(refreshSiteId ? "refresh" : "new");
  const [name, setName] = useState(siteName ? `${siteName} local`.slice(0, 60) : "");
  const [replaceSiteId, setReplaceSiteId] = useState(refreshSiteId ?? "");
  const [settingsByMode, setSettingsByMode] = useState<Record<"new" | "refresh", CopySettings>>(() => ({ new: defaultCopySettings(false), refresh: defaultCopySettings(true) }));
  const presets = useCatalogKind("refresh-preset");
  const presetList = (presets.data ?? []).map(parseCopyPreset).filter((preset): preset is CopyPreset => !!preset).sort((a, b) => a.name.localeCompare(b.name));
  const [presetId, setPresetId] = useState("");
  const dialogs = useDialogs();
  // The live site's inventory fills the post type, table, theme and plugin pickers.
  const diagnostics = useWordPressDiagnostics(siteId, { enabled: available });
  const [dryRun, setDryRun] = useState(false);
  const [users, setUsers] = useState<LocalUserMode>("local");
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
    // The new copy's `site-link:` record groups it under this site in the sidebar.
    void client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") });
  }, [siteRuns, client]);

  const refresh = mode === "refresh";
  const settings = settingsByMode[mode];
  const setSettings = (next: CopySettings) => setSettingsByMode(current => ({ ...current, [mode]: next }));
  const problem = copySettingsProblem(settings, refresh);
  const canStart = available && !starting && !running && !problem && (refresh ? !!replaceSiteId : !!name.trim() && name.trim().length <= 60);
  async function savePreset() {
    const current = presetList.find(preset => preset.id === presetId);
    const name = (await dialogs.prompt({ title: "Save copy settings", description: "Saved settings can be loaded for any site's local copy or refresh.", label: "Name", defaultValue: current?.name ?? "", submitLabel: current ? "Save" : "Save settings" }))?.trim();
    if (!name) return;
    if (name.length > 60) { setError("Use a name of up to 60 characters."); return; }
    const existing = presetList.find(preset => preset.name.toLowerCase() === name.toLowerCase());
    const id = existing ? existing.id.slice("refresh-preset:".length) : newHexId();
    try {
      await commitCatalog({ records: [copyPresetRecord(id, name, settings)] }, "refresh-preset");
      await client.invalidateQueries({ queryKey: engineKeys.catalog("refresh-preset") });
      setPresetId(`refresh-preset:${id}`);
    } catch (caught) { setError(engineErrorMessage(caught, "The settings could not be saved.")); }
  }
  async function deletePreset() {
    const current = presetList.find(preset => preset.id === presetId);
    if (!current || !await dialogs.confirm({ title: `Delete “${current.name}”?`, description: "Only the saved settings are deleted.", confirmLabel: "Delete", tone: "danger" })) return;
    try {
      await commitCatalog({ deletes: [current.id] }, "refresh-preset");
      await client.invalidateQueries({ queryKey: engineKeys.catalog("refresh-preset") });
      setPresetId("");
    } catch (caught) { setError(engineErrorMessage(caught, "The settings could not be deleted.")); }
  }
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    setStarting(true); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.copy, {
        siteId, copyId: newHexId(),
        ...(refresh ? { replaceSiteId } : { name: name.trim() }),
        // An existing download keeps the selection it was made with; only the import options apply.
        ...(pull?.setId ? Object.fromEntries(Object.entries(copyInput(settings, refresh)).filter(([key]) => !["media", "themes", "plugins", "database", "pace"].includes(key))) : copyInput(settings, refresh)),
        ...(pull?.setId ? { pullSetId: pull.setId } : {}),
        ...(dryRun && !refresh ? { dryRun: true } : {}),
        ...(users !== "local" ? { users } : {}),
      });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The local copy could not start.")); }
    finally { setStarting(false); }
  }

  return <section className="min-w-0 space-y-3 rounded-lg border border-border-default p-3" aria-label="Local copies">
    {!refreshSiteId && <h3 className="font-medium">Local copy</h3>}
    <p className="text-xs text-text-secondary">{refreshSiteId ? "Downloads a fresh copy of the live site and applies it to your local copy." : `Creates or refreshes a separate DDEV site from ${pull ? `the download of ${new Date(pull.createdAt).toLocaleString()}` : "a new pull of this site"}.`} Runs on the Zoer server; you can close this dialog.</p>
    {pull && onClearPull && <Btn size="sm" variant="ghost" onClick={onClearPull}>Pull again instead</Btn>}
    {!available && <p role="status" className="text-sm text-status-warning">{connectors.isLoading ? "Checking local WordPress availability…" : ddev?.unavailableReason || "DDEV is unavailable. Complete server setup before creating a local copy."}</p>}
    <form onSubmit={start} className="min-w-0 space-y-3">
      {!refreshSiteId && <fieldset className="min-w-0 space-y-2" disabled={!available || starting}>
        <legend className="sr-only">Local copy destination</legend>
        <label className="flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px]">
          <input type="radio" name={`plugin-copy-mode-${siteId}`} className={`${radioClass} mt-0.5`} checked={!refresh} onChange={() => setMode("new")} />
          <span><span className="block text-text-primary">Create new local copy</span><span className="block text-[12px] text-text-muted">A new DDEV site with its own administrator account.</span></span>
        </label>
        <label className={`flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px] ${candidates.length ? "" : "opacity-60"}`}>
          <input type="radio" name={`plugin-copy-mode-${siteId}`} className={`${radioClass} mt-0.5`} checked={refresh} disabled={!candidates.length} onChange={() => setMode("refresh")} />
          <span><span className="block text-text-primary">Refresh an earlier local copy</span><span className="block text-[12px] text-text-muted">{candidates.length ? "Choose database only to keep development code and local settings." : "No local copy of this site yet."}</span></span>
        </label>
      </fieldset>}
      {refresh && refreshSiteId ? <p className="text-sm">Refreshes <strong>{sites.find(site => site.id === refreshSiteId)?.name ?? candidates.find(copy => copy.targetId === refreshSiteId)?.name ?? refreshSiteId}</strong> from <strong>{siteName}</strong>.</p>
        : refresh
        ? <label className="block"><span className={fieldLabelClass}>Local copy to refresh</span>
          <Select aria-label="Local copy to refresh" className={selectClass("default", "w-full")} value={replaceSiteId} onChange={event => setReplaceSiteId(event.target.value)} disabled={starting || !available}>
            <option value="">Choose local copy</option>
            {candidates.map(copy => <option key={copy.targetId} value={copy.targetId}>{copy.name || copy.siteName || copy.targetId}{copy.targetUrl ? ` · ${copy.targetUrl.replace(/^https?:\/\//, "")}` : ""}</option>)}
          </Select>
        </label>
        : <label className="block"><span className={fieldLabelClass}>Local site name</span><input className={controlClass("default", "text-base sm:text-[14px]")} value={name} maxLength={60} onChange={event => setName(event.target.value)} required disabled={starting || !available} /></label>}
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-48"><span className={fieldLabelClass}>Saved settings</span>
          <Select aria-label="Saved copy settings" className={selectClass("default", "w-full")} value={presetId} disabled={starting} onChange={event => {
            const preset = presetList.find(item => item.id === event.target.value);
            setPresetId(event.target.value);
            if (preset) setSettings({ ...preset.settings, ...(refresh ? {} : { database: true, files: true }) });
          }}>
            <option value="">{presetList.length ? "Choose saved settings" : "No saved settings yet"}</option>
            {presetList.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </Select>
        </label>
        <Btn size="sm" disabled={starting} onClick={() => void savePreset()}>{presetId ? "Save changes" : "Save settings"}</Btn>
        {presetId && <Btn size="sm" variant="ghost" disabled={starting} onClick={() => void deletePreset()}>Delete</Btn>}
      </div>
      <p className="text-xs text-text-secondary">{copySettingsSummary(settings, refresh)}{pull ? ". This download's own selection of files and tables applies." : ""}</p>
      <CopySettingsPanels id={siteId} refresh={refresh} settings={settings} onSettings={setSettings} users={users} onUsers={setUsers} sourceUrl={sourceUrl} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} disabled={starting || !available} />
      {problem && <p role="status" className="text-xs text-status-warning">{problem}</p>}
      {refresh && <p className="text-xs text-text-secondary">{users === "source" ? "The refresh replaces the copy's accounts with the source's; its local administrator is kept and marked so later refreshes find it."
        : users === "exact" ? "The refresh replaces the copy's accounts with exactly the source's, including its local administrator." : "The copy keeps the accounts it has now."}</p>}
      {!refresh && <CheckboxField label="Dry run" description={refresh ? "Not available when refreshing an existing copy." : "Builds a scratch site named zoer-dryrun-…, verifies the import and archives the scratch site. Your sites are unchanged."} checked={dryRun && !refresh} onChange={setDryRun} disabled={refresh || starting} />}
      {running && <p className="text-xs text-text-secondary">Wait for the current copy of this site to finish before starting another.</p>}
      <Btn type="submit" variant="primary" className="w-full sm:w-auto" disabled={!canStart} loading={starting}>{dryRun && !refresh ? "Start dry run" : refresh ? "Refresh local copy" : "Create local copy"}</Btn>
    </form>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {runs.error && <p role="alert" className="text-sm text-status-error">Could not load local copies: {engineErrorMessage(runs.error)}</p>}
    {siteRuns.length > 0 && <div className="min-w-0 space-y-2">{siteRuns.map(run => <PluginRunCard key={run.runId} recent={run} title={runInput(run).replaceSiteId ? "Refresh local copy" : "Local copy"} stages={localCopyStages(runInput(run))} />)}</div>}
    {existing.length > 0 && !refreshSiteId && <div className="min-w-0 space-y-2">
      <h4 className="text-sm font-semibold text-text-heading">Local copies of this site</h4>
      <ul className="min-w-0 space-y-1.5">{existing.map(copy => {
        const listed = sites.find(site => site.id === copy.targetId);
        return <li key={copy.copyId} className="min-w-0 rounded-md border border-border-muted bg-surface-primary/50 px-3 py-2 text-[13px]">
          <p className="break-words font-medium text-text-primary">{listed?.name ?? copy.name ?? copy.siteName ?? copy.targetId}</p>
          <p className="break-words text-[12px] text-text-secondary">{copy.targetUrl ? copy.targetUrl.replace(/^https?:\/\//, "") : copy.targetId}{copy.finishedAt ? ` · ${new Date(copy.finishedAt).toLocaleString()}` : ""}{listed ? "" : " · no longer listed"}</p>
        </li>;
      })}</ul>
    </div>}
  </section>;
}
