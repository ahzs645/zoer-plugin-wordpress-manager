import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight } from "lucide-react";
import { Btn, Modal } from "@zoer/plugin-ui/controls";
import { getApiBase, json } from "../../lib/api/_http";

/**
 * Block themes: templates, template parts and styles edited in the Site Editor are saved in the
 * database and win over the theme's files. This lists them next to the repository, saves chosen
 * ones into it (review → apply, undo in Development history) and removes the database copies once
 * the installed theme files render exactly the same (restore in history).
 */
export interface ThemeOverride {
  id: number; type: "template" | "part" | "styles"; slug: string; title: string; modified: string; path: string; contentSha256: string; portableSha256: string;
  repositoryPath: string; repositoryFile: { exists: boolean; sha256: string | null }; siteFile: { exists: boolean; sha256: string | null };
  inRepository: boolean; siteMatchesRepository: boolean; safeToRemove: boolean; warnings: string[];
}
interface Overrides { theme: string; active: boolean; installed: boolean; items: ThemeOverride[]; navigationMenus: number }
interface CaptureReview { id: string; fingerprint: string; unchanged: string[]; changes: { path: string; title: string; kind: string; warnings: string[]; content?: string }[] }

const TYPE_LABEL = { template: "Template", part: "Template part", styles: "Styles" } as const;

export const themeOverridesKey = (base: string) => [getApiBase(), "theme-overrides", base];
export const fetchThemeOverrides = (base: string) => json<Overrides>(`${base}/theme-overrides`);

/** Files of an update that a Site Editor copy on the site shows instead (so the page will not change). */
export function hiddenBySiteEditor(changes: { path: string }[], items: { path: string }[]): string[] {
  const copied = new Set(items.map(item => item.path));
  return changes.map(change => change.path).filter(path => copied.has(path));
}

/** Where one saved copy stands: in the repository, installed on the site, and whether removing it is safe. */
export function overrideState(item: ThemeOverride): { label: string; tone: "ok" | "todo" | "warn" } {
  if (item.safeToRemove) return { label: "Saved in the theme files", tone: "ok" };
  if (item.inRepository) return { label: "In the repository · update the local site", tone: "todo" };
  if (item.repositoryFile.exists) return { label: "Differs from the repository file", tone: "warn" };
  return { label: "Only on this site", tone: "warn" };
}

export type OverrideGroupId = "save" | "update" | "remove";

/** The three steps a saved copy goes through, in order, with what each group's button does. */
export const OVERRIDE_GROUPS: readonly { id: OverrideGroupId; title: string; step: string }[] = [
  { id: "save", title: "Needs saving", step: "Save to the repository" },
  { id: "update", title: "Waiting for a local update", step: "Review local update" },
  { id: "remove", title: "Saved in the theme — safe to remove", step: "Remove saved copies" },
];

export function overrideGroup(item: ThemeOverride): OverrideGroupId {
  if (item.safeToRemove) return "remove";
  return item.inRepository ? "update" : "save";
}

/** Saved copies by step, each group in the list's order. */
export function groupOverrides(items: readonly ThemeOverride[]): Record<OverrideGroupId, ThemeOverride[]> {
  const groups: Record<OverrideGroupId, ThemeOverride[]> = { save: [], update: [], remove: [] };
  for (const item of items) groups[overrideGroup(item)].push(item);
  return groups;
}

/** "3 need saving · 12 waiting for a local update · 1 safe to remove". */
export function overrideSummary(groups: Record<OverrideGroupId, readonly ThemeOverride[]>): string {
  const parts = [
    groups.save.length ? `${groups.save.length} need${groups.save.length === 1 ? "s" : ""} saving` : "",
    groups.update.length ? `${groups.update.length} waiting for a local update` : "",
    groups.remove.length ? `${groups.remove.length} safe to remove` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Rows of a group the person ticked. Selection is opt-in: rows that appear after "Check again"
 * aren't chosen, and ids that disappeared are ignored.
 */
export function chosenItems(group: readonly ThemeOverride[], selected: readonly number[]): ThemeOverride[] {
  return group.filter(item => selected.includes(item.id));
}

/** "Select all": chooses every row of the group, or clears the group when all are chosen. */
export function toggleGroupSelection(group: readonly ThemeOverride[], selected: readonly number[]): number[] {
  const ids = group.map(item => item.id);
  const allChosen = ids.length > 0 && ids.every(id => selected.includes(id));
  return allChosen ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])];
}

function editedAt(item: ThemeOverride) {
  return item.modified ? new Date(`${item.modified.replace(" ", "T")}Z`).toLocaleString() : "unknown";
}

export default function ThemeSiteEditorChanges({ base, theme, siteRunning, locked, onChanged, onReviewLocalUpdate, reviewing = false }: {
  base: string; theme: string; siteRunning: boolean; locked: boolean; onChanged: () => void;
  /** Opens the repository's local update review; absent while it can't run (unsaved edits, site stopped). */
  onReviewLocalUpdate?: () => void;
  reviewing?: boolean;
}) {
  const client = useQueryClient();
  const key = themeOverridesKey(base);
  const query = useQuery({ queryKey: key, queryFn: () => fetchThemeOverrides(base), enabled: siteRunning, retry: false, staleTime: 15_000 });
  // Opt-in: bulk actions only touch rows the person ticked (or chose with "Select all").
  const [selected, setSelected] = useState<number[]>([]);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [open, setOpen] = useState<Partial<Record<OverrideGroupId, boolean>>>({});
  const [review, setReview] = useState<CaptureReview | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const items = query.data?.items ?? [];
  const groups = groupOverrides(items);
  const included = (group: readonly ThemeOverride[]) => chosenItems(group, selected);
  const refresh = async () => { await client.invalidateQueries({ queryKey: key }); onChanged(); };
  async function run<T>(label: string, path: string, body: unknown): Promise<T | undefined> {
    setBusy(label); setError(""); setNotice("");
    try { return await json<T>(`${base}${path}`, { method: "POST", body: JSON.stringify(body) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(""); }
  }
  const saveChosen = async () => {
    const result = await run<CaptureReview>("review", "/theme-capture/review", { items: included(groups.save).map(item => item.id) });
    if (result) setReview(result);
  };
  const removeChosen = async () => {
    const picked = included(groups.remove);
    const job = await run<{ id: string }>("remove", "/theme-overrides/remove", { items: picked.map(item => ({ id: item.id, contentSha256: item.contentSha256 })) });
    if (job) { setSelected([]); setNotice(`Removing ${picked.length} saved cop${picked.length === 1 ? "y" : "ies"}. You can restore ${picked.length === 1 ? "it" : "them"} from Development history.`); await refresh(); }
  };
  const toggle = (list: number[], id: number) => list.includes(id) ? list.filter(entry => entry !== id) : [...list, id];

  const row = (item: ThemeOverride, selectable: boolean) => {
    const state = overrideState(item);
    const isOpen = expanded.includes(item.id);
    const name = item.title || item.slug;
    return <li key={item.id} className="min-w-0 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {selectable && <input type="checkbox" className="ui-checkbox shrink-0" aria-label={`Include ${name}`} checked={selected.includes(item.id)} disabled={locked || !!busy} onChange={() => setSelected(toggle(selected, item.id))} />}
        <button type="button" aria-expanded={isOpen} className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left sm:min-h-7" onClick={() => setExpanded(toggle(expanded, item.id))}>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />}
          <span className="min-w-0 truncate font-medium">{name}</span>
          <span className="shrink-0 text-xs text-text-secondary">{TYPE_LABEL[item.type]}</span>
          {!!item.warnings.length && <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-status-warning" title={item.warnings.join(" ")}><AlertTriangle className="h-3 w-3" aria-hidden="true" /><span className="sr-only">Warnings: </span>{item.warnings.length}</span>}
        </button>
      </div>
      {isOpen && <div className={`mt-1 space-y-0.5 ${selectable ? "pl-6" : "pl-5"} text-xs`}>
        <p className="break-all text-text-muted">{item.repositoryPath}</p>
        <p className="text-text-secondary">Edited {editedAt(item)} · <span className={state.tone === "ok" ? "text-status-success" : state.tone === "warn" ? "text-status-warning" : ""}>{state.label}</span></p>
        {item.warnings.map(warning => <p key={warning} className="flex items-start gap-1 text-status-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{warning}</p>)}
      </div>}
    </li>;
  };

  const group = (id: OverrideGroupId, action: ReactNode, selectable: boolean, hint: string) => {
    const list = groups[id];
    if (!list.length) return null;
    const meta = OVERRIDE_GROUPS.find(entry => entry.id === id)!;
    // Rows to choose from start open; a long list whose one button acts on all of it starts closed.
    const firstWithWork = OVERRIDE_GROUPS.find(entry => groups[entry.id].length)?.id;
    const isOpen = open[id] ?? (id === "save" || (id === firstWithWork && list.length <= 6));
    return <div className="rounded-md border border-border-default">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2">
        <button type="button" aria-expanded={isOpen} className="flex min-h-9 min-w-0 items-center gap-1.5 text-left font-medium text-text-heading sm:min-h-7" onClick={() => setOpen({ ...open, [id]: !isOpen })}>
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {meta.title} <span className="font-normal text-text-secondary">({list.length})</span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {selectable && <label className="flex min-h-9 items-center gap-1.5 text-xs text-text-secondary sm:min-h-7">
            <input type="checkbox" className="ui-checkbox" checked={list.every(item => selected.includes(item.id))} disabled={locked || !!busy} onChange={() => setSelected(toggleGroupSelection(list, selected))} />
            Select all {list.length}
          </label>}
          {action}
        </div>
      </div>
      {isOpen && <>
        <p className="border-t border-border-muted px-2.5 py-1.5 text-xs text-text-secondary">{hint}</p>
        <ul aria-label={meta.title} className="divide-y divide-border-muted border-t border-border-muted">{list.map(item => row(item, selectable))}</ul>
      </>}
    </div>;
  };

  if (!siteRunning) return <section aria-label="Site Editor changes" className="space-y-1 rounded-lg border border-border-default p-4 text-sm"><h3 className="font-medium text-text-heading">Site Editor changes</h3><p className="text-text-secondary">Start the local site to see templates and styles edited in WordPress.</p></section>;
  const saveCount = included(groups.save).length, removeCount = included(groups.remove).length;
  return <section aria-label="Site Editor changes" className="min-w-0 space-y-3 rounded-lg border border-border-default p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="font-medium text-text-heading">Site Editor changes</h3><p className="text-text-secondary">Edits from Appearance → Editor live in the database and override the theme files until you save them into the theme.</p></div>
      <Btn size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Check again</Btn>
    </div>
    {query.isLoading && <p role="status" className="text-text-secondary">Reading the local site…</p>}
    {query.isFetching && !query.isLoading && <p role="status" className="text-text-secondary">Checking the local site…</p>}
    {query.error && <p role="alert" className="text-status-error">{query.error instanceof Error ? query.error.message : String(query.error)}</p>}
    {query.data && !query.data.active && <p className="text-text-secondary">{theme} is not the active theme on this site, so the Site Editor is editing another theme.</p>}
    {query.data && !items.length && <p className="flex items-center gap-1.5 text-text-secondary"><Check className="h-4 w-4 text-status-success" aria-hidden="true" />No Site Editor changes. The theme files are what visitors see.</p>}
    {!!items.length && <>
      <ol aria-label="Steps" className="grid gap-1 text-xs sm:grid-cols-3">
        {OVERRIDE_GROUPS.map((entry, index) => {
          const count = groups[entry.id].length;
          return <li key={entry.id} className={`flex items-center gap-1.5 rounded border px-2 py-1 ${count ? "border-border-default text-text-primary" : "border-border-muted text-text-muted"}`}>
            <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${count ? "bg-accent text-accent-text" : "bg-surface-secondary"}`}>{count ? index + 1 : <Check className="h-2.5 w-2.5" aria-hidden="true" />}</span>
            <span className="min-w-0 truncate">{entry.step}</span>
            {!!count && <span className="ml-auto shrink-0 text-text-secondary">{count}</span>}
          </li>;
        })}
      </ol>
      <p role="status" className="font-medium text-text-primary">{overrideSummary(groups)}</p>
      <div aria-busy={query.isFetching} className={`space-y-2 ${query.isFetching ? "opacity-60" : ""}`}>
        {group("save", <Btn size="sm" variant="primary" disabled={locked || !!busy || !saveCount} loading={busy === "review"} onClick={() => void saveChosen()}>Save {saveCount} to repository</Btn>, true, "Only on this site, or different from the repository file. Saving writes them into the repository (not committed).")}
        {group("update", <Btn size="sm" disabled={locked || !onReviewLocalUpdate} loading={reviewing} onClick={onReviewLocalUpdate}>Review local update</Btn>, false, onReviewLocalUpdate ? "Already in the repository. Update the local site from the repository so its theme files match." : "Already in the repository. Save or discard open edits and start the site, then review the local update.")}
        {group("remove", <Btn size="sm" disabled={locked || !!busy || !removeCount} loading={busy === "remove"} onClick={() => void removeChosen()}>Remove {removeCount} saved {removeCount === 1 ? "copy" : "copies"}</Btn>, true, "The theme files now render the same, so removing these database copies doesn't change the site. Restore them from Development history.")}
      </div>
    </>}
    {!!query.data?.navigationMenus && items.some(item => item.warnings.some(warning => warning.includes("navigation"))) && <p className="text-xs text-text-muted">Navigation menus are content, not theme files: push them with the site content, or use a page list in the template.</p>}
    {notice && <p role="status" className="text-text-secondary">{notice}</p>}
    {error && <p role="alert" className="text-status-error">{error}</p>}
    {review && <Modal title="Save Site Editor changes to the repository" size="wide" onClose={() => { if (!busy) setReview(null); }} footer={<><Btn disabled={!!busy} onClick={() => setReview(null)}>Cancel</Btn><Btn variant="primary" disabled={!review.changes.length} loading={busy === "apply"} onClick={async () => {
      const result = await run<{ files: { path: string }[] }>("apply", "/theme-capture/apply", { id: review.id, fingerprint: review.fingerprint });
      if (result) { setReview(null); setSelected([]); setNotice(`Saved ${result.files.length} file${result.files.length === 1 ? "" : "s"} in the repository (not committed). Next: Review local update.`); await refresh(); }
    }}>Save {review.changes.length} file{review.changes.length === 1 ? "" : "s"}</Btn></>}>
      <div className="space-y-3 text-sm">
        <p className="text-text-secondary">Writes these files into the repository's saved files. Nothing is committed; undo from Development history. Template part theme names are removed so the files work under any theme folder name.</p>
        {!!review.unchanged.length && <p className="text-text-secondary">Already in the repository: {review.unchanged.join(", ")}.</p>}
        {review.changes.map(change => <details key={change.path} className="rounded-md border border-border-muted p-2">
          <summary data-zoer-disclosure="" className="cursor-pointer"><span className="font-medium">{change.title}</span> <span className="text-text-secondary">· {change.kind === "added" ? "new file" : "replaces"} {change.path}</span></summary>
          {change.warnings.map(warning => <p key={warning} className="mt-1 flex items-start gap-1 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{warning}</p>)}
          {change.content && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-secondary p-2 text-xs">{change.content}</pre>}
        </details>)}
        {error && <p role="alert" className="text-status-error">{error}</p>}
      </div>
    </Modal>}
  </section>;
}
