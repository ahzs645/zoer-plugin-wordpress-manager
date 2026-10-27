import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, CheckboxField, Select, controlClass, fieldLabelClass, radioClass, selectClass, useDialogs } from "@zoer/plugin-ui/controls";
import { commitCatalog, engineKeys, startEngineAction, useCatalogKind, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { useWordPressDiagnostics } from "../../../lib/queries/wordpress-transfer";
import { resourceQueries } from "../../../lib/queries/resources";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import CopySettingsPanels from "./CopySettingsPanels";
import { type LocalUserMode } from "./LocalImportPanels";
import { copyInput, copyInputForDownload, copyPresetRecord, copySettingsProblem, defaultCopySettings, parseCopyPreset, type CopyPreset, type CopySettings } from "./refreshOptions";
import PluginRunCard, { localCopyStages } from "./PluginRunCard";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";
import { parseLocalCopyRecord, refreshCandidates, type LocalCopyRecord, type PullRecord } from "./records";
import { formatWhen } from "../../../lib/formatWhen";

const COPY_ACTIONS = [ENGINE_ACTIONS.copy] as const;
const INTO_OPTION = "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]";

/**
 * `copy.local`: a new DDEV copy or a refresh of an earlier copy (`replaceSiteId`), optionally from
 * an existing verified pull (`pullSetId`). Dry runs create a scratch site and archive it afterwards;
 * they cannot refresh an existing copy. Earlier copies (`local-copy:` records, including copies the
 * legacy host engine made, migrated by Zoer) are listed as destinations beside a new copy.
 */
export default function PluginLocalCopy({ siteId, siteName, sourceUrl = null, pull = null, onClearPull, refreshSiteId, heading = true }: { siteId: string; siteName: string; sourceUrl?: string | null; pull?: PullRecord | null; onClearPull?: () => void; /** Opens with this local copy chosen; null or omitted chooses a new copy. */ refreshSiteId?: string | null; /** False inside a dialog whose title already names the action. */ heading?: boolean }) {
  const client = useQueryClient();
  const connectors = useQuery({ ...resourceQueries.connectors(), refetchInterval: 10_000 });
  const ddev = connectors.data?.find(c => c.id === "ddev");
  const kubernetes = connectors.data?.find(c => c.id === "wordpress-kubernetes");
  const [runtimeProfile, setRuntimeProfile] = useState("wordpress-ddev");
  const copies = useCatalogKind("local-copy");
  const copyRecords = (copies.data ?? []).map(parseLocalCopyRecord).filter((c): c is LocalCopyRecord => !!c);
  const candidates = refreshCandidates(copyRecords, siteId);
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const runs = useRecentRuns(COPY_ACTIONS);
  const siteRuns = (runs.data ?? []).filter(run => runInput(run).siteId === siteId).slice(0, 5);
  const running = siteRuns.some(run => !isTerminalStatus(run.status));
  // One destination list: each earlier copy of this site (refresh it) or a new copy.
  const [replaceSiteId, setReplaceSiteId] = useState(refreshSiteId ?? "");
  const mode: "new" | "refresh" = replaceSiteId ? "refresh" : "new";
  const selectedConnector = (replaceSiteId ? replaceSiteId.startsWith("wpilot-") : runtimeProfile === "wordpress-kubernetes") ? kubernetes : ddev;
  const available = selectedConnector?.active === true;
  const [name, setName] = useState(siteName ? `${siteName} local`.slice(0, 60) : "");
  const siteLabel = (id: string) => sites.find(site => site.id === id)?.name;
  const targets = [
    ...candidates.map(copy => ({ id: copy.targetId, name: siteLabel(copy.targetId) ?? copy.name ?? copy.siteName ?? copy.targetId, url: copy.targetUrl })),
    ...(refreshSiteId && !candidates.some(copy => copy.targetId === refreshSiteId) ? [{ id: refreshSiteId, name: siteLabel(refreshSiteId) ?? refreshSiteId, url: sites.find(site => site.id === refreshSiteId)?.managedUrl ?? null }] : []),
  ];
  const [settingsByMode, setSettingsByMode] = useState<Record<"new" | "refresh", CopySettings>>(() => ({ new: defaultCopySettings(false), refresh: defaultCopySettings(true) }));
  const presets = useCatalogKind("refresh-preset");
  const presetList = (presets.data ?? []).map(parseCopyPreset).filter((preset): preset is CopyPreset => !!preset).sort((a, b) => a.name.localeCompare(b.name));
  const [presetIds, setPresetIds] = useState<Record<"new" | "refresh", string>>({ new: "", refresh: "" });
  const dialogs = useDialogs();
  // The live site's inventory fills the post type, table, theme and plugin pickers.
  const diagnostics = useWordPressDiagnostics(siteId, { enabled: available, local: /^(?:ddev-|wpilot-)/.test(siteId) });
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
    // The new copy's `site-link:` record groups it under this site in the sidebar.
    void client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") });
  }, [siteRuns, client]);

  const refresh = mode === "refresh";
  const settings = settingsByMode[mode];
  const setSettings = (next: CopySettings) => setSettingsByMode(current => ({ ...current, [mode]: next }));
  // The account choice is part of the settings, so a saved preset restores it.
  const users: LocalUserMode = settings.users;
  const setUsers = (value: LocalUserMode) => setSettings({ ...settings, users: value });
  const presetId = presetIds[mode];
  const setPresetId = (id: string) => setPresetIds(current => ({ ...current, [mode]: id }));
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
        ...(refresh ? { replaceSiteId } : { name: name.trim(), ...(runtimeProfile === "wordpress-kubernetes" ? { runtimeProfile } : {}) }),
        // An existing download keeps the selection it was made with; only the import options apply.
        ...(pull?.setId ? copyInputForDownload(settings, refresh, pull) : copyInput(settings, refresh)),
        ...(pull?.setId ? { pullSetId: pull.setId } : {}),
        ...(dryRun && !refresh ? { dryRun: true } : {}),
        // A files-only refresh leaves the accounts alone.
        ...(users !== "local" && (pull?.setId ? !!pull.options?.database : settings.database) ? { users } : {}),
      });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The local copy could not start.")); }
    finally { setStarting(false); }
  }

  return <section className="min-w-0 space-y-3 rounded-lg border border-border-default p-3" aria-label="Local copies">
    {heading && <h3 className="font-medium">Local copy</h3>}
    <p className="text-xs text-text-secondary">Copies {pull ? `the download of ${formatWhen(pull.createdAt)}` : `a fresh pull of ${siteName || "this site"}`} into a new local site or refreshes one of its earlier copies. Runs on the Zoer server; you can close this dialog.</p>
    {pull && onClearPull && <Btn size="sm" variant="ghost" onClick={onClearPull}>Pull again instead</Btn>}
    {!available && <p role="status" className="text-sm text-status-warning">{connectors.isLoading ? "Checking local WordPress availability…" : selectedConnector?.unavailableReason || "This local runtime is unavailable."}</p>}
    <form onSubmit={start} className="min-w-0 space-y-3">
      {!replaceSiteId && <label className="block"><span className={fieldLabelClass}>Local runtime</span><Select aria-label="Local runtime" value={runtimeProfile} disabled={starting} onChange={e => setRuntimeProfile(e.target.value)}><option value="wordpress-ddev" disabled={!ddev?.active}>DDEV</option><option value="wordpress-kubernetes" disabled={!kubernetes?.active}>Kubernetes pilot</option></Select></label>}
      <fieldset className="min-w-0 space-y-2" disabled={!available || starting}>
        <legend className={fieldLabelClass}>Into</legend>
        {targets.map(target => <label key={target.id} className={`${INTO_OPTION} ${replaceSiteId === target.id ? "border-accent bg-surface-hover" : "border-border-default"}`}>
          <input type="radio" name={`plugin-copy-target-${siteId}`} className={`${radioClass} mt-0.5`} checked={replaceSiteId === target.id} onChange={() => setReplaceSiteId(target.id)} />
          <span className="min-w-0"><span className="block break-words text-text-primary">{target.name} <span className="ml-1 rounded border border-border-muted px-1.5 py-px text-[11px] text-text-secondary">Local copy</span></span><span className="block break-words text-[12px] text-text-muted">{target.url ? `${target.url.replace(/^https?:\/\//, "")} · ` : ""}refresh this copy</span></span>
        </label>)}
        <label className={`${INTO_OPTION} ${!replaceSiteId ? "border-accent bg-surface-hover" : "border-border-default"}`}>
          <input type="radio" name={`plugin-copy-target-${siteId}`} className={`${radioClass} mt-0.5`} checked={!replaceSiteId} onChange={() => setReplaceSiteId("")} />
          <span><span className="block text-text-primary">A new local copy</span><span className="block text-[12px] text-text-muted">A separate site with its own administrator account.</span></span>
        </label>
      </fieldset>
      {!refresh && <label className="block"><span className={fieldLabelClass}>Local site name</span><input className={controlClass("default", "text-base sm:text-[14px]")} value={name} maxLength={60} onChange={event => setName(event.target.value)} required disabled={starting || !available} /></label>}
      {pull && <p className="text-xs text-text-secondary">This download's own selection of files and tables applies.</p>}
      <CopySettingsPanels id={siteId} refresh={refresh} settings={settings} onSettings={setSettings} users={users} onUsers={setUsers} sourceUrl={sourceUrl} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} disabled={starting || !available} />
      {refresh && users !== "local" && <p className="text-xs text-text-secondary">{users === "source" ? "The refresh replaces the copy's accounts with the source's; its local administrator is kept and marked so later refreshes find it."
        : "The refresh replaces the copy's accounts with exactly the source's, including its local administrator."}</p>}
      {problem && <p role="status" className="text-xs text-status-warning">{problem}</p>}
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        {presetList.length > 0 && <label className="min-w-0 flex-1 basis-48"><span className={fieldLabelClass}>Saved settings</span>
          <Select searchable aria-label="Saved copy settings" className={selectClass("default", "w-full")} value={presetId} disabled={starting} onChange={event => {
            const preset = presetList.find(item => item.id === event.target.value);
            setPresetId(event.target.value);
            // A new copy always takes the database and files, with every table.
            if (preset) setSettings({ ...preset.settings, ...(refresh ? {} : { database: true, files: true, tables: "all" }) });
          }}>
            <option value="">Choose saved settings</option>
            {presetList.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </Select>
        </label>}
        <Btn disabled={starting} onClick={() => void savePreset()}>{presetId ? "Save changes" : "Save settings"}</Btn>
        {presetId && <Btn variant="ghost" disabled={starting} onClick={() => void deletePreset()}>Delete</Btn>}
      </div>
      {/* An existing download is already on the server, so pace only applies to a fresh pull. */}
      {!pull?.setId && <CheckboxField label="Gentle pace" description="Downloads in smaller requests with pauses, for shared hosts that throttle or time out busy sites. Slower." checked={settings.pace === "gentle"} onChange={value => setSettings({ ...settings, pace: value ? "gentle" : "normal" })} disabled={starting || !available} />}
      {!refresh && <CheckboxField label="Dry run" description="Builds a scratch site named zoer-dryrun-…, verifies the import and archives the scratch site. Your sites are unchanged." checked={dryRun} onChange={setDryRun} disabled={starting} />}
      {running && <p className="text-xs text-text-secondary">Wait for the current copy of this site to finish before starting another.</p>}
      <Btn type="submit" variant="primary" className="w-full sm:w-auto" disabled={!canStart} loading={starting}>{dryRun && !refresh ? "Start dry run" : refresh ? "Refresh local copy" : "Create local copy"}</Btn>
    </form>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {runs.error && <p role="alert" className="text-sm text-status-error">Could not load local copies: {engineErrorMessage(runs.error)}</p>}
    {siteRuns.length > 0 && <div className="min-w-0 space-y-2">{siteRuns.map(run => <PluginRunCard key={run.runId} recent={run} title={runInput(run).replaceSiteId ? "Refresh local copy" : "Local copy"} stages={localCopyStages(runInput(run))} />)}</div>}
  </section>;
}
