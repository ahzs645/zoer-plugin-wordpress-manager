import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, Select, Modal, InlineAlert } from "@zoer/plugin-ui/controls";
import { isDemoMode } from "@zoer/plugin-ui/workspace";
import { json } from "../../lib/api/_http";
import { wordpressKeys } from "../../lib/queries/wordpress";

interface Policy { profile: string; idleMinutes: number; wakeOnRequest: boolean; persistenceReady: boolean; lastActivityAt: string }
interface Storage { filesBytes: number | null; databaseBytes: number | null; recoveryAndStagingBytes: number | null; backupsBytes: number | null; completedStaging: { bytes: number | null; files: number }; note: string }
interface Resources { policy: Policy; storage?: Storage; containers: Array<{ name: string; service: string; memoryBytes: number | null; memoryLimitBytes: number | null; cpuPercent: number | null; cpuLimit: number | null; restarts: number | null; oomKilled: boolean | null }> | null; host: { availableMemoryBytes: number | null; freeDiskBytes: number }; queue: { running: number; queued: number; limit: number } }
const bytes = (value: number | null) => value === null ? "Unknown" : value < 1024 ? `${Math.round(value)} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(0)} MiB`;

export default function WordPressResources({ siteId, running }: { siteId: string; running: boolean }) {
  const client = useQueryClient();
  const path = `/wordpress-manager/sites/${encodeURIComponent(siteId)}/resources`;
  const key = [...wordpressKeys.all(), "resources", siteId];
  const query = useQuery({ queryKey: key, queryFn: () => json<Resources>(path), enabled: !isDemoMode(), refetchInterval: 15_000 });
  const [draft, setDraft] = useState<Policy | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [storage, setStorage] = useState<Storage | null>(null), [cleanup, setCleanup] = useState(false);
  const state = query.data;
  const restartRequired = running && !!draft && (draft.profile !== state?.policy.profile || !state?.policy.persistenceReady);
  async function apply() {
    if (!draft || busy) return;
    setBusy(true); setError(null);
    try {
      await json(path, { method: "PUT", body: JSON.stringify({ profile: draft.profile, idleMinutes: draft.idleMinutes, wakeOnRequest: draft.wakeOnRequest }) });
      setDraft(null); await client.invalidateQueries({ queryKey: wordpressKeys.all() });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function inspectStorage(remove = false) {
    if (busy) return; setBusy(true); setError(null);
    try { if (remove) { await json(path + "/cleanup", { method: "POST" }); setCleanup(false); } setStorage((await json<Resources>(path + "?storage=1")).storage ?? null); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <section aria-label="Site resources" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="sr-only">Site resources</h4><Btn size="sm" disabled={!state} onClick={() => { setDraft(state!.policy); setError(null); }}>Resource settings</Btn></div>
    {query.error && <InlineAlert error={query.error} onRetry={() => void query.refetch()} />}
    {!state && !query.error && <p role="status" className="text-sm text-text-secondary">Reading resource measurements…</p>}
    {state && <>
      <p className="text-sm text-text-secondary">{state.policy.profile === "unmanaged" ? "Existing container settings" : `${state.policy.profile} profile`} · {state.policy.idleMinutes ? `Sleep after ${state.policy.idleMinutes} minutes idle` : "Keep running"} · {state.policy.wakeOnRequest ? "Wake when opened" : "Start manually"}</p>
      {!state.containers ? <p className="text-sm">Measurements unavailable.</p> : !state.containers.length ? <p className="text-sm">Site is stopped; its files and database remain saved.</p> : <div className="grid gap-2 sm:grid-cols-2">{state.containers.map(row => <div key={row.name} className="min-w-0 rounded-md border border-border-muted p-3 text-sm"><strong>{row.service || "Service"}</strong><p>Memory: {bytes(row.memoryBytes)} · limit {row.memoryLimitBytes ? bytes(row.memoryLimitBytes) : "not configured"}</p><p>CPU: {row.cpuPercent === null ? "Unknown" : `${row.cpuPercent.toFixed(2)}%`} · limit {row.cpuLimit === null ? "not configured" : `${row.cpuLimit} cores`}</p><p>Restarts: {row.restarts ?? "Unknown"}{row.oomKilled ? " · Out of memory" : ""}</p></div>)}</div>}
      <p className="text-xs text-text-secondary">Host memory available: {bytes(state.host.availableMemoryBytes)} · Free disk: {(state.host.freeDiskBytes / 1024 ** 3).toFixed(1)} GiB · Heavy operations: {state.queue.running} running, {state.queue.queued} queued.</p>
      <p className="text-xs text-text-secondary">{state.policy.persistenceReady ? "Private recovery and transfer storage is prepared for stop/start." : "Private recovery storage will be preserved when settings are applied or the site is stopped."}</p>
      <Btn size="sm" disabled={busy} loading={busy && !draft} onClick={() => void inspectStorage()}>Measure site storage</Btn>
      {storage && <div className="space-y-2 text-sm"><p>Site files: {bytes(storage.filesBytes)} · Database: {bytes(storage.databaseBytes)} · Recovery and staging: {bytes(storage.recoveryAndStagingBytes)} · Backups: {bytes(storage.backupsBytes)}</p><p className="text-xs text-text-secondary">{storage.note}</p>{!!storage.completedStaging.files && <Btn size="sm" disabled={busy} onClick={() => setCleanup(true)}>Clean completed staging ({bytes(storage.completedStaging.bytes)})</Btn>}</div>}
    </>}
    {error != null && !draft && <InlineAlert error={error} />}
    {cleanup && <Modal title="Clean completed staging" onClose={() => { if (!busy) setCleanup(false); }} footer={<><Btn disabled={busy} onClick={() => setCleanup(false)}>Cancel</Btn><Btn variant="danger" loading={busy} onClick={() => void inspectStorage(true)}>Delete completed staged files</Btn></>}><p>Delete transferred file bytes only from copies with a verified completion receipt and no pending marker. Saved downloads, site files, databases, recovery receipts and backups remain retained. Older copies without a completion receipt are left in place.</p></Modal>}
    {draft && <Modal title="Site resource settings" onClose={() => { if (!busy) setDraft(null); }} footer={<><Btn disabled={busy} onClick={() => setDraft(null)}>Cancel</Btn><Btn variant="primary" loading={busy} onClick={() => void apply()}>{restartRequired ? "Save and restart site" : "Save settings"}</Btn></>}><div className="space-y-4 text-sm">
      <label className="block space-y-1"><span>Resource profile</span><Select aria-label="Resource profile" value={draft.profile} onChange={e => setDraft({ ...draft, profile: e.target.value })}><option value="unmanaged">Existing container settings</option><option value="preview">Preview · web 512 MiB, database 384 MiB</option><option value="development">Development · web 1 GiB, database 768 MiB</option><option value="large">Large operation · web 2 GiB, database 1 GiB</option></Select></label>
      <label className="block space-y-1"><span>When idle</span><Select aria-label="When idle" value={String(draft.idleMinutes)} onChange={e => setDraft({ ...draft, idleMinutes: Number(e.target.value) })}><option value="0">Keep running</option><option value="5">Sleep after 5 minutes</option><option value="30">Sleep after 30 minutes</option><option value="60">Sleep after 1 hour</option><option value="120">Sleep after 2 hours</option></Select></label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={draft.wakeOnRequest} onChange={e => setDraft({ ...draft, wakeOnRequest: e.target.checked })} />Wake when the site is opened</label>
      <p>Active transfers, terminals and managed operations prevent sleeping. Inventory and resource polling do not keep the site awake. Limits apply to all processes in each container.</p>
      {restartRequired && <p>Saving preserves private recovery files and restarts this local site. Wait until other work has finished.</p>}
      {error != null && <InlineAlert error={error} />}
    </div></Modal>}
  </section>;
}
