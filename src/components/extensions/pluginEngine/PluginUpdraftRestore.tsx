import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Btn, CheckboxField } from "@zoer/plugin-ui/controls";
import { backupComponents, type BackupComponent, type BackupFormat } from "../backupFiles";
import { engineKeys, filesets, startEngineAction, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { wordpressQueries } from "../../../lib/queries/wordpress";
import { sha256 } from "../updraftFiles";
import PluginRunCard from "./PluginRunCard";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";
import { planUpload, plannedBytes, sameManifest } from "./uploadPlan";

const RESTORE_ACTIONS = [ENGINE_ACTIONS.restore] as const;

type Entry = { path: string; bytes: number; sha256: string };

/** An earlier upload of exactly these backup files (open or sealed), so a reload resumes instead of re-uploading. */
async function findUpload(entries: Entry[], format: BackupFormat) {
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const { sets } = await filesets.list({ key: "kind", value: `${format}-upload` });
  for (const set of sets) {
    if (set.entryCount !== entries.length || set.totalBytes !== total) continue;
    const described = await filesets.describe(set.id);
    if (sameManifest(described.entries, entries)) return described.set;
  }
  return null;
}

/**
 * Backup uploads use the format-specific rules and resumable verified file sets.
 * The local restore action creates a DDEV site; dry runs inspect without creating one.
 */
export default function PluginUpdraftRestore({ files, complete, name, onBusyChange, format = "updraft" }: {
  format?: BackupFormat; files: Partial<Record<BackupComponent, File>>; complete: boolean; name: string; onBusyChange?: (busy: boolean) => void;
}) {
  const components = backupComponents(format);
  const client = useQueryClient();
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [setId, setSetId] = useState<string | null>(null);
  const runs = useRecentRuns(RESTORE_ACTIONS);
  const related = (runs.data ?? []).filter(run => (setId && runInput(run).uploadSetId === setId) || !isTerminalStatus(run.status)).slice(0, 5);
  const active = related.some(run => !isTerminalStatus(run.status));
  const restored = related.some(run => run.status === "succeeded" && runInput(run).dryRun !== true);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { onBusyChange?.(busy || active); }, [busy, active, onBusyChange]);
  // Files changed: the uploaded set no longer matches the selection.
  const key = format + components.map(component => files[component] ? `${files[component]!.name}:${files[component]!.size}:${files[component]!.lastModified}` : "").join("|");
  useEffect(() => { setSetId(null); setProgress(0); setStage(""); setError(""); }, [key]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const done = related.filter(run => run.status === "succeeded" && runInput(run).dryRun !== true && !seen.current.has(run.runId));
    if (!done.length) return;
    for (const run of done) seen.current.add(run.runId);
    void client.invalidateQueries({ queryKey: wordpressQueries.sites().queryKey });
  }, [related, client]);

  const restoreName = name.trim() || "Restored WordPress";
  async function upload(): Promise<string> {
    const ordered = components.map(component => files[component]!);
    const entries: Entry[] = [];
    for (const [index, file] of ordered.entries()) {
      setStage(`Verifying ${components[index]}…`);
      entries.push({ path: file.name, bytes: file.size, sha256: await sha256(file) });
      if (!alive.current) throw new Error("Closed.");
    }
    setStage("Checking for an earlier upload…");
    let set = await findUpload(entries, format);
    if (!set) {
      setStage("Creating the upload…");
      set = (await filesets.create({ name: `${format === "hostinger" ? "Hostinger" : "UpdraftPlus"} · ${restoreName}`.slice(0, 120), entries, rules: format === "hostinger" ? "hostinger-backup" : "updraft-set", labels: { kind: `${format}-upload` } })).set;
    }
    setSetId(set.id);
    if (set.status !== "sealed") {
      const status = await filesets.status(set.id);
      const tasks = planUpload(entries, status);
      const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      let done = total - plannedBytes(tasks);
      setProgress(total ? Math.round(done / total * 100) : 0);
      const byPath = new Map(ordered.map(file => [file.name, file]));
      for (const task of tasks) {
        if (!alive.current) throw new Error("Closed.");
        setStage(`Uploading ${task.path} · part ${task.index + 1}`);
        await filesets.put({ setId: set.id, path: task.path, index: task.index, chunk: byPath.get(task.path)!.slice(task.start, task.end) });
        done += task.end - task.start;
        setProgress(total ? Math.round(done / total * 100) : 100);
      }
      setStage("Verifying the upload on the Zoer server…");
      await filesets.seal(set.id);
    }
    setProgress(100);
    return set.id;
  }

  async function start(real: boolean) {
    if (!complete || busy) return;
    setBusy(true); setError("");
    try {
      const uploadSetId = setId ?? await upload();
      setStage(real ? "Starting the restore…" : "Starting the dry run…");
      await startEngineAction(ENGINE_ACTIONS.restore, { uploadSetId, restoreId: newHexId(), name: restoreName.slice(0, 100), ...(real ? {} : { dryRun: true }) });
      setStage(real ? "Restore started. It continues on the Zoer server if you close this dialog." : "Dry run started.");
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) {
      if (alive.current) { setError(engineErrorMessage(caught, "The backup could not be uploaded.")); setStage(""); }
    } finally { if (alive.current) setBusy(false); }
  }

  const lastDry = related.find(run => runInput(run).dryRun === true && run.status === "succeeded" && runInput(run).uploadSetId === setId);
  return <div className="mt-3 min-w-0 space-y-3 rounded-lg border border-status-warning/40 p-3">
    <p className="text-sm text-text-secondary">WordPress Manager uploads the backup files to the Zoer server as one verified set, then restores them into a new local DDEV site. Uploads resume after a reload when you choose the same files again.</p>
    <CheckboxField label="Dry run" description="Inspects the archive and plans the restore without creating a site. The database and every extracted file are checked during the actual restore." checked={dryRun} onChange={setDryRun} disabled={busy} />
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Btn variant="primary" className="w-full sm:w-auto" loading={busy} disabled={!complete || busy || active || restored} onClick={() => void start(!dryRun)}>{setId ? (dryRun ? "Run another dry run" : "Restore into a new DDEV site") : dryRun ? "Upload and check (dry run)" : "Upload and restore"}</Btn>
      {lastDry && !dryRun && <span className="self-center text-xs text-text-secondary">Uses the files already uploaded for the dry run.</span>}
    </div>
    {!complete && <p className="text-[12px] text-text-muted">Add each required component to enable the restore.</p>}
    {(busy || progress > 0) && stage && <div><div className="flex justify-between gap-2 text-[12px] text-text-secondary"><span className="min-w-0 break-words">{stage}</span><span className="tabular-nums">{progress}%</span></div><progress aria-label="Backup upload progress" className="mt-1 h-1.5 w-full accent-indigo-500" value={progress} max={100} /></div>}
    {error && <div role="alert" className="flex gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-status-error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
    {runs.error && <p role="alert" className="text-sm text-status-error">Could not load restores: {engineErrorMessage(runs.error)}</p>}
    {related.map(run => <PluginRunCard key={run.runId} recent={run} title={runInput(run).dryRun === true ? "Restore dry run" : "Restore"} />)}
  </div>;
}
