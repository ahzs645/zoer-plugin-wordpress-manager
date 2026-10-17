import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
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

/** Where one saved copy stands: in the repository, installed on the site, and whether removing it is safe. */
export function overrideState(item: ThemeOverride): { label: string; tone: "ok" | "todo" | "warn" } {
  if (item.safeToRemove) return { label: "Saved in the theme files", tone: "ok" };
  if (item.inRepository) return { label: "In the repository · update the local site", tone: "todo" };
  if (item.repositoryFile.exists) return { label: "Differs from the repository file", tone: "warn" };
  return { label: "Only on this site", tone: "warn" };
}

export default function ThemeSiteEditorChanges({ base, theme, siteRunning, locked, onChanged }: { base: string; theme: string; siteRunning: boolean; locked: boolean; onChanged: () => void }) {
  const client = useQueryClient();
  const key = [getApiBase(), "theme-overrides", base];
  const query = useQuery({ queryKey: key, queryFn: () => json<Overrides>(`${base}/theme-overrides`), enabled: siteRunning, retry: false, staleTime: 15_000 });
  const [chosen, setChosen] = useState<number[]>([]);
  const [review, setReview] = useState<CaptureReview | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const items = query.data?.items ?? [];
  const removable = items.filter(item => item.safeToRemove);
  const toSave = items.filter(item => !item.inRepository);
  const refresh = async () => { await client.invalidateQueries({ queryKey: key }); onChanged(); };
  async function run<T>(label: string, path: string, body: unknown): Promise<T | undefined> {
    setBusy(label); setError(""); setNotice("");
    try { return await json<T>(`${base}${path}`, { method: "POST", body: JSON.stringify(body) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(""); }
  }

  if (!siteRunning) return <section aria-label="Site Editor changes" className="space-y-1 rounded-lg border border-border-default p-4 text-sm"><h3 className="font-medium text-text-heading">Site Editor changes</h3><p className="text-text-secondary">Start the local site to see templates and styles edited in WordPress.</p></section>;
  return <section aria-label="Site Editor changes" className="min-w-0 space-y-3 rounded-lg border border-border-default p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="font-medium text-text-heading">Site Editor changes</h3><p className="text-text-secondary">Edits made in Appearance → Editor are saved in the database and win over the theme files. Save them into the repository so they are part of the theme.</p></div>
      <Btn size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Check again</Btn>
    </div>
    {query.isLoading && <p role="status" className="text-text-secondary">Reading the local site…</p>}
    {query.error && <p role="alert" className="text-status-error">{query.error instanceof Error ? query.error.message : String(query.error)}</p>}
    {query.data && !query.data.active && <p className="text-text-secondary">{theme} is not the active theme on this site, so the Site Editor is editing another theme.</p>}
    {query.data && !items.length && <p className="flex items-center gap-1.5 text-text-secondary"><Check className="h-4 w-4 text-status-success" aria-hidden="true" />No Site Editor changes. The theme files are what visitors see.</p>}
    {!!items.length && <ul className="divide-y divide-border-muted rounded-md border border-border-muted">
      {items.map(item => {
        const state = overrideState(item);
        return <li key={item.id} className="flex min-w-0 items-start gap-2 p-2.5">
          <input type="checkbox" className="ui-checkbox mt-1 shrink-0" aria-label={`Choose ${item.title || item.slug}`} checked={chosen.includes(item.id)} onChange={event => setChosen(event.target.checked ? [...chosen, item.id] : chosen.filter(id => id !== item.id))} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{item.title || item.slug} <span className="font-normal text-text-secondary">· {TYPE_LABEL[item.type]}</span></p>
            <p className="break-all text-xs text-text-muted">{item.repositoryPath} · edited {item.modified ? new Date(`${item.modified.replace(" ", "T")}Z`).toLocaleString() : "unknown"}</p>
            <p className={`text-xs ${state.tone === "ok" ? "text-status-success" : state.tone === "warn" ? "text-status-warning" : "text-text-secondary"}`}>{state.label}</p>
            {item.warnings.map(warning => <p key={warning} className="flex items-start gap-1 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{warning}</p>)}
          </div>
        </li>;
      })}
    </ul>}
    {!!items.length && <div className="flex flex-wrap gap-2">
      <Btn variant="primary" disabled={locked || !!busy || !chosen.some(id => toSave.some(item => item.id === id))} loading={busy === "review"} onClick={async () => { const result = await run<CaptureReview>("review", "/theme-capture/review", { items: chosen.filter(id => toSave.some(item => item.id === id)) }); if (result) setReview(result); }}>Save to repository</Btn>
      <Btn disabled={locked || !!busy || !chosen.some(id => removable.some(item => item.id === id))} loading={busy === "remove"} onClick={async () => {
        const picked = removable.filter(item => chosen.includes(item.id));
        const job = await run<{ id: string }>("remove", "/theme-overrides/remove", { items: picked.map(item => ({ id: item.id, contentSha256: item.contentSha256 })) });
        if (job) { setChosen([]); setNotice(`Removing ${picked.length} saved cop${picked.length === 1 ? "y" : "ies"}. You can restore ${picked.length === 1 ? "it" : "them"} from Development history.`); await refresh(); }
      }}>Remove saved copies</Btn>
      <Btn size="sm" disabled={!toSave.length} onClick={() => setChosen(toSave.map(item => item.id))}>Choose unsaved</Btn>
    </div>}
    {!!items.length && <p className="text-xs text-text-muted">Next steps: save into the repository, then <strong>Review local update</strong>. When the installed files render the same, remove the saved copies; only those copies can be removed, so the site looks the same afterwards.</p>}
    {!!query.data?.navigationMenus && items.some(item => item.warnings.some(warning => warning.includes("navigation"))) && <p className="text-xs text-text-muted">Navigation menus are content, not theme files. Push them with the site content, or replace the menu reference with a page list in the template.</p>}
    {notice && <p role="status" className="text-text-secondary">{notice}</p>}
    {error && <p role="alert" className="text-status-error">{error}</p>}
    {review && <Modal title="Save Site Editor changes to the repository" size="wide" onClose={() => { if (!busy) setReview(null); }} footer={<><Btn disabled={!!busy} onClick={() => setReview(null)}>Cancel</Btn><Btn variant="primary" disabled={!review.changes.length} loading={busy === "apply"} onClick={async () => {
      const result = await run<{ files: { path: string }[] }>("apply", "/theme-capture/apply", { id: review.id, fingerprint: review.fingerprint });
      if (result) { setReview(null); setChosen([]); setNotice(`Saved ${result.files.length} file${result.files.length === 1 ? "" : "s"} in the repository (not committed). Next: Review local update.`); await refresh(); }
    }}>Save {review.changes.length} file{review.changes.length === 1 ? "" : "s"}</Btn></>}>
      <div className="space-y-3 text-sm">
        <p className="text-text-secondary">Writes these files into the repository's saved files. Nothing is committed; undo from Development history. Template part theme names are removed so the files work under any theme folder name.</p>
        {!!review.unchanged.length && <p className="text-text-secondary">Already in the repository: {review.unchanged.join(", ")}.</p>}
        {review.changes.map(change => <details key={change.path} data-zoer-disclosure className="rounded-md border border-border-muted p-2">
          <summary className="cursor-pointer"><span className="font-medium">{change.title}</span> <span className="text-text-secondary">· {change.kind === "added" ? "new file" : "replaces"} {change.path}</span></summary>
          {change.warnings.map(warning => <p key={warning} className="mt-1 flex items-start gap-1 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{warning}</p>)}
          {change.content && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-secondary p-2 text-xs">{change.content}</pre>}
        </details>)}
        {error && <p role="alert" className="text-status-error">{error}</p>}
      </div>
    </Modal>}
  </section>;
}
