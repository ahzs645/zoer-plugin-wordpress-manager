import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, UploadCloud } from "lucide-react";
import { api, type Computer, type WordPressBackupRestore } from "../../lib/api";
import type { WordPressUpdraftComponent, WordPressUpdraftImportManifest } from "../../lib/api/computers-client";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";

const COMPONENTS: WordPressUpdraftComponent[] = ["database", "plugins", "themes", "uploads", "others"];
const CHUNK_BYTES = 8 * 1024 * 1024;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface Props {
  ddevAvailable?: boolean;
  onRunningChange?: (running: boolean) => void;
  onImported?: (computer: Computer) => void;
  onViewSite: (computer: Computer) => void;
}

export default function WordPressUpdraftImport({ onViewSite, onImported, onRunningChange, ddevAvailable = false }: Props) {
  const [runtime, setRuntime] = useState<"ddev" | "playground">(ddevAvailable ? "ddev" : "playground");
  const [backupReview, setBackupReview] = useState<WordPressBackupRestore | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);
  const [sessionName, setSessionName] = useState("");
  const [files, setFiles] = useState<Partial<Record<WordPressUpdraftComponent, File>>>({});
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => { onRunningChange?.(running); }, [running, onRunningChange]);
  const [stage, setStage] = useState("Select all five backup files to begin.");
  const [progress, setProgress] = useState(0);
  const [createdComputer, setCreatedComputer] = useState<Computer | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const selectedPrefixes = COMPONENTS.flatMap((component) => files[component] ? [backupSetPrefix(files[component]!, component)] : []);
  const oneBackupSet = new Set(selectedPrefixes).size <= 1;
  const complete = !selectionError && oneBackupSet && COMPONENTS.every((component) => files[component]);
  const totalBytes = useMemo(() => COMPONENTS.reduce((sum, component) => sum + (files[component]?.size ?? 0), 0), [files]);

  const addFiles = (incoming: FileList | File[]) => {
    if (runningRef.current || backupReview || createdComputer) return;
    setImportId(null);
    setRunError(null);
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

  const prepareDdev = async () => {
    if (!complete || runningRef.current || backupReview) return;
    runningRef.current = true; setRunning(true); setRunError(null); setProgress(0);
    try {
      const id = importId ?? crypto.randomUUID(); setImportId(id);
      const manifest: WordPressUpdraftImportManifest = {importId:id,sessionName:sessionName.trim() || "Restored WordPress",components:[]};
      for (const component of COMPONENTS) {
        const file=files[component]!; setStage(`Verifying ${component}…`);
        manifest.components.push({component,originalName:file.name,size:file.size,sha256:await sha256(file),chunks:Math.ceil(file.size/CHUNK_BYTES)});
      }
      await api.registerWordPressBackupRestore(manifest);
      let uploaded=0;
      for(const component of COMPONENTS) {
        const file=files[component]!;
        for(let index=0; index<Math.ceil(file.size/CHUNK_BYTES); index++) {
          const bytes=file.slice(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES); setStage(`Uploading ${component}…`);
          await api.uploadWordPressBackupPart(id,component,index,bytes); uploaded+=bytes.size; setProgress(Math.round(uploaded/totalBytes*100));
        }
      }
      setStage("Validating archives and database…");
      const result=await api.prepareWordPressBackupRestore(id); setBackupReview(result); setStage("Backup checked. Review before restoring.");
    } catch(e) {setRunError(e instanceof Error?e.message:"Backup preparation failed.");}
    finally {runningRef.current=false;setRunning(false);}
  };
  const restoreDdev = async () => {
    if(!backupReview || runningRef.current) return;
    runningRef.current=true;setRunning(true);setRunError(null);
    try {
      let result=await api.restoreWordPressBackupToDdev(backupReview.id); setBackupReview(result);
      for(let attempt=0;attempt<900;attempt++) {
        if(result.copy?.error && !result.copy.running) throw new Error(result.copy.error);
        if(result.copy?.phase==="complete" && result.copy.targetId) {
          const computer=await api.getComputer(result.copy.targetId);setCreatedComputer(computer);setRestored(true);setStage("Restored. Check WordPress updates and preview the site before publishing.");onImported?.(computer);return;
        }
        setStage(`Restoring: ${result.copy?.phase ?? "creating"} · ${result.copy?.index ?? 0}/${result.copy?.totalFiles ?? 0} files`);
        await sleep(2000); result=await api.getWordPressBackupRestore(backupReview.id);setBackupReview(result);
        if(result.copy && !result.copy.running && result.copy.phase!=="complete") throw new Error("Restore paused. Retry resumes the same local site.");
      }
      throw new Error("Restore is still running on the server. Check WordPress Manager for the result.");
    } catch(e) {setRunError(e instanceof Error?e.message:"Restore failed.");}
    finally {runningRef.current=false;setRunning(false);}
  };

  const importBackup = async () => {
    if (!complete || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setSelectionError(null);
    setRunError(null);
    setWarnings([]);
    setProgress(0);
    setRestored(false);
    let computer: Computer | null = createdComputer;
    try {
      const name = createdComputer?.name ?? (sessionName.trim() || "Imported WordPress site");
      if (!computer) {
        setStage("Creating a separate local WordPress site…");
        computer = await api.createComputer({ name, runtime: "docker", runtimeProfile: "wordpress-playground", aiMode: "api" });
        setCreatedComputer(computer);
      } else {
        setStage("Resuming restore on the created local site…");
        computer = await api.getComputer(computer.id);
        if (computer.status === "stopped") await api.startComputer(computer.id);
      }
      for (let attempt = 0; attempt < 120; attempt += 1) {
        computer = await api.getComputer(computer.id);
        setCreatedComputer(computer);
        if (computer.status === "running") break;
        if (attempt === 119) throw new Error("The new WordPress session did not start within four minutes.");
        await sleep(2000);
      }

      const currentImportId = importId ?? crypto.randomUUID();
      setImportId(currentImportId);
      const manifest: WordPressUpdraftImportManifest = { importId: currentImportId, sessionName: name, components: [] };
      let uploadedBytes = 0;
      for (const component of COMPONENTS) {
        const file = files[component]!;
        setStage(`Verifying ${component} (${readableBytes(file.size)})…`);
        const digest = await sha256(file);
        const chunks = Math.ceil(file.size / CHUNK_BYTES);
        for (let index = 0; index < chunks; index += 1) {
          const start = index * CHUNK_BYTES;
          const end = Math.min(file.size, start + CHUNK_BYTES);
          const part = new File([file.slice(start, end)], `${String(index).padStart(6, "0")}.part`, { type: "application/octet-stream" });
          setStage(`Uploading ${component} chunk ${index + 1} of ${chunks}…`);
          await api.uploadFiles(computer.id, `/workspace/.zoer/updraft-import/${currentImportId}/parts/${component}`, [part]);
          uploadedBytes += end - start;
          setProgress(Math.round((uploadedBytes / totalBytes) * 100));
        }
        manifest.components.push({ component, originalName: file.name, size: file.size, sha256: digest, chunks });
      }

      setStage("Checking the backup and rebuilding WordPress…");
      await api.prepareWordPressUpdraftImport(computer.id, manifest);
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await sleep(2000);
        const status = await api.getWordPressUpdraftImportStatus(computer.id, currentImportId);
        if (status.state === "failed") throw new Error(status.error || "WordPress import failed.");
        if (status.state === "completed") {
          setStage("Waiting for the restored website to start…");
          let ready = await api.getComputer(computer.id);
          for (let attempt = 0; ready.status !== "running" && attempt < 120; attempt += 1) {
            await sleep(2000);
            ready = await api.getComputer(computer.id);
          }
          if (ready.status !== "running") throw new Error("The backup was restored, but the website did not become ready within four minutes. Check its status in WordPress Manager.");
          setCreatedComputer(ready);
          setWarnings(status.warnings ?? []);
          setProgress(100);
          setStage("Import complete. Your restored site is ready.");
          setRestored(true);
          onImported?.(ready);
          return;
        }
        setStage(status.state === "restarting" ? "Restarting the WordPress session…" : "Applying the database, plugins, themes, and uploads…");
      }
      throw new Error("The import did not finish within eight minutes.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unable to import the backup.";
      setRunError(`${detail}${computer ? " The created local site was kept. Retry in this dialog will reuse it." : ""}`);
      setStage("Import stopped.");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <section className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>

          <p className="mt-1 max-w-3xl text-sm leading-5 text-text-secondary">Choose all five files from one UpdraftPlus backup. Restore into a separate local site, review its WordPress version, then publish from DDEV.</p>
        </div>
        <span className="rounded border border-border-default bg-surface-primary/60 px-2 py-1 text-[12px] text-text-muted">Single-site backup</span>
      </div>

      <label className="mt-3 block text-sm">Restore to<Select aria-label="Backup restore runtime" value={runtime} disabled={running || !!backupReview || !!createdComputer} onChange={e=>setRuntime(e.target.value as "ddev"|"playground")}><option value="ddev" disabled={!ddevAvailable}>DDEV · review and publish to Hostinger</option><option value="playground">Playground · local preview</option></Select></label>
      <label className="mt-3 block text-sm font-medium text-text-primary" htmlFor="updraft-session-name">New site name</label>
      <input id="updraft-session-name" value={sessionName} maxLength={100} disabled={running || Boolean(createdComputer) || !!backupReview} onChange={(event) => { setSessionName(event.target.value); if (!createdComputer) setImportId(null); }} placeholder="Name your restored site" className={controlClass("default", "mt-1 w-full sm:max-w-md")} />

      <button
        type="button"
        disabled={running || !!backupReview || !!createdComputer}
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
      <input ref={inputRef} type="file" multiple accept=".zip,.gz" className="sr-only" aria-label="Choose UpdraftPlus backup files" disabled={running || !!backupReview || !!createdComputer} onChange={(event) => event.target.files && addFiles(event.target.files)} />

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
      {runError && <div role="alert" className="mt-3 flex gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-status-error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{runError}</div>}
      {warnings.length > 0 && <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-200">{warnings.join(" ")}</div>}
      {(running || progress > 0) && <div className="mt-3"><div className="flex justify-between text-[12px] text-text-secondary"><span>{stage}</span><span>{progress}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-primary"><div className="h-full bg-indigo-400 transition-all" style={{ width: `${progress}%` }} /></div></div>}

      {backupReview && <div className="mt-4 space-y-2 text-sm" aria-label="Backup review"><p>Backup WordPress: <strong>{backupReview.metadata?.wordpressVersion}</strong> · {backupReview.fileCount.toLocaleString()} files · {backupReview.metadata?.tables} tables</p><p>Original address: {backupReview.metadata?.sourceUrl}</p>{backupReview.warnings.map(w=><p key={w} className="text-text-secondary">{w}</p>)}{!restored && <Btn variant="primary" loading={running} disabled={running} onClick={()=>void restoreDdev()}>{backupReview.copy ? "Resume restore" : "Restore into a new DDEV site"}</Btn>}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!backupReview && <Btn variant="primary" loading={running} disabled={!complete || running || restored} onClick={() => void (runtime === "ddev" ? prepareDdev() : importBackup())}>{running ? "Preparing backup…" : runtime === "ddev" ? "Check backup before restore" : createdComputer ? "Retry restore on this site" : "Restore and start local site"}</Btn>}
        {createdComputer && !running && restored && <Btn onClick={() => onViewSite(createdComputer)}>View site in WordPress Manager</Btn>}
        {!complete && !selectionError && <span className="text-[12px] text-text-muted">Add each required component to enable import.</span>}
      </div>
    </section>
  );
}
