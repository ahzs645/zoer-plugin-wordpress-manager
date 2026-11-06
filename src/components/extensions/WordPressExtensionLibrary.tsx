import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, Modal, Select, controlClass, selectClass, textareaClass } from "@zoer/plugin-ui/controls";
import { Copy, Download, ExternalLink, Plus, RefreshCw, Upload } from "lucide-react";
import { runAction } from "../../host/actions";
import { engineKeys, useCatalogKind, type CatalogRecord } from "../../lib/queries/plugin-engine";
import { stackClient } from "../../lib/api/stack-client";
import { LIBRARY_KIND, MAX_MANIFEST_BYTES, extensionEntry, manifestLocation, parseManifest, libraryRecords, libraryEntries, exportLibrary, type LibraryEntry, type LibraryManifest, type LibraryRecord, type LibrarySource, type ManifestSource } from "../../lib/extension-library/library";
import { InlineAlert } from "@zoer/plugin-ui/controls";
import FilterChips from "./FilterChips";

const example = JSON.stringify({ schemaVersion: 1, repositories: [{ kind: "plugin", name: "Our forms", slug: "our-forms", repositoryUrl: "https://github.com/example/our-forms", ref: "main", path: "." }], manifests: [] }, null, 2);
const message = (error: unknown) => error instanceof Error ? error : new Error("The library could not be updated.");
function downloadManifest(manifest: LibraryManifest) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "wordpress-library.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function WordPressExtensionLibrary() {
  const catalog = useCatalogKind(LIBRARY_KIND, { refetchInterval: 30_000 });
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ type: "repository" | "manifest" | "import"; record?: LibraryRecord } | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "plugin" | "theme">("all");
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [remove, setRemove] = useState<LibraryRecord | null>(null);
  const parsed = useMemo(() => {
    try { return { sources: libraryRecords(catalog.data ?? []), entries: libraryEntries(catalog.data ?? []), error: null }; }
    catch (error) { return { sources: [], entries: [], error: message(error) }; }
  }, [catalog.data]);
  const changed = async () => { await client.invalidateQueries({ queryKey: engineKeys.catalog(LIBRARY_KIND) }); };
  async function work(key: string, run: () => Promise<void>) {
    setBusy(key); setError(null); setNotice("");
    try { await run(); } catch (error) { setError(message(error)); }
    finally { setBusy(null); await changed(); }
  }
  const entries = parsed.entries.filter(entry => (kind === "all" || kind === entry.kind) && `${entry.name} ${entry.slug} ${entry.repositoryUrl} ${entry.description} ${entry.origins.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const ready = catalog.isSuccess && !parsed.error;
  return <section aria-label="WordPress extension library" className="min-w-0 space-y-5 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-medium text-text-heading">Extension library</h2><p className="mt-1 max-w-2xl text-sm text-text-secondary">Your plugins and themes, saved by GitHub repository. Add them individually or through manifests that list repositories and other manifests.</p></div>
      <div className="flex flex-wrap gap-2"><Btn icon={<Plus className="h-4 w-4" />} disabled={!ready || !!busy} onClick={() => setEditor({ type: "repository" })}>Add repository</Btn><Btn disabled={!ready || !!busy} onClick={() => setEditor({ type: "manifest" })}>Add manifest</Btn></div>
    </div>
    <p className="text-sm text-text-secondary">In chat, reference <code>@wordpress</code> and ask for a saved plugin or theme by name. Copy a reference below to include its repository, ref and folder. Adding a source saves its details; use Development to build and install it.</p>
    {(catalog.error || parsed.error || error) && <InlineAlert error={catalog.error || parsed.error || error} onRetry={catalog.error ? () => void catalog.refetch() : undefined} onDismiss={error ? () => setError(null) : undefined} />}
    {notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    <div className="flex flex-wrap gap-2"><Btn size="sm" icon={<Upload className="h-4 w-4" />} disabled={!ready || !!busy} onClick={() => setEditor({ type: "import" })}>Import library</Btn><Btn size="sm" icon={<Download className="h-4 w-4" />} disabled={!ready || !!busy || !parsed.sources.length} onClick={() => void work("export", async () => { downloadManifest(exportLibrary(catalog.data ?? [])); setNotice("Library exported with individual repositories and manifest snapshots."); })}>Export library</Btn><Btn size="sm" icon={<RefreshCw className="h-4 w-4" />} disabled={!!busy} onClick={() => void catalog.refetch()}>Refresh list</Btn></div>
    {catalog.isPending ? <p role="status">Loading library…</p> : ready && !parsed.sources.length ? <p className="py-6 text-sm text-text-secondary">No saved plugins or themes yet. Add your first repository or manifest to make it available here and in chat.</p> : null}
    {!!parsed.entries.length && <>
      <div className="flex flex-wrap items-center gap-3"><input aria-label="Search extension library" placeholder="Search plugins, themes and repositories" value={query} onChange={event => setQuery(event.target.value)} className={controlClass("compact", "min-w-0 flex-1")} /><FilterChips label="Extension type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "plugin", label: "Plugins" }, { value: "theme", label: "Themes" }]} /></div>
      <ul className="divide-y divide-border-default" aria-label="Saved plugins and themes">{entries.map(entry => <li key={entry.key} className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-text-heading">{entry.name} <span className="font-normal text-text-muted">· {entry.kind}</span></p>{entry.description && <p className="mt-1 break-words text-sm text-text-secondary">{entry.description}</p>}<a href={entry.repositoryUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-sm text-accent underline">{entry.repositoryUrl.replace("https://github.com/", "")}<ExternalLink className="h-3 w-3 shrink-0" /></a><p className="mt-1 break-all text-xs text-text-secondary">{entry.slug} · {entry.ref} · {entry.path}</p><p className="mt-1 break-words text-xs text-text-muted">From {entry.origins.join(", ")}</p></div>
        <Btn size="sm" disabled={!!busy} icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void work(entry.key, async () => { await navigator.clipboard.writeText(`@wordpress Use the saved ${entry.kind} ${JSON.stringify(entry.name)} from the extension library: ${entry.repositoryUrl}, ref ${entry.ref}, path ${entry.path}, slug ${entry.slug}.`); setNotice(`Copied a chat reference for ${entry.name}.`); })}>Copy chat reference</Btn>
      </li>)}</ul>{!entries.length && <p className="text-sm text-text-secondary">No plugins or themes match this search.</p>}
    </>}
    {!!parsed.sources.length && <section aria-label="Library sources" className="min-w-0 space-y-2"><h3 className="text-sm font-medium text-text-heading">Manage sources</h3><p className="text-xs text-text-secondary">Refreshing a manifest reads its latest contents before you save a replacement. Removing a source keeps entries still supplied by another source.</p><ul className="divide-y divide-border-default">{parsed.sources.map(source => <li key={source.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0 flex-1"><p className="break-words text-sm text-text-primary">{source.title}</p><p className="break-all text-xs text-text-muted">{source.data.type === "repository" ? source.data.entry.repositoryUrl : source.data.source.repositoryUrl ? `${source.data.source.repositoryUrl} · ${source.data.source.ref} · ${source.data.source.path}` : "Imported manifest snapshot"}</p></div><div className="flex gap-2"><Btn size="sm" disabled={!!busy} onClick={() => setEditor({ type: source.data.type, record: source })}>{source.data.type === "manifest" ? "Review / refresh" : "Edit"}</Btn><Btn size="sm" disabled={!!busy} onClick={() => setRemove(source)}>Remove</Btn></div></li>)}</ul></section>}
    {editor && <LibrarySourceEditor type={editor.type} record={editor.record} onClose={() => setEditor(null)} onSaved={async () => { await changed(); setEditor(null); setNotice("Library saved and read back successfully."); }} />}
    {remove && <Modal title="Remove library source" onClose={() => { if (!busy) setRemove(null); }} footer={<><Btn disabled={!!busy} onClick={() => setRemove(null)}>Cancel</Btn><Btn disabled={!!busy} loading={busy === "remove"} onClick={() => void work("remove", async () => { await runAction("library.remove", { id: remove.id }); setRemove(null); setNotice("Source removed from the library."); })}>Remove source</Btn></>}><p className="text-sm">Remove {remove.title} from this library? Its GitHub repository and installed WordPress sites are preserved.</p>{error && <InlineAlert error={error} />}</Modal>}
  </section>;
}

function LibrarySourceEditor({ type, record, onClose, onSaved }: { type: "repository" | "manifest" | "import"; record?: LibraryRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const entry = record?.data.type === "repository" ? record.data.entry : undefined;
  const source = record?.data.type === "manifest" ? record.data.source : undefined;
  const [name, setName] = useState(entry?.name ?? source?.name ?? "");
  const [repositoryUrl, setRepositoryUrl] = useState(entry?.repositoryUrl ?? source?.repositoryUrl ?? "");
  const [kind, setKind] = useState<"plugin" | "theme">(entry?.kind ?? "plugin");
  const [slug, setSlug] = useState(entry?.slug ?? "");
  const [ref, setRef] = useState(entry?.ref ?? source?.ref ?? "HEAD");
  const [path, setPath] = useState(entry?.path ?? source?.path ?? (type === "repository" ? "." : "wordpress-library.json"));
  const [description, setDescription] = useState(entry?.description ?? "");
  const [mode, setMode] = useState<"github" | "json" | "repository">(source && !source.repositoryUrl || type === "import" ? "json" : "github");
  const [json, setJson] = useState(source?.snapshot ? JSON.stringify(source.snapshot, null, 2) : "");
  const [repoId, setRepoId] = useState("");
  const [preview, setPreview] = useState<{ manifest: LibraryManifest; source?: ManifestSource; count: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const repositories = useQuery({ queryKey: ["wordpress-library-repositories"], queryFn: () => stackClient.repositories(), enabled: mode === "repository", retry: false });
  const reset = () => { setPreview(null); setError(null); };
  async function work(run: () => Promise<void>) { setBusy(true); setError(null); try { await run(); } catch (error) { setError(message(error)); } finally { setBusy(false); } }
  async function review() {
    setPreview(null);
    let input: unknown;
    let location: ReturnType<typeof manifestLocation> | undefined;
    if (mode === "github") {
      location = manifestLocation({ repositoryUrl, ref, path });
      input = { schemaVersion: 1, manifests: [{ name: name.trim() || location.path, ...location }] };
    } else {
      const content = mode === "repository" ? (await stackClient.file(repoId, path))?.content : json;
      if (!content) throw new Error("Choose a manifest file with JSON content.");
      input = parseManifest(content);
    }
    const resolved = await runAction<{ manifest: LibraryManifest }>("library.resolve", { manifest: input, refresh: type === "manifest" });
    const manifest = type === "import" && location ? resolved.manifest.manifests[0]!.snapshot! : resolved.manifest;
    const resolvedSource: ManifestSource | undefined = type === "import" ? undefined : location ? manifest.manifests[0] : { name: name.trim() || "Imported manifest", snapshot: manifest };
    const records = type === "import" ? manifestRecords(manifest) : [{ id: "preview", kind: LIBRARY_KIND, title: resolvedSource!.name, data: { v: 1, type: "manifest", source: resolvedSource } }];
    setPreview({ manifest, source: resolvedSource, count: libraryEntries(records as CatalogRecord[]).length });
  }
  async function save() {
    if (type === "repository") {
      const clean = extensionEntry({ kind, repositoryUrl, ref, path, ...(name.trim() ? { name } : {}), ...(slug.trim() ? { slug } : {}), description }) as LibraryEntry;
      await runAction("library.save", { source: { v: 1, type: "repository", entry: clean }, ...(record ? { replaceId: record.id } : {}) });
    } else {
      if (!preview) throw new Error("Review the manifest before saving it.");
      if (type === "import") await runAction("library.import", { manifest: preview.manifest });
      else await runAction("library.save", { source: { v: 1, type: "manifest", source: preview.source }, ...(record ? { replaceId: record.id } : {}) });
    }
    await onSaved();
  }
  return <Modal mobileSheet title={type === "import" ? "Import library" : `${record ? "Edit" : "Add"} ${type}`} onClose={() => { if (!busy) onClose(); }} footer={<><Btn disabled={busy} onClick={onClose}>Cancel</Btn>{type !== "repository" && <Btn disabled={busy} loading={busy && !preview} onClick={() => void work(review)}>Review manifest</Btn>}<Btn variant="primary" disabled={busy || (type !== "repository" && !preview)} loading={busy && (type === "repository" || !!preview)} onClick={() => void work(save)}>{type === "import" ? "Merge library" : "Save source"}</Btn></>}>
    <div className="space-y-4 text-sm">
      {error && <InlineAlert error={error} />}
      {type !== "import" && <label className="block">Name<input value={name} maxLength={200} placeholder={type === "repository" ? "Defaults to repository name" : "Our WordPress collection"} disabled={busy} onChange={event => { setName(event.target.value); reset(); }} className={controlClass()} /></label>}
      {type !== "repository" && <><p className="text-text-secondary">{type === "import" ? "Restore an exported library by merging its individual repositories and manifests. Existing sources are kept." : "Manifests can list both repositories and other manifests. Review loads a snapshot; saving makes its plugins and themes available in chat."}</p><label className="block">Read manifest from<Select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as typeof mode); reset(); }} className={selectClass()}><option value="github">Public GitHub repository</option><option value="json">JSON file or pasted JSON</option><option value="repository">Existing repository (including private)</option></Select></label></>}
      {type === "repository" && <label className="block">Type<Select value={kind} disabled={busy} onChange={event => setKind(event.target.value as typeof kind)} className={selectClass()}><option value="plugin">Plugin</option><option value="theme">Theme</option></Select></label>}
      {(type === "repository" || mode === "github") && <><label className="block">GitHub repository<input value={repositoryUrl} disabled={busy} placeholder="https://github.com/owner/repository" onChange={event => { setRepositoryUrl(event.target.value); reset(); }} className={controlClass()} /></label><label className="block">Branch, tag or commit<input value={ref} disabled={busy} placeholder="HEAD (default branch)" onChange={event => { setRef(event.target.value); reset(); }} className={controlClass()} /></label></>}
      {mode === "repository" && type !== "repository" && <><label className="block">Existing repository<Select value={repoId} disabled={busy || repositories.isPending} onChange={event => { setRepoId(event.target.value); reset(); }} className={selectClass()}><option value="">Choose repository</option>{repositories.data?.repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</Select></label>{repositories.error && <InlineAlert error={repositories.error} onRetry={() => void repositories.refetch()} />}</>}
      {(type === "repository" || mode !== "json") && <label className="block">{type === "repository" ? "Extension folder" : "Manifest file path"}<input value={path} disabled={busy} onChange={event => { setPath(event.target.value); reset(); }} className={controlClass()} /></label>}
      {type === "repository" && <><label className="block">WordPress slug<input value={slug} disabled={busy} placeholder="Defaults to repository name" maxLength={100} onChange={event => setSlug(event.target.value)} className={controlClass()} /></label><label className="block">Description<textarea value={description} disabled={busy} maxLength={1000} onChange={event => setDescription(event.target.value)} className={textareaClass()} /></label></>}
      {type !== "repository" && mode === "json" && <><label className="block">Manifest JSON file<input type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; reset(); void work(async () => { if (file.size > MAX_MANIFEST_BYTES) throw new Error("Manifest files are limited to 1 MiB."); setJson(await file.text()); if (!name) setName(file.name); }); }} className="mt-1 block w-full" /></label><label className="block">JSON<textarea aria-label="Manifest JSON" value={json} disabled={busy} rows={9} placeholder={example} onChange={event => { setJson(event.target.value); reset(); }} className={textareaClass("default", "font-mono text-xs")} /></label></>}
      {type !== "repository" && <details><summary className="cursor-pointer text-text-secondary">Manifest format</summary><pre className="mt-2 overflow-auto text-xs">{example}</pre><p className="mt-2 text-xs text-text-secondary">Other manifests go in manifests: [{'{'}"name": "Shared themes", "repositoryUrl": "https://github.com/owner/catalog", "ref": "main", "path": "themes.json"{'}'}]. Exports embed snapshots so they can be restored without fetching those repositories.</p></details>}
      {preview && <p role="status" className="text-text-primary">Reviewed {preview.count} unique plugins and themes. Save to keep this snapshot{record ? " and replace the previous source" : ""}.</p>}
    </div>
  </Modal>;
}
function manifestRecords(manifest: LibraryManifest): CatalogRecord[] {
  const sources: LibrarySource[] = [...manifest.repositories.map(entry => ({ v: 1 as const, type: "repository" as const, entry })), ...manifest.manifests.map(source => ({ v: 1 as const, type: "manifest" as const, source }))];
  return sources.map((data, index) => ({ id: `preview-${index}`, kind: LIBRARY_KIND, title: data.type === "repository" ? data.entry.name : data.source.name, data }));
}
