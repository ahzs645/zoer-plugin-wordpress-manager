import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, Layers, Loader2, Upload, X } from "lucide-react";
import { Btn, Field, Modal, Select, selectClass } from "@zoer/plugin-ui/controls";
import { api, type WordPressManagedSite } from "../../lib/api";
import { getApiBase } from "../../lib/api/_http";
import { stackClient, type InstallJob, type RepositoryInventoryEntry } from "../../lib/api/stack-client";
import { useWordPressDiagnostics } from "../../lib/queries/wordpress-transfer";
import { commitCatalog } from "../../lib/queries/plugin-engine";
import {
  cloneLink, compareStack, exportStack, gitKey, parseStackFile, parseStackLink, playgroundBlueprint, STACK_FILE, STACK_RECORD_KIND, stackRecordId, stackText,
  type GitSource, type PlannedEntry, type RepositoryLinkInfo, type StackEntry, type StackFile, type StackLock, type StackLockEntry, type UrlSource, type WordPressOrgSource,
} from "../../lib/wordpress-stack/stack";

/**
 * Stack file (`zoer-wordpress.json`): a site's plugins and themes by source. Export from any site
 * (download, Playground blueprint or save into a repository); apply to a local site (installs and
 * activations through the existing reviewed workflows, one after another, then a `stack:` record).
 */

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const host = (url: string) => url.replace(/^https:\/\//, "");
export function describeSource(entry: StackEntry): string {
  const source = entry.source;
  if (source.resource === "git:directory") return `${host(source.url)}${source.path ? `/${source.path}` : ""}${source.ref ? ` @ ${source.refType === "commit" ? source.ref.slice(0, 12) : source.ref}` : ""}`;
  if (source.resource === "url") return `ZIP ${host(source.url)}`;
  return `wordpress.org${source.version ? ` ${source.version}` : " (latest)"}`;
}
const useRepositories = () => useQuery({ queryKey: [getApiBase(), "development-repositories"], queryFn: () => stackClient.repositories(), staleTime: 10_000 });

export default function SiteStackPanel({ site }: { site: WordPressManagedSite }) {
  const [open, setOpen] = useState<"export" | "apply" | null>(null);
  const local = site.provider === "ddev";
  return <section aria-label="Stack file" className="min-w-0 space-y-2 rounded-lg border border-border-default p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="flex items-center gap-1.5 font-medium text-text-heading"><Layers className="h-4 w-4 text-text-secondary" aria-hidden="true" />Stack file</h3>
        <p className="text-text-secondary">This site's plugins and themes by where they come from ({STACK_FILE}). Keep it in a repository or share it, then apply it to another local site.</p></div>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setOpen("export")}>Export</Btn>
        {local && <Btn size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setOpen("apply")}>Apply a stack file</Btn>}
      </div>
    </div>
    {!local && <p className="text-xs text-text-muted">Stack files are applied to local sites. Export here, then apply on a local copy.</p>}
    {open === "export" && <ExportStackDialog site={site} onClose={() => setOpen(null)} />}
    {open === "apply" && <ApplyStackDialog site={site} onClose={() => setOpen(null)} />}
  </section>;
}

// ---------------------------------------------------------------------------
// Export

function ExportStackDialog({ site, onClose }: { site: WordPressManagedSite; onClose: () => void }) {
  const local = site.provider === "ddev";
  const inventory = useWordPressDiagnostics(site.id, { local });
  const repositories = useRepositories();
  const links = useQuery({ queryKey: [getApiBase(), "site-repository-development", site.id], queryFn: () => stackClient.siteRepositories(site.id), enabled: local, retry: false });
  const linked = (links.data?.repositories ?? []).filter(repo => repo.link?.siteId === site.id);
  const git = useQueries({ queries: linked.map(repo => ({ queryKey: [getApiBase(), "repository-git", repo.id], queryFn: () => stackClient.git(repo.id), staleTime: 15_000 })) });
  const ready = inventory.isSuccess && (!local || links.isSuccess || links.isError) && git.every(query => !query.isLoading) && repositories.isSuccess;
  const exported = useMemo(() => {
    if (!ready) return null;
    const infos: RepositoryLinkInfo[] = linked.map((repo, index) => {
      const state = git[index]?.data;
      const gitUrl = state?.url ?? repositories.data?.repositories.find(entry => entry.id === repo.id)?.gitUrl ?? null;
      const ref = state ? (state.tags[0] ? { ref: state.tags[0], refType: "tag" as const } : state.branch ? { ref: state.branch, refType: "branch" as const } : state.head ? { ref: state.head, refType: "commit" as const } : null) : null;
      return { repoId: repo.id, name: repo.name, slug: repo.link!.slug, folder: repo.link!.folder, kind: repo.link!.kind ?? "plugin", gitUrl, ref };
    });
    const dirty = linked.filter((_, index) => git[index]?.data?.dirty).map(repo => repo.link!.slug);
    const result = exportStack({ name: site.name, plugins: inventory.data?.plugins ?? [], themes: inventory.data?.themes ?? [], links: infos });
    return { ...result, notes: [...result.notes, ...dirty.map(slug => ({ slug, kind: "plugin" as const, note: "Its repository has saved changes that are not committed. Commit and push them so other sites get the same code." }))] };
  }, [ready, inventory.data, links.data, git.map(query => query.dataUpdatedAt).join(), repositories.data, site.name]);

  // wordpress.org entries are an assumption: check each slug exists there.
  const wporg = useMemo(() => [...(exported?.stack.plugins ?? []).map(entry => ({ entry, kind: "plugin" as const })), ...(exported?.stack.themes ?? []).map(entry => ({ entry, kind: "theme" as const }))].filter(item => item.entry.source.resource.startsWith("wordpress.org/")), [exported]);
  const found = useQueries({ queries: wporg.map(item => ({ queryKey: [getApiBase(), "wporg-exists", item.kind, item.entry.slug], staleTime: 60 * 60_000, retry: false,
    queryFn: async () => (await api.searchWordPressExtensions(site.id, item.kind, item.entry.slug)).results.some(result => result.slug === item.entry.slug) })) });
  const missing = new Set(wporg.filter((_, index) => found[index]?.data === false).map(item => `${item.kind}:${item.entry.slug}`));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  useEffect(() => { if (missing.size) setExcluded(current => new Set([...current, ...missing])); }, [[...missing].join()]);
  const stack: StackFile | null = exported ? { ...exported.stack, plugins: exported.stack.plugins.filter(entry => !excluded.has(`plugin:${entry.slug}`)), themes: exported.stack.themes.filter(entry => !excluded.has(`theme:${entry.slug}`)) } : null;
  const [save, setSave] = useState(false);

  const rows = exported ? [...exported.stack.plugins.map(entry => ({ entry, kind: "plugin" as const })), ...exported.stack.themes.map(entry => ({ entry, kind: "theme" as const }))] : [];
  return <Modal mobileSheet size="wide" title="Export stack file" onClose={onClose} footer={<>
    <Btn onClick={onClose}>Close</Btn>
    <Btn disabled={!stack} onClick={() => stack && download("blueprint.json", `${JSON.stringify(playgroundBlueprint(stack), null, 2)}\n`)}>Playground blueprint</Btn>
    <Btn disabled={!stack} onClick={() => setSave(true)}>Save to repository</Btn>
    <Btn variant="primary" disabled={!stack} onClick={() => stack && download(STACK_FILE, stackText(stack))}>Download</Btn>
  </>}>
    <div className="min-w-0 space-y-3 text-sm">
      {!ready && !inventory.error && <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Reading {site.name}…</p>}
      {inventory.error && <p role="alert" className="text-status-error">{inventory.error instanceof Error ? inventory.error.message : "The site's plugins and themes could not be read."}{local ? " Start the local site and try again." : ""}</p>}
      {exported && <>
        <p className="text-text-secondary">Untick anything that should not travel. Plugins developed from a repository point at its Git remote; the rest at wordpress.org.</p>
        <ul className="divide-y divide-border-muted rounded-md border border-border-muted">
          {rows.map(({ entry, kind }) => {
            const key = `${kind}:${entry.slug}`, notFound = missing.has(key), note = exported.notes.find(item => item.slug === entry.slug)?.note;
            return <li key={key} className="flex min-w-0 items-start gap-2 p-2.5">
              <input type="checkbox" className="ui-checkbox mt-1 shrink-0" aria-label={`Include ${entry.slug}`} checked={!excluded.has(key)} onChange={event => setExcluded(current => { const next = new Set(current); if (event.target.checked) next.delete(key); else next.add(key); return next; })} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{entry.slug} <span className="font-normal text-text-secondary">· {kind}{entry.activate ? " · active" : ""}</span></p>
                <p className="break-all text-xs text-text-muted">{describeSource(entry)}</p>
                {notFound && <p className="flex items-start gap-1 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />Not on wordpress.org. Develop it from a repository with a Git remote, or add a ZIP source to the file.</p>}
                {note && <p className="flex items-start gap-1 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{note}</p>}
              </div>
            </li>;
          })}
        </ul>
        <details><summary data-zoer-disclosure="" className="cursor-pointer text-text-secondary">Show the file</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-secondary p-2 text-xs">{stack ? stackText(stack) : ""}</pre></details>
      </>}
      {save && stack && <SaveToRepository text={stackText(stack)} onClose={() => setSave(false)} />}
    </div>
  </Modal>;
}

function SaveToRepository({ text, onClose }: { text: string; onClose: () => void }) {
  const repositories = useRepositories();
  const [repoId, setRepoId] = useState(""), [path, setPath] = useState(STACK_FILE);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  const [replace, setReplace] = useState<{ sha256: string } | null>(null);
  async function write(expectedSha256: string | null) {
    setBusy(true); setError("");
    try {
      if (expectedSha256 === null) {
        const current = await stackClient.file(repoId, path);
        if (current) { setReplace({ sha256: current.sha256 }); return; }
      }
      await stackClient.saveStackFile(repoId, { path, content: text, expectedSha256 });
      setDone(`Saved ${path}. Commit it in Repos to share it.`); setReplace(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  const repo = repositories.data?.repositories.find(entry => entry.id === repoId);
  return <section aria-label="Save to repository" className="space-y-3 rounded-md border border-border-default p-3">
    <div className="flex items-center justify-between"><p className="font-medium">Save to repository</p><button type="button" aria-label="Close" className="text-text-secondary" onClick={onClose}><X className="h-4 w-4" /></button></div>
    <label className="block space-y-1">Repository<Select searchable aria-label="Repository" className={selectClass("compact", "w-full")} value={repoId} onChange={event => { setRepoId(event.target.value); setReplace(null); setDone(""); }}><option value="">Choose a repository</option>{(repositories.data?.repositories ?? []).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</Select></label>
    <Field label="File" value={path} onChange={value => { setPath(value); setReplace(null); setDone(""); }} />
    {replace ? <div role="alert" className="space-y-2 text-status-warning"><p>{path} already exists in {repo?.name}. Replace it?</p><div className="flex gap-2"><Btn size="sm" variant="primary" loading={busy} onClick={() => void write(replace.sha256)}>Replace</Btn><Btn size="sm" onClick={() => setReplace(null)}>Keep it</Btn></div></div>
      : <Btn size="sm" variant="primary" disabled={!repoId || !path} loading={busy} onClick={() => void write(null)}>Save</Btn>}
    {done && <p role="status" className="flex items-center gap-1.5 text-status-success"><Check className="h-4 w-4" aria-hidden="true" />{done} {repo && <a className="text-accent underline" href={`/#/repos/${encodeURIComponent(repo.id)}/status`}>Open in Repos</a>}</p>}
    {error && <p role="alert" className="text-status-error">{error}</p>}
  </section>;
}

// ---------------------------------------------------------------------------
// Apply

type Origin = "repository" | "link" | "paste";
type StepState = { status: "pending" | "running" | "done" | "failed" | "skipped"; detail?: string };

function ApplyStackDialog({ site, onClose }: { site: WordPressManagedSite; onClose: () => void }) {
  const client = useQueryClient();
  const repositories = useRepositories();
  const inventory = useWordPressDiagnostics(site.id, { local: true });
  const [origin, setOrigin] = useState<Origin>("repository");
  const [repoId, setRepoId] = useState(""), [path, setPath] = useState(STACK_FILE), [link, setLink] = useState(""), [pasted, setPasted] = useState("");
  const [stack, setStack] = useState<StackFile | null>(null), [originLabel, setOriginLabel] = useState("");
  const [loadError, setLoadError] = useState(""), [loading, setLoading] = useState(false), [needsClone, setNeedsClone] = useState<GitSource | null>(null);
  const repos: RepositoryInventoryEntry[] = repositories.data?.repositories ?? [];

  async function load() {
    setLoadError(""); setNeedsClone(null); setLoading(true);
    try {
      if (origin === "paste") { setStack(parseStackFile(pasted)); setOriginLabel("pasted file"); return; }
      let repo = repos.find(entry => entry.id === repoId), file = path;
      if (origin === "link") {
        const parsed = parseStackLink(link);
        if (!parsed) throw new Error("Use a GitHub link to the file or repository, or an HTTPS Git URL.");
        repo = repos.find(entry => gitKey(entry.gitUrl) === gitKey(parsed.repository));
        if (!repo) { setNeedsClone({ resource: "git:directory", url: parsed.repository, ...(parsed.ref ? { ref: parsed.ref } : {}) }); throw new Error("That repository is not in Repos yet. Clone it, then load the link again."); }
        file = parsed.path;
      }
      if (!repo) throw new Error("Choose a repository.");
      const text = await stackClient.file(repo.id, file);
      if (!text) throw new Error(`${file} was not found in ${repo.name}.`);
      setStack(parseStackFile(text.content)); setOriginLabel(`${repo.name}/${file}`);
    } catch (caught) { setLoadError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }

  return <Modal mobileSheet size="wide" title={`Apply a stack file to ${site.name}`} onClose={onClose}>
    <div className="min-w-0 space-y-3 text-sm">
      {!stack ? <>
        <div role="radiogroup" aria-label="Where the stack file is" className="grid gap-2 sm:grid-cols-3">
          {([["repository", "From a repository"], ["link", "From a GitHub link"], ["paste", "Paste or upload"]] as const).map(([value, label]) =>
            <label key={value} className={`flex min-h-11 cursor-pointer items-center rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-input-focus ${origin === value ? "border-accent bg-surface-hover" : "border-border-default hover:bg-surface-hover"}`}><input type="radio" className="sr-only" name="stack-origin" checked={origin === value} onChange={() => setOrigin(value)} />{label}</label>)}
        </div>
        {origin === "repository" && <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <label className="block space-y-1">Repository<Select searchable aria-label="Repository" className={selectClass("compact", "w-full")} value={repoId} onChange={event => setRepoId(event.target.value)}><option value="">Choose a repository</option>{repos.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</Select></label>
          <Field label="File" value={path} onChange={setPath} />
        </div>}
        {origin === "link" && <Field label="Link" value={link} onChange={setLink} placeholder="https://github.com/owner/repo/blob/main/zoer-wordpress.json" />}
        {origin === "paste" && <div className="space-y-2">
          <textarea aria-label="Stack file JSON" spellCheck={false} className="min-h-40 w-full rounded-md border border-border-default bg-transparent p-3 font-mono text-base outline-none focus:ring-2 focus:ring-input-focus sm:text-xs" value={pasted} onChange={event => setPasted(event.target.value)} placeholder={'{ "schemaVersion": 1, "plugins": [], "themes": [] }'} />
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-accent underline"><input type="file" accept="application/json,.json" className="sr-only" onChange={async event => { const file = event.target.files?.[0]; if (file) setPasted(await file.text()); }} />Choose a file</label>
        </div>}
        <div className="flex flex-wrap items-center gap-2"><Btn variant="primary" loading={loading} disabled={origin === "repository" ? !repoId : origin === "link" ? !link.trim() : !pasted.trim()} onClick={() => void load()}>Load</Btn>
          {needsClone && <a className="text-accent underline" href={cloneLink(needsClone)}>Clone it in Repos</a>}</div>
        {loadError && <p role="alert" className="text-status-error">{loadError}</p>}
      </> : <ApplyPlan site={site} stack={stack} originLabel={originLabel} repos={repos} installed={inventory.data} inventoryError={inventory.error} onBack={() => setStack(null)} onDone={async () => { await client.invalidateQueries(); }} />}
    </div>
  </Modal>;
}

const ACTION_LABEL: Record<PlannedEntry["state"], string> = { installed: "Installed", "different-version": "Replace version", inactive: "Activate", missing: "Install" };

function ApplyPlan({ site, stack, originLabel, repos, installed, inventoryError, onBack, onDone }: {
  site: WordPressManagedSite; stack: StackFile; originLabel: string; repos: RepositoryInventoryEntry[];
  installed: { plugins?: { slug: string; version?: string; active?: boolean }[]; themes?: { slug: string; version?: string; active?: boolean }[] } | undefined; inventoryError: unknown; onBack: () => void; onDone: () => Promise<void>;
}) {
  const plan = useMemo(() => installed ? compareStack(stack, { plugins: installed.plugins ?? [], themes: installed.themes ?? [] }, repos) : [], [stack, installed, repos]);
  const matched = [...new Set(plan.flatMap(item => item.repository ? [item.repository.id] : []))];
  const git = useQueries({ queries: matched.map(id => ({ queryKey: [getApiBase(), "repository-git", id], queryFn: () => stackClient.git(id), staleTime: 15_000 })) });
  const gitOf = (id: string) => git[matched.indexOf(id)]?.data;
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [running, setRunning] = useState(false), [finished, setFinished] = useState(false), [error, setError] = useState("");
  const work = plan.filter(item => item.state !== "installed" && !(item.entry.source.resource === "git:directory" && !item.repository));
  const blocked = plan.filter(item => item.entry.source.resource === "git:directory" && !item.repository);
  const set = (key: string, state: StepState) => setSteps(current => ({ ...current, [key]: state }));

  async function extension(item: PlannedEntry, operation: "install" | "activate") {
    const source = item.entry.source;
    const input = { siteId: site.id, kind: item.kind, operation, slugs: [item.entry.slug],
      ...(operation === "install" && source.resource.startsWith("wordpress.org/") && (source as WordPressOrgSource).version ? { version: (source as WordPressOrgSource).version } : {}),
      ...(operation === "install" && source.resource === "url" ? { package: { url: (source as UrlSource).url, sha256: (source as UrlSource).sha256 } } : {}) };
    const { plan: reviewed } = await api.planWordPressExtensionChange(input);
    await api.applyWordPressExtensionChange({ ...input, fingerprintSha256: reviewed.fingerprintSha256 });
  }
  async function fromRepository(item: PlannedEntry): Promise<Partial<StackLockEntry>> {
    const source = item.entry.source as GitSource;
    const review = await stackClient.reviewInstall(site.id, { repoId: item.repository!.id, folder: source.path ?? ".", slug: item.entry.slug, kind: item.kind });
    if (!review.changes.length) return { result: "already-installed", commit: review.source.commit, digest: review.source.digest, version: review.source.version };
    const job = await stackClient.applyInstall(site.id, review);
    for (let attempt = 0; attempt < 300; attempt++) {
      const current = (await stackClient.installs(site.id)).jobs.find((entry: InstallJob) => entry.id === job.id);
      if (current && current.status !== "running") { if (current.status !== "succeeded") throw new Error(current.error || `Install ${current.status}.`); break; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return { result: "installed", commit: review.source.commit, digest: review.source.digest, version: review.source.version };
  }

  async function apply() {
    setRunning(true); setError("");
    const results: StackLockEntry[] = plan.filter(item => item.state === "installed").map(item => ({ kind: item.kind, slug: item.entry.slug, source: item.entry.source, result: "already-installed", ...(item.installedVersion ? { version: item.installedVersion } : {}) }));
    for (const item of blocked) results.push({ kind: item.kind, slug: item.entry.slug, source: item.entry.source, result: "skipped", error: "Repository not in Repos" });
    let failed = false;
    for (const item of work) {
      const key = `${item.kind}:${item.entry.slug}`;
      if (failed) { set(key, { status: "skipped" }); results.push({ kind: item.kind, slug: item.entry.slug, source: item.entry.source, result: "skipped" }); continue; }
      set(key, { status: "running" });
      try {
        let outcome: Partial<StackLockEntry> = { result: "installed" };
        if (item.state === "missing" || item.state === "different-version") {
          if (item.entry.source.resource === "git:directory") outcome = await fromRepository(item);
          else { await extension(item, "install"); outcome = { result: "installed", ...(item.entry.source.resource === "url" ? { sha256: (item.entry.source as UrlSource).sha256 } : {}), ...((item.entry.source as WordPressOrgSource).version ? { version: (item.entry.source as WordPressOrgSource).version } : {}) }; }
        }
        if (item.entry.activate) { set(key, { status: "running", detail: "Activating…" }); await extension(item, "activate"); }
        set(key, { status: "done" });
        results.push({ kind: item.kind, slug: item.entry.slug, source: item.entry.source, result: outcome.result ?? "installed", ...outcome });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        set(key, { status: "failed", detail: message }); failed = true;
        results.push({ kind: item.kind, slug: item.entry.slug, source: item.entry.source, result: "failed", error: message.slice(0, 500) });
      }
    }
    const lock: StackLock = { siteId: site.id, ...(stack.name ? { name: stack.name } : {}), appliedAt: new Date().toISOString(), origin: originLabel, entries: results };
    try { await commitCatalog({ records: [{ id: stackRecordId(site.id), kind: STACK_RECORD_KIND, title: `Stack applied to ${site.name}`, data: lock as unknown as Record<string, unknown> }] }, STACK_RECORD_KIND); }
    catch (caught) { setError(`Applied, but the record could not be saved: ${caught instanceof Error ? caught.message : String(caught)}`); }
    setRunning(false); setFinished(true); await onDone();
  }

  if (inventoryError) return <p role="alert" className="text-status-error">The site's plugins could not be read. Start the local site and try again.</p>;
  if (!installed) return <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Reading {site.name}…</p>;
  return <div className="min-w-0 space-y-3">
    <p className="text-text-secondary">{stack.name ? `${stack.name} · ` : ""}{originLabel} · {plan.length} item{plan.length === 1 ? "" : "s"}. Each install and activation keeps a backup and checks Site Health, as usual.</p>
    <ul className="divide-y divide-border-muted rounded-md border border-border-muted">
      {plan.map(item => {
        const key = `${item.kind}:${item.entry.slug}`, step = steps[key];
        const source = item.entry.source as GitSource;
        const repoGit = item.repository ? gitOf(item.repository.id) : undefined;
        const refMismatch = source.resource === "git:directory" && source.ref && repoGit && !(repoGit.tags.includes(source.ref) || repoGit.branch === source.ref || (repoGit.head ?? "").startsWith(source.ref));
        return <li key={key} className="flex min-w-0 items-start gap-2 p-2.5">
          <span className="mt-0.5 shrink-0" aria-hidden="true">{step?.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : step?.status === "done" || (!step && item.state === "installed") ? <Check className="h-4 w-4 text-status-success" /> : step?.status === "failed" ? <X className="h-4 w-4 text-status-error" /> : <span className="block h-4 w-4 rounded-full border border-border-default" />}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{item.entry.slug} <span className="font-normal text-text-secondary">· {item.kind} · {item.state === "installed" ? "installed" : ACTION_LABEL[item.state]}{item.entry.activate && item.state !== "installed" ? " and activate" : ""}{item.installedVersion && item.state === "different-version" ? ` (now ${item.installedVersion})` : ""}</span></p>
            <p className="break-all text-xs text-text-muted">{describeSource(item.entry)}{item.repository ? ` · Repos: ${item.repository.name}` : ""}</p>
            {source.resource === "git:directory" && !item.repository && <p className="text-xs text-status-warning">Not in Repos. <a className="text-accent underline" href={cloneLink(source)}>Clone it in Repos</a>, then load the stack file again.</p>}
            {refMismatch && <p className="text-xs text-status-warning">Repos copy is on {repoGit!.branch ?? repoGit!.head?.slice(0, 12)}; the file asks for {source.ref}. Switch it in Repos, or install the saved files as they are.</p>}
            {item.entry.source.resource === "url" && item.state !== "installed" && <p className="text-xs text-text-muted">The ZIP is checked against its SHA-256 before anything is installed.</p>}
            {step?.detail && <p className={`text-xs ${step.status === "failed" ? "text-status-error" : "text-text-secondary"}`}>{step.detail}</p>}
            {step?.status === "skipped" && <p className="text-xs text-text-muted">Skipped after an earlier step failed.</p>}
          </div>
        </li>;
      })}
    </ul>
    {error && <p role="alert" className="text-status-error">{error}</p>}
    {finished ? <p role="status" className="text-text-secondary">Done. The result is saved with this site; load the file again to check for anything left.</p> : null}
    <div className="flex flex-wrap gap-2">
      <Btn disabled={running} onClick={onBack}>Choose another file</Btn>
      <Btn variant="primary" disabled={running || finished || !work.length} loading={running} onClick={() => void apply()}>{work.length ? `Apply ${work.length} change${work.length === 1 ? "" : "s"}` : "Nothing to change"}</Btn>
    </div>
  </div>;
}
