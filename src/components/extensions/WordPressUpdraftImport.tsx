import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, UploadCloud } from "lucide-react";
import type { WordPressUpdraftComponent } from "../../lib/api/computers-client";
import { controlClass } from "@zoer/plugin-ui/controls";
import { COMPONENTS } from "./updraftFiles";
import PluginUpdraftRestore from "./pluginEngine/PluginUpdraftRestore";

const suffixes: Record<WordPressUpdraftComponent, RegExp> = {
  database: /-db\.gz$/i,
  plugins: /-plugins\.zip$/i,
  themes: /-themes\.zip$/i,
  uploads: /-uploads\.zip$/i,
  others: /-others\.zip$/i,
};

function classify(file: File): WordPressUpdraftComponent | null {
  return COMPONENTS.find((component) => suffixes[component].test(file.name)) ?? null;
}

function backupSetPrefix(file: File, component: WordPressUpdraftComponent): string {
  return file.name.replace(suffixes[component], "");
}

function suggestedSiteName(prefix: string): string {
  return prefix.replace(/^backup_\d{4}-\d{2}-\d{2}-\d{4}_/i, "").replace(/_[a-f0-9]{12}$/i, "").replace(/_/g, " ").trim().slice(0, 100);
}

function readableBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

interface Props {
  ddevAvailable?: boolean;
  ddevUnavailableReason?: string | null;
  onRunningChange?: (running: boolean) => void;
}

/**
 * UpdraftPlus backup → new local DDEV site with `backup.restore-local` (0.8.0: the only restore;
 * Zoer's legacy host-side restore and the Playground Updraft import are gone).
 * This component selects and checks the five files; `PluginUpdraftRestore` uploads and restores.
 */
export default function WordPressUpdraftImport({ onRunningChange, ddevAvailable = false, ddevUnavailableReason = null }: Props) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sessionName, setSessionName] = useState("");
  const [files, setFiles] = useState<Partial<Record<WordPressUpdraftComponent, File>>>({});
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectedPrefixes = COMPONENTS.flatMap((component) => files[component] ? [backupSetPrefix(files[component]!, component)] : []);
  const oneBackupSet = new Set(selectedPrefixes).size <= 1;
  const complete = !selectionError && oneBackupSet && COMPONENTS.every((component) => files[component]);
  const setRunning = useCallback((value: boolean) => { setBusy(value); onRunningChange?.(value); }, [onRunningChange]);

  const addFiles = (incoming: FileList | File[]) => {
    if (busy) return;
    const next = { ...files };
    const rejected: string[] = [];
    for (const file of Array.from(incoming)) {
      const component = classify(file);
      if (!component) rejected.push(file.name);
      else next[component] = file;
    }
    setFiles(next);
    const prefixes = COMPONENTS.flatMap((component) => next[component] ? [backupSetPrefix(next[component]!, component)] : []);
    if (!sessionName.trim() && prefixes.length) setSessionName(suggestedSiteName(prefixes[0]));
    const size = COMPONENTS.reduce((sum, component) => sum + (next[component]?.size ?? 0), 0);
    setSelectionError(
      rejected.length
        ? `Not recognized as an UpdraftPlus component: ${rejected.join(", ")}`
        : new Set(prefixes).size > 1
          ? "All five files must come from the same UpdraftPlus backup set."
          : COMPONENTS.some(component => next[component] && (next[component]!.size === 0 || next[component]!.size > 1024 ** 3))
            ? "Each backup file must be between 1 byte and 1 GiB."
            : size > 2 * 1024 ** 3
              ? "The complete backup set must be 2 GiB or smaller."
          : null,
    );
  };

  return (
    <section className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>

          <p className="mt-1 max-w-3xl text-sm leading-5 text-text-secondary">Choose all five files from one UpdraftPlus backup. Restore into a new local DDEV site, review its WordPress version, then publish from DDEV.</p>
        </div>
        <span className="rounded border border-border-default bg-surface-primary/60 px-2 py-1 text-[12px] text-text-muted">Single-site backup</span>
      </div>

      {!ddevAvailable && <p role="status" className="mt-3 text-sm text-status-warning">{ddevUnavailableReason || "Restores create a local DDEV site, and the DDEV connector is not available. Configure it in Extensions."}</p>}
      <label className="mt-3 block text-sm font-medium text-text-primary" htmlFor="updraft-session-name">New site name</label>
      <input id="updraft-session-name" value={sessionName} maxLength={100} disabled={busy} onChange={(event) => setSessionName(event.target.value)} placeholder="Name your restored site" className={controlClass("default", "mt-1 w-full sm:max-w-md")} />

      <button
        type="button"
        disabled={busy}
        aria-label="Drop UpdraftPlus backup files or choose files"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
        className="mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-indigo-400/40 bg-surface-primary/40 px-4 py-5 text-center transition-colors hover:border-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <UploadCloud className="h-6 w-6 text-indigo-300" />
        <span className="mt-2 text-sm font-medium text-text-primary">Drop all five UpdraftPlus files here</span>
        <span className="mt-1 text-sm text-text-muted">or choose the five files from your backup folder</span>
      </button>
      <input ref={inputRef} type="file" multiple accept=".zip,.gz" className="sr-only" aria-label="Choose UpdraftPlus backup files" disabled={busy} onChange={(event) => event.target.files && addFiles(event.target.files)} />

      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        {COMPONENTS.map((component) => {
          const file = files[component];
          return <div key={component} className={`min-w-0 rounded border px-2.5 py-2 ${file ? "border-emerald-500/30 bg-emerald-500/[0.08]" : "border-border-muted bg-surface-primary/40"}`}>
            <div className="flex items-center gap-1.5 text-[12px] font-medium capitalize text-text-primary">{file ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <FileArchive className="h-3.5 w-3.5 text-text-muted" />}{component}</div>
            <div className="mt-1 break-all text-[12px] text-text-muted">{file ? `${file.name} · ${readableBytes(file.size)}` : "Missing"}</div>
          </div>;
        })}
      </div>

      {selectionError && <div role="alert" className="mt-3 flex gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-status-error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selectionError}</div>}
      {ddevAvailable && <PluginUpdraftRestore files={files} complete={complete} name={sessionName} onBusyChange={setRunning} />}
    </section>
  );
}
