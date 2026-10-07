import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, UploadCloud } from "lucide-react";
import { controlClass, Select } from "@zoer/plugin-ui/controls";
import { backupComponents, backupIdentity, backupSelectionError, classifyBackup, type BackupComponent, type BackupFormat } from "./backupFiles";
import PluginUpdraftRestore from "./pluginEngine/PluginUpdraftRestore";

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
 * Select a supported backup pair or five-component set for the resumable local restore.
 */
export default function WordPressUpdraftImport({ onRunningChange, ddevAvailable = false, ddevUnavailableReason = null }: Props) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sessionName, setSessionName] = useState("");
  const [files, setFiles] = useState<Partial<Record<BackupComponent, File>>>({});
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [format, setFormat] = useState<BackupFormat>("updraft");
  const components = backupComponents(format);
  const complete = !selectionError && !backupSelectionError(files, format) && components.every(c => files[c]);
  const setRunning = useCallback((value: boolean) => { setBusy(value); onRunningChange?.(value); }, [onRunningChange]);

  const addFiles = (incoming: FileList | File[]) => {
    if (busy) return;
    const next = { ...files };
    const rejected: string[] = [];
    const incomingComponents = new Set<BackupComponent>();
    for (const file of Array.from(incoming)) {
      const component = classifyBackup(file.name, format);
      if (!component) rejected.push(file.name);
      else if (incomingComponents.has(component)) rejected.push(`duplicate ${component}: ${file.name}`);
      else { incomingComponents.add(component); next[component] = file; }
    }
    setFiles(next);
    const first = components.find(c => next[c]);
    if (!sessionName.trim() && first) {
      try { const identity = backupIdentity(next[first]!.name, first, format); setSessionName(format === "hostinger" ? identity.split(".").slice(1,-1).join(".").replace(/-/g," ") : suggestedSiteName(identity)); } catch { /* Selection error below explains invalid filenames. */ }
    }
    setSelectionError(rejected.length ? `Not recognized as a ${format === "hostinger" ? "Hostinger backup file" : "UpdraftPlus component"}: ${rejected.join(", ")}` : backupSelectionError(next, format));
  };

  return (
    <section className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>

          <p className="mt-1 max-w-3xl text-sm leading-5 text-text-secondary">Choose a supported backup and restore it into a new local DDEV site. Review its WordPress version and activate the required plugins before publishing.</p>
        </div>
        <span className="rounded border border-border-default bg-surface-primary/60 px-2 py-1 text-[12px] text-text-muted">Single-site backup</span>
      </div>

      {!ddevAvailable && <p role="status" className="mt-3 text-sm text-status-warning">{ddevUnavailableReason || "Restores create a local DDEV site, and the DDEV connector is not available. Configure it in Extensions."}</p>}
      <label className="mt-3 block text-sm font-medium text-text-primary">Backup format
        <Select aria-label="Backup format" value={format} disabled={busy} className={controlClass("default", "mt-1 w-full sm:max-w-md")} onChange={event => { setFormat(event.target.value as BackupFormat); setFiles({}); setSelectionError(null); if (inputRef.current) inputRef.current.value = ""; }}>
          <option value="updraft">UpdraftPlus · five backup files</option>
          <option value="hostinger">Hostinger · website archive and database dump</option>
        </Select>
      </label>
      {format === "hostinger" && <p className="mt-2 text-sm text-text-secondary">Choose the matching .tar.gz website archive and .sql.gz database dump downloaded from hPanel. Keep their original filenames. Core, server configuration, caches and must-use plugins are omitted.</p>}
      <label className="mt-3 block text-sm font-medium text-text-primary" htmlFor="updraft-session-name">New site name</label>
      <input id="updraft-session-name" value={sessionName} maxLength={100} disabled={busy} onChange={(event) => setSessionName(event.target.value)} placeholder="Name your restored site" className={controlClass("default", "mt-1 w-full sm:max-w-md")} />

      <button
        type="button"
        disabled={busy}
        aria-label="Drop WordPress backup files or choose files"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
        className="mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-indigo-400/40 bg-surface-primary/40 px-4 py-5 text-center transition-colors hover:border-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <UploadCloud className="h-6 w-6 text-indigo-300" />
        <span className="mt-2 text-sm font-medium text-text-primary">{format === "hostinger" ? "Drop the website archive and database dump here" : "Drop all five UpdraftPlus files here"}</span>
        <span className="mt-1 text-sm text-text-muted">{format === "hostinger" ? "or choose both files from your backup folder" : "or choose the five files from your backup folder"}</span>
      </button>
      <input ref={inputRef} type="file" multiple accept=".zip,.gz" className="sr-only" aria-label="Choose WordPress backup files" disabled={busy} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />

      <div className={`mt-3 grid gap-2 ${format === "hostinger" ? "sm:grid-cols-2" : "sm:grid-cols-5"}`}>
        {components.map((component) => {
          const file = files[component];
          return <div key={component} className={`min-w-0 rounded border px-2.5 py-2 ${file ? "border-emerald-500/30 bg-emerald-500/[0.08]" : "border-border-muted bg-surface-primary/40"}`}>
            <div className="flex items-center gap-1.5 text-[12px] font-medium capitalize text-text-primary">{file ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <FileArchive className="h-3.5 w-3.5 text-text-muted" />}{component}</div>
            <div className="mt-1 break-all text-[12px] text-text-muted">{file ? `${file.name} · ${readableBytes(file.size)}` : "Missing"}</div>
          </div>;
        })}
      </div>

      {selectionError && <div role="alert" className="mt-3 flex gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-status-error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selectionError}</div>}
      {ddevAvailable && <PluginUpdraftRestore format={format} files={files} complete={complete} name={sessionName} onBusyChange={setRunning} />}
    </section>
  );
}
