import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Play } from "lucide-react";
import { Btn, checkboxClass, controlClass, fieldLabelClass, radioClass, textareaClass } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../../lib/api";
import type { WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { engineKeys, listCatalog, startEngineAction, useCatalogKind, useEngineRun, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { useWordPressDiagnostics } from "../../../lib/queries/wordpress-transfer";
import { applyExportCapabilities, applyImportCapabilities, defaultImportOptions, exportOptionsErrors, exportOptionsForAction, defaultExportOptions, pullContents } from "../../../lib/wordpress-transfer/options";
import { codeExportIssue, codeExportOptions, codePathReason, CODE_EXCLUDES } from "../../../../plugin/worker/lib/code-publish.js";
import { formatTransferBytes } from "../wordpressPullProgress";
import DatabasePanel from "../wordpressTransfer/DatabasePanel";
import ReplacePanel from "../wordpressTransfer/ReplacePanel";
import PluginRunCard from "./PluginRunCard";
import ThemeOverrideWarnings from "./ThemeOverrideWarnings";
import PreviewSelection from "./PreviewSelection";
import { defaultSelection, MAX_SELECTED_PATHS, parsePullRecord, previewFiles, pushSources, type PullRecord } from "./records";
import { ENGINE_ACTIONS, engineErrorMessage, isBusyError, isTerminalStatus, newHexId, runInput } from "./runState";

type Mode = "code" | "everything";
type StepId = "what" | "export" | "compare" | "push";
const STEPS: { id: StepId; title: string }[] = [
  { id: "what", title: "Choose what to push" },
  { id: "export", title: "Export the local site" },
  { id: "compare", title: "Compare with the live site" },
  { id: "push", title: "Push" },
];
const HIDDEN_PLUGINS = new Set(["zoer-connect"]);
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** Themes and plugins a code export contains, or null for other exports. */
function codeItems(pull: PullRecord) {
  if (codeExportIssue(pull.options)) return null;
  const p = pull.options?.profile ?? {};
  const items = (kind: "themes" | "plugins") => p[kind] && Array.isArray(p[`${kind}Items`]) ? (p[`${kind}Items`] as string[]) : [];
  return { themes: items("themes"), plugins: items("plugins") };
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item));
function exportLabel(pull: PullRecord) {
  const items = codeItems(pull);
  const what = items ? [items.themes.length ? plural(items.themes.length, "theme") : "", items.plugins.length ? plural(items.plugins.length, "plugin") : ""].filter(Boolean).join(", ") : pullContents(pull.options).label;
  return `${new Date(pull.createdAt).toLocaleString()} · ${what} · ${formatTransferBytes(pull.totalBytes)}`;
}

function StepCard({ n, step, current, done, summary, onChange, children }: { n: number; step: { id: StepId; title: string }; current: boolean; done: boolean; summary?: string; onChange?: () => void; children?: React.ReactNode }) {
  return <li aria-current={current ? "step" : undefined} className={`min-w-0 rounded-lg border p-3 ${current ? "border-accent" : "border-border-default"} ${!current && !done ? "opacity-60" : ""}`}>
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${done ? "bg-status-success/15 text-status-success" : current ? "bg-accent text-accent-text" : "border border-border-default text-text-secondary"}`}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>
      <h3 className="min-w-0 flex-1 text-sm font-semibold text-text-heading">{step.title}<span className="sr-only">{done ? " (done)" : current ? " (current step)" : ""}</span></h3>
      {done && !current && onChange && <Btn size="sm" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={onChange}>Change</Btn>}
    </div>
    {done && !current && summary && <p className="mt-1 break-words pl-8 text-xs text-text-secondary">{summary}</p>}
    {current && <div className="mt-3 min-w-0 space-y-3 sm:pl-8">{children}</div>}
  </li>;
}

function Checklist({ label, items, selected, onChange, empty }: { label: string; items: { slug: string; name: string; detail: string }[]; selected: string[]; onChange: (next: string[]) => void; empty: string }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const visible = needle ? items.filter(item => `${item.name} ${item.slug}`.toLowerCase().includes(needle)) : items;
  return <fieldset className="min-w-0 space-y-2">
    <legend className="flex w-full items-center justify-between gap-2 text-sm font-medium"><span>{label}</span><span className="text-xs font-normal text-text-secondary">{selected.length} selected</span></legend>
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

/**
 * Push to live as four steps, one open at a time: what to push (code only: chosen themes and
 * plugins; or everything), export the local site (or reuse a matching earlier export), compare
 * with the live site (starts by itself), push (a test first, or the real push after one
 * confirmation). The push's card then handles Zoer's approval, review, Finish and the public check.
 */
export default function GuidedPush({ source, sourceBusy = false, onStartSource, onRun, destinationId, connection, destination }: {
  source: WordPressManagedSite; /** Another transfer holds the local site (the dialog shows it). */ sourceBusy?: boolean; onStartSource?: () => void;
  /** A push or test this flow started, so the dialog does not call it "another transfer". */ onRun?: (runId: string) => void;
  destinationId: string; connection: ZoerConnectConnection; destination: WordPressDiagnostics | null | undefined;
}) {
  const client = useQueryClient();
  const caps = connection.status.capabilities;
  const target = connection.url;
  const shared = connection.status.migrationMode === "shared-replacement";
  const canCompare = caps?.selectivePush === true;
  const codeSupported = canCompare && caps?.reviewPause === true && caps?.lateFence === true;
  const running = source.status === "running";

  const [step, setStep] = useState<StepId>("what");
  const [mode, setMode] = useState<Mode>(codeSupported ? "code" : "everything");
  const [themes, setThemes] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<string[]>([]);
  // Extra patterns; CODE_EXCLUDES always apply (a code export adds them back regardless).
  const [excludes, setExcludes] = useState("");
  const [importOptions, setImportOptions] = useState(defaultImportOptions);
  const [setId, setSetId] = useState<string | null>(null);
  const [exportRun, setExportRun] = useState<{ runId: string; pullId: string } | null>(null);
  const [preview, setPreview] = useState<{ previewId: string; runId: string; setId: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pushRun, setPushRun] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const inventory = useWordPressDiagnostics(source.id, { local: true, enabled: running && !sourceBusy });
  // The bridge refuses the read while a transfer the run list does not show holds the site: retry.
  // (Once sourceBusy clears, re-enabling the query reads it again.)
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

  const records = useCatalogKind("pull");
  const exports = pushSources((records.data ?? []).map(parsePullRecord).filter((pull): pull is PullRecord => !!pull), destinationId).filter(pull => pull.kind === "local-export" && pull.siteId === source.id);
  const compatible = exports.filter(pull => mode === "code" ? (() => { const items = codeItems(pull); return !!items && sameSet(items.themes, themes) && sameSet(items.plugins, plugins); })() : !codeItems(pull) && pullContents(pull.options).database);
  const chosen = exports.find(pull => pull.setId === setId) ?? null;

  const exportOptions = useMemo(() => {
    const raw = exportOptionsForAction("push", defaultExportOptions("push"));
    const custom = [...new Set([...CODE_EXCLUDES, ...excludes.split("\n").map(line => line.trim()).filter(Boolean)])];
    if (mode === "everything") return applyExportCapabilities({ ...raw, excludes: custom }, undefined, true).options;
    const selection = { ...raw, resources: { ...raw.resources, themes: themes.length > 0, plugins: plugins.length > 0 }, themes: { mode: "selected" as const, items: themes }, plugins: { mode: "selected" as const, items: plugins }, excludes: custom };
    return applyExportCapabilities(codeExportOptions(selection), undefined, true).options;
  }, [mode, themes, plugins, excludes]);
  const whatError = mode === "code" && inventory.data && !themes.length && !plugins.length ? "Choose at least one theme or plugin." : null;
  const exportErrors = exportOptionsErrors(exportOptions);
  const extraExcludes = excludes.split("\n").filter(line => line.trim()).length;
  const nameOf = (slug: string) => [...themeItems, ...pluginItems].find(item => item.slug === slug)?.name ?? slug;
  const chosenNames = [...themes, ...plugins].map(nameOf);
  const chosenText = chosenNames.length <= 3 ? chosenNames.join(", ") : `${chosenNames.slice(0, 2).join(", ")} and ${chosenNames.length - 2} more`;
  const whatSummary = mode === "code" ? `Code only · ${chosenText}` : "Everything · database, themes, plugins and media; live accounts kept";

  // Export run → its record appears → it becomes the source and comparison starts.
  const exportStatus = useEngineRun(exportRun?.runId);
  useEffect(() => {
    if (!exportRun || exportStatus.data?.status !== "succeeded") return;
    void client.invalidateQueries({ queryKey: engineKeys.catalog("pull") });
    const made = exports.find(pull => pull.pullId === exportRun.pullId);
    if (made?.setId) { setSetId(made.setId); setExportRun(null); goCompare(made.setId); }
  }, [exportStatus.data?.status, exports.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportNow() {
    setBusy("export"); setError("");
    try {
      // The export frees earlier verified stagings itself (the bridge keeps two per site).
      const pullId = newHexId();
      const runId = await startEngineAction(ENGINE_ACTIONS.localExport, { siteId: source.id, pullId, exportOptions });
      setExportRun({ runId, pullId });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The export could not start.")); }
    finally { setBusy(null); }
  }

  // Comparison (read-only on the live site) starts as soon as a source is chosen.
  const previewRun = useEngineRun<{ complete?: boolean }>(preview?.runId);
  const previewDone = previewRun.data?.status === "succeeded";
  const pages = useQuery({ queryKey: engineKeys.preview(preview?.previewId ?? ""), enabled: !!preview && previewDone, staleTime: Infinity, retry: false,
    queryFn: async () => previewFiles((await listCatalog("preview-page", { after: `preview-page:${preview!.previewId}:`, prefix: `preview-page:${preview!.previewId}:`, max: 100_000 })).records, preview!.previewId) });
  const profile = chosen?.options?.profile;
  const files = pages.data?.map(file => { const reason = mode === "code" ? codePathReason(file.path, profile) : null; return reason ? { ...file, state: "blocked" as const, reason } : file; });
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!preview || !files || seeded.current === preview.previewId) return;
    seeded.current = preview.previewId;
    // "Everything" was chosen and confirmed: the database goes with the files that differ.
    setSelected(new Set(defaultSelection(files, { database: mode === "everything" })));
  }, [preview, files]);

  async function goCompare(nextSetId = setId) {
    setStep("compare"); setError(""); setSelected(new Set()); seeded.current = null;
    if (!nextSetId || !canCompare) { setPreview(null); return; }
    setBusy("compare");
    try {
      const previewId = newHexId();
      const runId = await startEngineAction(ENGINE_ACTIONS.preview, { siteId: destinationId, setId: nextSetId, previewId });
      setPreview({ previewId, runId, setId: nextSetId });
    } catch (caught) { setError(engineErrorMessage(caught, "The comparison could not start.")); }
    finally { setBusy(null); }
  }

  const comparing = canCompare && (mode === "code" || !!preview);
  const selectedDatabase = !!files?.some(file => file.state === "database" && selected.has(file.path));
  const selectedFiles = files ? files.filter(file => file.state !== "database" && selected.has(file.path)).length : selected.size;
  const selectionText = `${selectedDatabase ? `The database and ${plural(selectedFiles, "file")}` : plural(selectedFiles, "file")}`;
  const compareReady = !comparing || (!!preview && preview.setId === setId && previewDone && !!files && selected.size > 0 && selected.size <= MAX_SELECTED_PATHS);
  const requested = mode === "code" ? { ...importOptions, review: true, fence: "activation" as const, keepActivePlugins: true, keepActiveTheme: true, createTables: false, replaceGuids: false, replacements: { automatic: false, variants: false, paths: false, custom: [] } } : { ...importOptions, review: true };
  const gated = applyImportCapabilities(requested, caps).options;
  const realConfirmed = confirmed && (mode === "code" || host(confirmText.trim()).toLowerCase() === host(target).toLowerCase());

  async function push(dryRun: boolean) {
    if (!chosen?.setId) return;
    setBusy(dryRun ? "test" : "push"); setError("");
    try {
      const runId = await startEngineAction(ENGINE_ACTIONS.push, {
        siteId: destinationId, setId: chosen.setId, importId: newHexId(), confirmTarget: target, importOptions: gated, sourceSiteId: chosen.siteId,
        ...(mode === "code" ? { codeOnly: true } : {}), ...(comparing && preview ? { previewId: preview.previewId, selectedPaths: [...selected] } : {}),
        ...(shared ? { replacementAccepted: true } : { wordpressOnlyWriters: true }), ...(dryRun ? { dryRun: true } : {}),
      }, { approval: true });
      setPushRun(runId); onRun?.(runId); setConfirmed(false); setConfirmText("");
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The push could not be requested.")); }
    finally { setBusy(null); }
  }
  const runs = useRecentRuns([ENGINE_ACTIONS.push]);
  const pushRecent = pushRun ? (runs.data ?? []).find(run => run.runId === pushRun) : null;
  const pushActive = !!pushRecent && !isTerminalStatus(pushRecent.status);

  const index = STEPS.findIndex(s => s.id === step);
  const done = (id: StepId) => STEPS.findIndex(s => s.id === id) < index;
  const exportFailed = exportStatus.data && isTerminalStatus(exportStatus.data.status) && exportStatus.data.status !== "succeeded";

  return <ol className="min-w-0 space-y-2" aria-label="Push steps">
    <StepCard n={1} step={STEPS[0]} current={step === "what"} done={done("what")} summary={whatSummary} onChange={() => setStep("what")}>
      <fieldset className="grid min-w-0 gap-2 sm:grid-cols-2">
        <legend className="sr-only">What to push</legend>
        {([["code", "Code only", "Chosen themes and plugins. Live posts, pages, media and users stay as they are."], ["everything", "Everything", "The local database, themes, plugins and media replace the live ones; files the live site already has are skipped. Live user accounts and logins are kept."]] as const).map(([value, title, detail]) =>
          <label key={value} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${mode === value ? "border-accent bg-surface-hover" : "border-border-default hover:bg-surface-hover"} ${value === "code" && !codeSupported ? "opacity-60" : ""}`}>
            <input type="radio" className={`${radioClass} mt-0.5`} name={`guided-push-mode-${destinationId}`} checked={mode === value} disabled={value === "code" && !codeSupported} onChange={() => { setMode(value); setSetId(null); }} />
            <span className="flex min-w-0 flex-col gap-0.5"><span className="font-medium">{title}{value === "code" ? " (recommended)" : ""}</span><span className="text-[12px] leading-4 text-text-muted">{value === "code" && !codeSupported ? "Update Zoer Connect on the live site to push code only." : detail}</span></span>
          </label>)}
      </fieldset>
      {mode === "code" && !waiting && (!running
        ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-default p-3"><span className="min-w-0 flex-1 text-sm">Start <strong>{source.name}</strong> to list its themes and plugins.</span>{onStartSource && <Btn size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={onStartSource}>Start site</Btn>}</div>
        : inventory.isLoading ? <p role="status" className="text-sm text-text-secondary">Reading themes and plugins from {source.name}…</p>
          : inventory.error ? <div role="alert" className="space-y-2 text-sm text-status-error"><p>Could not read the themes and plugins on {source.name}: {engineErrorMessage(inventory.error)}</p><Btn size="sm" onClick={() => void inventory.refetch()}>Try again</Btn></div>
            : <><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Checklist label="Themes" items={themeItems} selected={themes} onChange={setThemes} empty="No themes found." /><Checklist label="Plugins" items={pluginItems} selected={plugins} onChange={setPlugins} empty="No plugins found." /></div>
              {themes.length > 0 && <ThemeOverrideWarnings themes={themes} sourceId={source.id} sourceLocal={source.provider === "ddev"} sourceName={source.name} destinationId={destinationId} destinationHost={host(target)} capabilities={caps} />}</>)}
      {waiting && <p role="status" className="text-sm text-status-warning">{sourceBusy ? `Waiting for the transfer on ${source.name} to finish.` : `${source.name} is busy with another transfer. Trying again every few seconds.`}</p>}
      {mode === "everything" && <p className="text-xs text-status-warning">Changes made on the live site since your local copy (new posts, orders, comments, form entries) will be replaced. WordPress core and must-use plugins are not pushed.</p>}
      <details className="text-sm"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Advanced: files to leave out{extraExcludes ? ` (${extraExcludes} added)` : ""}</summary>
        <p className="mt-2 text-xs text-text-secondary">Always left out: <span className="break-words font-mono">{CODE_EXCLUDES.join("  ")}</span></p>
        <label className="mt-2 block"><span className={fieldLabelClass}>Also leave out (one pattern per line, such as **/*.log)</span><textarea className={textareaClass("compact", "w-full font-mono")} rows={3} value={excludes} onChange={event => setExcludes(event.target.value)} spellCheck={false} /></label>
      </details>
      <div className="flex flex-wrap items-center gap-3"><Btn variant="primary" disabled={waiting || !!whatError || exportErrors.length > 0 || (mode === "code" && (!running || !inventory.data))} onClick={() => { setSetId(null); setStep("export"); }}>Continue</Btn>{!waiting && !(mode === "code" && !inventory.data) && (whatError ?? exportErrors[0]) && <span className="text-xs text-text-secondary">{whatError ?? exportErrors[0]}</span>}</div>
    </StepCard>

    <StepCard n={2} step={STEPS[1]} current={step === "export"} done={done("export")} summary={chosen ? `Export ${exportLabel(chosen)}` : undefined} onChange={() => setStep("export")}>
      <p className="text-sm text-text-secondary">Packs {mode === "code" ? chosenText : "the whole site"} from <strong>{source.name}</strong> into a verified file set on the Zoer server.</p>
      {!exportRun && <Btn variant="primary" disabled={!!busy || !running || sourceBusy} loading={busy === "export"} onClick={() => void exportNow()}>Export now</Btn>}
      {sourceBusy && !exportRun && <p role="status" className="text-xs text-status-warning">Waiting for the transfer on {source.name} to finish.</p>}
      {!running && <p role="status" className="text-xs text-status-warning">Start {source.name} to export it.{onStartSource && <> <button type="button" className="underline" onClick={onStartSource}>Start site</button></>}</p>}
      {exportRun && exportStatus.data && <PluginRunCard recent={{ runId: exportRun.runId, actionId: ENGINE_ACTIONS.localExport, status: exportStatus.data.status, createdAt: exportStatus.data.createdAt ?? new Date().toISOString(), input: { siteId: source.id, pullId: exportRun.pullId } }} title="Export" />}
      {exportFailed && <Btn size="sm" onClick={() => { setExportRun(null); void exportNow(); }}>Try again</Btn>}
      {compatible.length > 0 && !exportRun && <details className="text-sm"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Or use an earlier export ({compatible.length})</summary>
        <ul className="mt-2 space-y-1">{compatible.slice(0, 5).map(pull => <li key={pull.pullId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted px-3 py-2"><span className="min-w-0 break-words text-xs">{exportLabel(pull)}</span><Btn size="sm" onClick={() => { setSetId(pull.setId); void goCompare(pull.setId); }}>Use this export</Btn></li>)}</ul>
      </details>}
    </StepCard>

    <StepCard n={3} step={STEPS[2]} current={step === "compare"} done={done("compare")} summary={comparing ? `${selectionText} selected` : "Everything in the export"} onChange={() => void goCompare()}>
      {!canCompare && <p className="text-sm text-text-secondary">{host(target)} can't compare files with this version of Zoer Connect, so everything in the export is pushed.</p>}
      {canCompare && mode === "everything" && !preview && <p className="text-sm text-text-secondary">Everything in the export will be pushed. <button type="button" className="underline" onClick={() => void goCompare()}>Compare and choose files instead</button></p>}
      {preview && previewRun.data && !previewDone && <PluginRunCard recent={{ runId: preview.runId, actionId: ENGINE_ACTIONS.preview, status: previewRun.data.status, createdAt: previewRun.data.createdAt ?? new Date().toISOString(), input: { siteId: destinationId, previewId: preview.previewId } }} title={`Comparing with ${host(target)}`} />}
      {busy === "compare" && <p role="status" className="text-sm text-text-secondary">Starting the comparison…</p>}
      {previewDone && pages.isLoading && <p role="status" className="text-sm text-text-secondary">Loading the comparison…</p>}
      {pages.error && <p role="alert" className="text-sm text-status-error">Could not load the comparison: {engineErrorMessage(pages.error)}</p>}
      {files && (() => {
        const changed = files.filter(file => file.state === "new" || file.state === "changed").length;
        const unchanged = files.filter(file => file.state === "unchanged").length;
        const counts = (["new", "changed", "unchanged", "blocked"] as const).map(state => [state, files.filter(file => file.state === state).length] as const).filter(([, n]) => n).map(([state, n]) => `${n.toLocaleString()} ${state}`).join(", ");
        const hasDatabase = files.some(file => file.state === "database");
        return <>
          {changed === 0 && !selectedDatabase
            ? <p role="status" className="rounded-md border border-status-success/30 bg-status-success/10 px-3 py-2 text-sm text-status-success">{host(target)} already has these files ({counts}). Nothing to push.</p>
            : <p role="status" className="text-sm">{selectionText} will be pushed <span className="text-text-secondary">({counts})</span>.{unchanged > 0 && <span className="text-text-secondary"> {plural(unchanged, "file")} already identical on {host(target)} {unchanged === 1 ? "is" : "are"} left out.</span>}</p>}
          {mode === "everything" && hasDatabase && !selectedDatabase && <p role="alert" className="text-xs text-status-warning">The database is not selected, so only files are pushed. Select database.sql under Review files to replace the live database.</p>}
          <details className="min-w-0 text-sm"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Review files</summary><div className="mt-2"><PreviewSelection files={files} selected={selected} onChange={setSelected} disabled={!!busy} /></div></details>
          {changed === 0 && !selectedDatabase && <Btn size="sm" onClick={() => setStep("what")}>Choose something else</Btn>}
        </>;
      })()}
      {(!files || selected.size > 0 || !comparing) && <Btn variant="primary" disabled={!compareReady || !!busy} onClick={() => setStep("push")}>Continue</Btn>}
      {mode === "everything" && preview && <button type="button" className="block text-xs text-text-secondary underline" onClick={() => { setPreview(null); setStep("push"); }}>Push every file anyway (skip the comparison)</button>}
    </StepCard>

    <StepCard n={4} step={STEPS[3]} current={step === "push"} done={false}>
      <p className="text-sm">Push {comparing ? selectionText.charAt(0).toLowerCase() + selectionText.slice(1) : "everything in the export"} from <strong>{source.name}</strong> to <strong>{host(target)}</strong>.</p>
      {mode === "everything" && <details className="min-w-0 text-sm"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Database and address options (defaults suit most pushes)</summary>
        <div className="mt-2 min-w-0 space-y-3"><DatabasePanel importOptions={importOptions} onImport={setImportOptions} destinationCaps={caps} /><ReplacePanel options={importOptions} onChange={setImportOptions} caps={caps} sourceUrl={chosen?.source?.url ?? null} destinationUrl={target} sourcePath={chosen?.source?.abspath} destinationPath={destination?.wordpress?.abspath} /></div>
      </details>}
      <p className="text-xs text-text-secondary">Zoer asks you to approve, then stages the changes. The live site only switches when you choose <strong>Finish</strong>, and Roll back stays available.</p>
      {!pushActive && <>
        <div className="space-y-2 rounded-md border border-border-default p-3">
          <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className={`${checkboxClass} mt-1`} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            <span>{mode === "code" ? `Replace the selected themes and plugins on ${host(target)}.` : `Replace ${host(target)} with ${source.name}. Edits made on the live site in the meantime are not merged.`}</span></label>
          {mode === "everything" && <label className="block"><span className={fieldLabelClass}>Type {host(target)} to confirm</span><input aria-label="Confirm live address" className={controlClass("default", "text-base sm:text-[14px]")} placeholder={host(target)} value={confirmText} onChange={event => setConfirmText(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" /></label>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Btn variant="primary" disabled={!!busy || !chosen || !realConfirmed} loading={busy === "push"} onClick={() => void push(false)}>Push to live</Btn>
            <Btn variant="secondary" disabled={!!busy || !chosen} loading={busy === "test"} onClick={() => void push(true)}>Test first (no changes)</Btn>
          </div>
        </div>
      </>}
      {pushRecent && <PluginRunCard recent={pushRecent} siteId={destinationId} title={runInput(pushRecent).dryRun ? "Test push" : "Push"} kind="push" />}
      {pushRecent && pushRecent.status === "succeeded" && runInput(pushRecent).dryRun === true && <p className="text-xs text-text-secondary">The test finished. Push to live when you're ready.</p>}
      {pushRecent && isTerminalStatus(pushRecent.status) && pushRecent.status !== "succeeded" && runInput(pushRecent).dryRun === true && <p className="text-xs text-status-warning">The test did not succeed (above). Nothing on {host(target)} changed; fix the cause and test again before pushing.</p>}
    </StepCard>
    {error && <li role="alert" className="break-words text-sm text-status-error">{error}</li>}
  </ol>;
}
