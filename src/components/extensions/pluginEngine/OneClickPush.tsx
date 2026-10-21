import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, Play, XCircle } from "lucide-react";
import { Btn, checkboxClass, controlClass, fieldLabelClass, radioClass, textareaClass } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../../lib/api";
import type { ImportOptions, WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { cancelRun, engineKeys, startEngineAction, useEngineRun, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { useWordPressDiagnostics } from "../../../lib/queries/wordpress-transfer";
import { applyExportCapabilities, applyImportCapabilities, defaultImportOptions, exportOptionsErrors, exportOptionsForAction, defaultExportOptions } from "../../../lib/wordpress-transfer/options";
import { codeExportOptions, CODE_EXCLUDES } from "../../../../plugin/worker/lib/code-publish.js";
import DatabasePanel from "../wordpressTransfer/DatabasePanel";
import ReplacePanel from "../wordpressTransfer/ReplacePanel";
import PluginRunCard from "./PluginRunCard";
import PluginSiteRuns from "./PluginSiteRuns";
import ThemeOverrideWarnings from "./ThemeOverrideWarnings";
import { abandonedPush, activeRunsOf, findOneClickPush, oneClickStages, type OneClickRuns, type PushStage } from "./oneClickRuns";
import { ENGINE_ACTIONS, engineErrorMessage, isBusyError, isTerminalStatus, isWorkerStartWait, newHexId, progressView, runInput, runsOfSite, SITE_RUN_ACTIONS } from "./runState";

export type PushMode = "code" | "everything";
type Mode = PushMode;
const HIDDEN_PLUGINS = new Set(["zoer-connect"]);
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function Checklist({ label, items, selected, onChange, empty }: { label: string; items: { slug: string; name: string; detail: string }[]; selected: string[]; onChange: (next: string[]) => void; empty: string }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const visible = needle ? items.filter(item => `${item.name} ${item.slug}`.toLowerCase().includes(needle)) : items;
  const all = items.length > 0 && items.every(item => selected.includes(item.slug));
  return <fieldset className="min-w-0 space-y-2">
    <legend className="flex w-full items-center justify-between gap-2 text-sm font-medium"><span>{label}</span>
      <span className="flex items-center gap-2 text-xs font-normal text-text-secondary">{selected.length} selected{items.length > 1 && <button type="button" className="underline" onClick={() => onChange(all ? [] : items.map(item => item.slug))}>{all ? "None" : "All"}</button>}</span></legend>
    {items.length > 8 && <input aria-label={`Filter ${label.toLowerCase()}`} className={controlClass("compact")} placeholder={`Filter ${label.toLowerCase()}`} value={filter} onChange={event => setFilter(event.target.value)} />}
    <div className="max-h-56 min-w-0 overflow-y-auto rounded-md border border-border-muted">
      {visible.map(item => <label key={item.slug} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 border-b border-border-muted px-3 py-1.5 text-sm last:border-b-0 sm:min-h-9">
        <input type="checkbox" className={checkboxClass} checked={selected.includes(item.slug)} onChange={event => onChange(event.target.checked ? [...selected, item.slug] : selected.filter(slug => slug !== item.slug))} />
        <span className="min-w-0 flex-1 truncate">{item.name}</span><span className="shrink-0 text-xs text-text-secondary">{item.detail}</span>
      </label>)}
      {!visible.length && <p className="p-3 text-xs text-text-secondary">{items.length ? "No matches." : empty}</p>}
    </div>
  </fieldset>;
}

/** Export options of a push: the whole site (Everything) or the chosen themes and plugins (Code only). */
export function pushExportOptions(mode: Mode, themes: string[] = [], plugins: string[] = [], excludes = "") {
  const raw = exportOptionsForAction("push", defaultExportOptions("push"));
  const custom = [...new Set([...CODE_EXCLUDES, ...excludes.split("\n").map(line => line.trim()).filter(Boolean)])];
  if (mode === "everything") return applyExportCapabilities({ ...raw, excludes: custom }, undefined, true).options;
  const selection = { ...raw, resources: { ...raw.resources, themes: themes.length > 0, plugins: plugins.length > 0 }, themes: { mode: "selected" as const, items: themes }, plugins: { mode: "selected" as const, items: plugins }, excludes: custom };
  return applyExportCapabilities(codeExportOptions(selection), undefined, true).options;
}

/** Import options of a push, staged with review (which a one-press push approves itself) and gated by the live site's plugin. */
export function pushImportOptions(mode: Mode, importOptions: ImportOptions, caps: ZoerConnectConnection["status"]["capabilities"]) {
  const requested = mode === "code" ? { ...importOptions, review: true, fence: "activation" as const, keepActivePlugins: true, keepActiveTheme: true, createTables: false, replaceGuids: false, replacements: { automatic: false, variants: false, paths: false, custom: [] } } : { ...importOptions, review: true };
  return applyImportCapabilities(requested, caps).options;
}

/**
 * Requests the approved push of the local export `pullId` (started now, or already running) and
 * starts its comparison with the live site. The push waits for both, sends what differs and
 * finishes by itself unless `reviewFirst`. Zoer asks for approval as soon as this is called.
 */
export async function requestOneClickPush({ source, destinationId, connection, pullId, mode, importOptions, reviewFirst = false, dryRun = false }: {
  source: WordPressManagedSite; destinationId: string; connection: ZoerConnectConnection; pullId: string; mode: Mode; importOptions: ImportOptions; reviewFirst?: boolean; dryRun?: boolean;
}) {
  const caps = connection.status.capabilities;
  const previewId = caps?.selectivePush === true ? newHexId() : null;
  const push = await startEngineAction(ENGINE_ACTIONS.push, {
    siteId: destinationId, exportPullId: pullId, sourceSiteId: source.id, importId: newHexId(), confirmTarget: connection.url, importOptions: pushImportOptions(mode, importOptions, caps),
    ...(previewId ? { previewId, autoSelect: { database: mode === "everything" } } : {}), ...(mode === "code" ? { codeOnly: true } : {}),
    finishAutomatically: !reviewFirst,
    ...(connection.status.migrationMode === "shared-replacement" ? { replacementAccepted: true } : { wordpressOnlyWriters: true }), ...(dryRun ? { dryRun: true } : {}),
  }, { approval: true });
  try {
    const preview = previewId ? await startEngineAction(ENGINE_ACTIONS.preview, { siteId: destinationId, previewId, exportPullId: pullId }) : null;
    return { push, preview };
  } catch (caught) {
    // A push whose comparison could not start would only wait: withdraw it.
    await cancelRun(push).catch(() => undefined);
    throw caught;
  }
}

/** Starts exporting a local site for a push; returns the pull ID the push waits for. */
export async function startPushExport(source: WordPressManagedSite, exportOptions: ReturnType<typeof pushExportOptions>) {
  const pullId = newHexId();
  const runId = await startEngineAction(ENGINE_ACTIONS.localExport, { siteId: source.id, pullId, exportOptions, portableUrls: true });
  return { pullId, runId };
}

/**
 * Push to live as one form: what to push, then one press. The export, the comparison with the
 * live site and the push start together on the Zoer server and wait for each other; Zoer asks
 * for approval once, and the push sends only what differs and finishes by itself (unless the
 * user asked to review first). `onStarted` receives the push's run ID.
 */
export function PushForm({ source, sourceBusy = false, onStartSource, onStarted, destinationId, connection, destination }: {
  source: WordPressManagedSite; /** Another transfer holds the local site (the dialog shows it). */ sourceBusy?: boolean; onStartSource?: () => void;
  onStarted: (runs: { push: string; export: string; preview: string | null }) => void;
  destinationId: string; connection: ZoerConnectConnection; destination: WordPressDiagnostics | null | undefined;
}) {
  const client = useQueryClient();
  const caps = connection.status.capabilities;
  const target = connection.url;
  const canCompare = caps?.selectivePush === true;
  const codeSupported = canCompare && caps?.reviewPause === true && caps?.lateFence === true;
  const running = source.status === "running";

  const [mode, setMode] = useState<Mode>(codeSupported ? "code" : "everything");
  const [themes, setThemes] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<string[]>([]);
  // Extra patterns; CODE_EXCLUDES always apply (a code export adds them back regardless).
  const [excludes, setExcludes] = useState("");
  // Everything replaces the database, so tables the live site lacks (a new site has none of the
  // source's plugin tables) are created; Code only never sends the database.
  const [importOptions, setImportOptions] = useState(() => ({ ...defaultImportOptions(), createTables: caps?.createTables === true }));
  const [reviewFirst, setReviewFirst] = useState(false);
  const [busy, setBusy] = useState<"push" | "test" | null>(null);
  const [error, setError] = useState("");

  const inventory = useWordPressDiagnostics(source.id, { local: true, enabled: running && !sourceBusy });
  // The bridge refuses the read while a transfer the run list does not show holds the site: retry.
  const inventoryBusy = !!inventory.error && isBusyError(inventory.error instanceof Error ? inventory.error.message : String(inventory.error));
  const waiting = sourceBusy || inventoryBusy;
  const { refetch: refetchInventory } = inventory;
  useEffect(() => {
    if (!running || sourceBusy || !inventoryBusy) return;
    const timer = setInterval(() => void refetchInventory(), 5_000);
    return () => clearInterval(timer);
  }, [running, sourceBusy, inventoryBusy, refetchInventory]);
  const themeItems = (inventory.data?.themes ?? []).map(t => ({ slug: t.slug, name: t.name || t.slug, detail: [t.active ? "active" : "", t.version ?? ""].filter(Boolean).join(" · ") }));
  const pluginItems = (inventory.data?.plugins ?? []).filter(p => !HIDDEN_PLUGINS.has(p.slug)).map(p => ({ slug: p.slug, name: p.name || p.slug, detail: [p.active ? "active" : "", p.version ?? ""].filter(Boolean).join(" · ") }));

  const exportOptions = useMemo(() => pushExportOptions(mode, themes, plugins, excludes), [mode, themes, plugins, excludes]);
  const chosen = themes.length + plugins.length;
  const blocker = !running ? `Start ${source.name} to push it.`
    : waiting ? (sourceBusy ? `Waiting for the transfer on ${source.name} to finish.` : `${source.name} is busy with another transfer. Trying again every few seconds.`)
    : mode === "code" && !inventory.data ? null
    : mode === "code" && !chosen ? "Choose at least one theme or plugin."
    : exportOptionsErrors(exportOptions)[0] ?? null;
  const extraExcludes = excludes.split("\n").filter(line => line.trim()).length;
  const gated = pushImportOptions(mode, importOptions, caps);

  async function start(dryRun: boolean) {
    setBusy(dryRun ? "test" : "push"); setError("");
    let started: { pullId: string; runId: string } | null = null;
    try {
      // The export starts first (no approval); requesting the push then has Zoer ask right away,
      // and the push waits for the export and the comparison.
      started = await startPushExport(source, exportOptions);
      const runs = await requestOneClickPush({ source, destinationId, connection, pullId: started.pullId, mode, importOptions, reviewFirst, dryRun });
      onStarted({ push: runs.push, export: started.runId, preview: runs.preview });
    } catch (caught) {
      // An export without its push is work for nothing: stop it.
      if (started) await cancelRun(started.runId).catch(() => undefined);
      setError(engineErrorMessage(caught, "The push could not start."));
    } finally {
      setBusy(null);
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    }
  }

  const label = mode === "code" ? (chosen ? `Push ${plural(chosen, "item")} to live` : "Push to live") : "Push everything to live";
  return <div className="min-w-0 space-y-4">
    <fieldset className="grid min-w-0 gap-2 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">What to push</legend>
      {([["code", "Code only", "Themes and plugins you choose. Live content stays."], ["everything", "Everything", "Database, themes, plugins and media. Live accounts stay."]] as const).map(([value, title, detail]) =>
        <label key={value} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${mode === value ? "border-accent bg-surface-hover" : "border-border-default hover:bg-surface-hover"} ${value === "code" && !codeSupported ? "opacity-60" : ""}`}>
          <input type="radio" className={`${radioClass} mt-0.5`} name={`push-mode-${destinationId}`} checked={mode === value} disabled={value === "code" && !codeSupported} onChange={() => setMode(value)} />
          <span className="flex min-w-0 flex-col gap-0.5"><span className="font-medium">{title}</span><span className="text-[12px] leading-4 text-text-muted">{value === "code" && !codeSupported ? "Needs a newer Zoer Connect on the live site." : detail}</span></span>
        </label>)}
    </fieldset>

    {mode === "code" && running && !waiting && (inventory.isLoading ? <p role="status" className="text-sm text-text-secondary"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Reading themes and plugins…</p>
      : inventory.error ? <div role="alert" className="space-y-2 text-sm text-status-error"><p>Could not read the themes and plugins: {engineErrorMessage(inventory.error)}</p><Btn size="sm" onClick={() => void inventory.refetch()}>Try again</Btn></div>
      : <><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Checklist label="Themes" items={themeItems} selected={themes} onChange={setThemes} empty="No themes found." /><Checklist label="Plugins" items={pluginItems} selected={plugins} onChange={setPlugins} empty="No plugins found." /></div>
        {themes.length > 0 && <ThemeOverrideWarnings themes={themes} sourceId={source.id} sourceLocal={["ddev", "kubernetes"].includes(source.provider)} sourceName={source.name} destinationId={destinationId} destinationHost={host(target)} capabilities={caps} />}</>)}
    {mode === "everything" && <p className="flex items-start gap-1.5 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Posts, orders, comments and form entries added on the live site since your copy are replaced. WordPress core and must-use plugins are not pushed.</span></p>}

    <details className="min-w-0 rounded-md border border-border-muted px-3 text-sm"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center gap-2 text-text-secondary">Options<span className="text-xs">{[canCompare ? "only changed files" : "every file", reviewFirst ? "review before going live" : "finishes by itself", extraExcludes ? `${extraExcludes} extra exclusions` : ""].filter(Boolean).join(" · ")}</span></summary>
      <div className="min-w-0 space-y-3 pb-3">
        <label className="flex min-h-11 items-start gap-2"><input type="checkbox" className={`${checkboxClass} mt-1`} checked={reviewFirst} onChange={event => setReviewFirst(event.target.checked)} />
          <span><span className="block">Stop before going live so I can review</span><span className="block text-xs text-text-secondary">{gated.review ? `The changes wait staged on ${host(target)} until you approve them, then you Finish.` : `${host(target)} stays paused for visitors after the import until you Finish.`}</span></span></label>
        <label className="block"><span className={fieldLabelClass}>Also leave out (one pattern per line, such as **/*.log)</span><textarea className={textareaClass("compact", "w-full font-mono")} rows={3} value={excludes} onChange={event => setExcludes(event.target.value)} spellCheck={false} /></label>
        <p className="text-xs text-text-secondary">Always left out: <span className="break-words font-mono">{CODE_EXCLUDES.join("  ")}</span></p>
        {mode === "everything" && <div className="min-w-0 space-y-3"><DatabasePanel importOptions={importOptions} onImport={setImportOptions} destinationCaps={caps} /><ReplacePanel options={importOptions} onChange={setImportOptions} caps={caps} sourceUrl={source.managedUrl || source.url || null} destinationUrl={target} destinationPath={destination?.wordpress?.abspath} /></div>}
      </div>
    </details>

    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Btn variant="primary" disabled={!!busy || !!blocker || (mode === "code" && !inventory.data)} loading={busy === "push"} onClick={() => void start(false)}>{label}</Btn>
        <Btn variant="secondary" disabled={!!busy || !!blocker || (mode === "code" && !inventory.data)} loading={busy === "test"} onClick={() => void start(true)}>Test run</Btn>
        {!running && onStartSource && <Btn variant="ghost" icon={<Play className="h-3.5 w-3.5" />} onClick={onStartSource}>Start {source.name}</Btn>}
      </div>
      {blocker && <p role="status" className={`text-xs ${waiting || !running ? "text-status-warning" : "text-text-secondary"}`}>{blocker}</p>}
      {!blocker && <p className="text-xs text-text-secondary">Zoer asks you to approve once; its approval names {host(target)} and is the only confirmation. Export, comparison{canCompare ? " (only changed files are sent)" : ""} and upload then run on the Zoer server, and {reviewFirst ? "you approve the staged changes before the live site switches" : "the live site switches over when the upload is done"}. Roll back stays available.</p>}
      {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    </div>
  </div>;
}

function StageIcon({ state }: { state: PushStage["state"] }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />;
  if (state === "active") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />;
  if (state === "waiting") return <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />;
  if (state === "failed") return <XCircle className="h-4 w-4 shrink-0 text-status-error" aria-hidden="true" />;
  if (state === "skipped") return <MinusCircle className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />;
  return <Circle className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />;
}
const STATE_WORDS: Record<PushStage["state"], string> = { done: "done", active: "in progress", waiting: "needs you", pending: "to come", failed: "stopped", skipped: "skipped" };

/**
 * The progress of a one-click push: its five stages (approve, export, compare, upload, update the
 * live site), then the push's own card for the result, the public check, Roll back and Clean up.
 */
export function PushProgress({ runs, destinationHost, onAgain }: { runs: OneClickRuns; destinationHost: string; /** Back to the form for another push. */ onAgain?: () => void }) {
  const client = useQueryClient();
  const detail = useEngineRun(runs.push.runId);
  const push = { status: detail.data?.status ?? runs.push.status, resumable: detail.data?.resumable ?? runs.push.resumable, error: detail.data?.error ?? runs.push.error, output: detail.data?.output };
  const input = runInput(runs.push);
  const stages = oneClickStages({ push, input, exportRun: runs.exportRun, previewRun: runs.previewRun, host: destinationHost });
  const ended = isTerminalStatus(push.status);
  const needsCard = ended || push.status === "waiting_for_approval" || push.resumable?.state === "needs-user" || (!!push.resumable?.lastError && !isWorkerStartWait(push.resumable.lastError.message));
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");

  // An export or comparison that ended badly leaves the push waiting: withdraw it, once.
  const withdrawn = useRef(false);
  const abandoned = abandonedPush({ ...runs, push: { ...runs.push, status: push.status } });
  useEffect(() => {
    if (!abandoned || withdrawn.current) return;
    withdrawn.current = true;
    void cancelRun(runs.push.runId).catch(() => undefined).finally(() => void client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] }));
  }, [abandoned, runs.push.runId, client]);

  // A declined approval (or a push that failed) leaves its export and comparison working for nothing: stop them, once.
  const stopped = useRef(false);
  const leftover = ended && push.status !== "succeeded" ? [runs.exportRun, runs.previewRun].filter(run => !!run && !isTerminalStatus(run.status)) : [];
  useEffect(() => {
    if (!leftover.length || stopped.current) return;
    stopped.current = true;
    void Promise.all(leftover.map(run => cancelRun(run!.runId).catch(() => undefined))).finally(() => void client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] }));
  }, [leftover.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cancelAll() {
    setCancelling(true); setError("");
    try { for (const run of activeRunsOf({ ...runs, push: { ...runs.push, status: push.status } })) await cancelRun(run.runId); }
    catch (caught) { setError(engineErrorMessage(caught, "Could not cancel the push.")); }
    finally { setCancelling(false); await client.invalidateQueries({ queryKey: engineKeys.all() }); }
  }

  return <section aria-label="Push progress" className="min-w-0 space-y-3">
    <ol className="min-w-0 space-y-1.5 rounded-lg border border-border-default p-3" aria-label="Push stages">
      {stages.map(stage => {
        const view = stage.state === "active" ? progressView(stage.progress) : null;
        return <li key={stage.id} aria-current={stage.state === "active" || stage.state === "waiting" ? "step" : undefined} className="min-w-0">
          <div className={`flex min-h-7 items-center gap-2 text-sm ${stage.state === "pending" || stage.state === "skipped" ? "text-text-muted" : "text-text-primary"} ${stage.state === "active" || stage.state === "waiting" ? "font-medium" : ""}`}>
            <StageIcon state={stage.state} /><span className="min-w-0 flex-1 break-words">{stage.label}</span><span className="sr-only"> ({STATE_WORDS[stage.state]})</span>
            {view?.percent !== null && view?.percent !== undefined && <span className="shrink-0 text-xs tabular-nums text-text-secondary">{view.percent}%</span>}
          </div>
          {view && <div className="ml-6 mt-1 space-y-1">
            {view.percent !== null && <progress aria-label={`${stage.label} progress`} className="h-1.5 w-full accent-indigo-500" value={view.percent} max={100} />}
            {(view.detail || view.message) && <p className="break-words text-xs tabular-nums text-text-secondary">{[view.detail, view.message].filter(Boolean).join(" · ")}</p>}
          </div>}
          {stage.detail && <p className={`ml-6 break-words text-xs ${stage.state === "failed" ? "text-status-error" : "text-text-secondary"}`}>{stage.detail}</p>}
        </li>;
      })}
    </ol>
    {needsCard && <PluginRunCard recent={{ ...runs.push, status: push.status }} siteId={typeof input.siteId === "string" ? input.siteId : undefined} title={input.dryRun === true ? "Test run" : "Push"} kind="push" />}
    <div className="flex flex-wrap items-center gap-2">
      {!ended && <Btn size="sm" variant="ghost" loading={cancelling} onClick={() => void cancelAll()}>Cancel push</Btn>}
      {ended && onAgain && <Btn size="sm" onClick={onAgain}>{push.status === "succeeded" && input.dryRun === true ? "Back to the push" : "Start another push"}</Btn>}
      {!ended && <p className="text-xs text-text-secondary">Runs on the Zoer server. You can close this window and come back.</p>}
    </div>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
  </section>;
}

/** A finished push stays on screen this long after it ends, so coming back shows how it went. */
const RECENT_RESULT_MS = 30 * 60_000;
const PUSH_RUN_ACTIONS = [...SITE_RUN_ACTIONS, ENGINE_ACTIONS.preview] as const;

/**
 * Push from `source` to one live site: the push under way (or just finished) with its progress,
 * otherwise the form, or what holds either site. Shared by Push to live and the live site's
 * Transfers, so a push looks the same wherever it was started. Without a ready `connection` the
 * form is replaced by `fallback` (a running push is still followed: it may pause the live site).
 */
export function OneClickPushPanel({ source, destinationId, destinationHost, connection, destination, onStartSource, fallback = null }: {
  source: WordPressManagedSite; destinationId: string; destinationHost: string; connection: ZoerConnectConnection | null; destination: WordPressDiagnostics | null | undefined;
  onStartSource?: () => void; fallback?: React.ReactNode;
}) {
  const runs = useRecentRuns(PUSH_RUN_ACTIONS);
  const [startedHere, setStartedHere] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const oneClick = findOneClickPush(runs.data ?? [], source.id, destinationId);
  const ended = !!oneClick && isTerminalStatus(oneClick.push.status);
  const endedAt = oneClick ? Date.parse(oneClick.push.finishedAt ?? oneClick.push.createdAt) : NaN;
  const showProgress = !!oneClick && oneClick.push.runId !== dismissed && (!ended || oneClick.push.runId === startedHere || Date.now() - endedAt < RECENT_RESULT_MS);
  // Until the started push shows in the recent runs, say so instead of offering the form again.
  const starting = !!startedHere && oneClick?.push.runId !== startedHere;
  const own = new Set(oneClick ? [oneClick.push.runId, oneClick.exportRun?.runId, oneClick.previewRun?.runId].filter((id): id is string => !!id) : []);
  // Transfers this push did not start: one push or pull per site at a time.
  const busy = runsOfSite(runs.data ?? [], destinationId).some(run => !own.has(run.runId) && !isTerminalStatus(run.status));
  // A transfer on the local site (such as a refresh from live) holds it: its inventory and export wait.
  const sourceBusy = runsOfSite(runs.data ?? [], source.id).some(run => !own.has(run.runId) && run.actionId !== ENGINE_ACTIONS.localExport && !isTerminalStatus(run.status));

  if (showProgress && oneClick) return <PushProgress key={oneClick.push.runId} runs={oneClick} destinationHost={destinationHost} onAgain={() => setDismissed(oneClick.push.runId)} />;
  if (starting) return <p role="status" className="text-sm text-text-secondary"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Starting the push…</p>;
  if (!connection) return <>{fallback}</>;
  return <div className="min-w-0 space-y-3">
    {busy && <section aria-label={`Running on ${destinationHost}`} className="min-w-0 space-y-2">
      <p role="status" className="text-sm text-status-warning">Another transfer to {destinationHost} is running. Push when it has finished.</p>
      <PluginSiteRuns siteId={destinationId} activeOnly heading={false} />
    </section>}
    {sourceBusy && <section aria-label={`Running on ${source.name}`} className="min-w-0 space-y-2">
      <p role="status" className="text-sm text-status-warning">{source.name} has a transfer running. Push when it has finished.</p>
      <PluginSiteRuns siteId={source.id} activeOnly heading={false} />
    </section>}
    {!busy && <PushForm key={`${source.id}:${destinationId}`} source={source} sourceBusy={sourceBusy} onStarted={ids => { setStartedHere(ids.push); setDismissed(null); }} onStartSource={onStartSource} destinationId={destinationId} connection={connection} destination={destination} />}
  </div>;
}
