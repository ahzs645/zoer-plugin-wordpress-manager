import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, Modal, Field, InlineAlert, Select } from "@zoer/plugin-ui/controls";
import { json } from "../../lib/api/_http";
import { wordpressKeys } from "../../lib/queries/wordpress";

import WordPressKubernetesSleep, { type PilotSleepPolicy } from "./WordPressKubernetesSleep";

/** A copy's files and database saved once in Zoer, to create or refresh copies from. */
interface Baseline { id: string; name: string; status: "creating" | "ready" | "failed"; error?: string; source: { siteId: string; name: string; url: string }; createdAt: string; wordpressVersion?: string; files?: { bytes: number }; database?: { bytes: number } }
interface BaselineOperation { id: string; kind: "capture" | "create-copy" | "refresh"; baselineId: string; siteId?: string; name?: string; status: "running" | "succeeded" | "failed"; error?: string; startedAt: string; finishedAt?: string; recoveryBackupId?: string }
const size = (bytes = 0) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
const OPERATION_LABELS = { capture: "Saving baseline", "create-copy": "Creating copy", refresh: "Refreshing copy" } as const;

export default function WordPressKubernetesPilot({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: [...wordpressKeys.all(), "kubernetes-pilot"], queryFn: () => json<{ enabled: boolean; maxSites?: number; sites: Array<{ id: string; name: string; status: string; url: string | null; policy: PilotSleepPolicy; backups: Array<{ id: string; createdAt: string }>; measurements: Array<{service:string;memoryBytes:number;cpuPercent:number}> | null }> }>("/wordpress-manager/runtime-pilots"), refetchInterval: 5000 });
  const [name, setName] = useState(""), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [selectedBackups, setSelectedBackups] = useState<Record<string, string>>({});
  const [restore, setRestore] = useState<{ id: string; backupId: string } | null>(null);
  const baselinesQuery = useQuery({ queryKey: [...wordpressKeys.all(), "kubernetes-baselines"], queryFn: () => json<{ baselines: Baseline[]; operations: BaselineOperation[] }>("/wordpress-manager/runtime-pilots/baselines"), refetchInterval: q => q.state.data?.operations.some(op => op.status === "running") || q.state.data?.baselines.some(b => b.status === "creating") ? 3000 : 15000 });
  const baselines = baselinesQuery.data?.baselines ?? [], operations = baselinesQuery.data?.operations ?? [];
  const ready = baselines.filter(b => b.status === "ready");
  const [baselineNames, setBaselineNames] = useState<Record<string, string>>({}), [copyNames, setCopyNames] = useState<Record<string, string>>({});
  const [refreshChoice, setRefreshChoice] = useState<Record<string, string>>({}), [refresh, setRefresh] = useState<{ id: string; name: string; baselineId: string } | null>(null);
  const busySite = (siteId: string) => operations.some(op => op.status === "running" && op.siteId === siteId);
  async function baselineAction(label: string, path: string, body?: unknown, method = "POST") {
    if (busy) return;
    setBusy(label); setError(null);
    try { await json(`/wordpress-manager/runtime-pilots${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); setRefresh(null); await baselinesQuery.refetch(); await query.refetch(); await client.invalidateQueries({ queryKey: wordpressKeys.all() }); return true; }
    catch (e) { setError(e); return false; } finally { setBusy(null); }
  }
  async function act(id: string, operation: string, body: unknown = {}) {
    if (busy) return;
    setBusy(id || "create"); setError(null);
    try {
      const result = await json<any>(`/wordpress-manager/runtime-pilots${id ? `/${encodeURIComponent(id)}/${operation}` : ""}`, { method: "POST", body: JSON.stringify(body) });
      setReceipts(old => ({ ...old, [id]: result.backupId ? `Backup retained: ${result.backupId}${result.restored ? `. Restored ${result.restored}; the prior state is saved in the new backup.` : ""}` : result.stdout ? `WordPress ${result.stdout.trim()}` : operation === "create" ? "Pilot created." : `${operation === "start" ? "Starting" : "Stopped"}.` }));
      setRestore(null); if (!id) setName(""); await query.refetch(); await client.invalidateQueries({ queryKey: wordpressKeys.all() });
    } catch (e) { setError(e); await query.refetch(); } finally { setBusy(null); }
  }
  return <Modal title="Kubernetes WordPress pilot" onClose={() => { if (!busy) onClose(); }} footer={<Btn disabled={!!busy} onClick={onClose}>Done</Btn>}><div className="space-y-4 text-sm">
    <p>Experimental: each pilot runs WordPress and MariaDB directly on Kubernetes, with separate retained volumes and explicit resource budgets. Storage stays on the selected node. Transfers use the managed copy workflow. Admin auto-login is not available for this runtime.</p>
    {error != null && <InlineAlert error={error} onDismiss={() => setError(null)} />}
    {query.error != null && <InlineAlert error={query.error} onRetry={() => void query.refetch()} />}
    {query.data?.enabled && <div className="space-y-2"><Field label="Pilot name" value={name} onChange={setName} disabled={!!busy} /><Btn variant="primary" loading={busy === "create"} disabled={!!busy || !name.trim() || name.length > 80} onClick={() => void act("", "create", { name })}>Create Kubernetes pilot</Btn><p className="text-xs text-text-secondary">Creates a new development site. Preparation can take several minutes.</p></div>}
    {query.data && !query.data.enabled && <p>The operator has not enabled this pilot.</p>}
    {query.data?.sites.map(site => <section key={site.id} className="rounded-md border border-border-default p-3 space-y-2"><h4 className="font-semibold break-words">{site.name}</h4><p>{site.status}</p><WordPressKubernetesSleep siteId={site.id} policy={site.policy} onSaved={() => query.refetch()} /><a className="inline-flex min-h-11 items-center underline" href={`#/plugins/wordpress-manager?site=${encodeURIComponent(site.id)}`} onClick={onClose}>Manage transfers</a><div className="flex flex-wrap gap-2">
      <Btn size="sm" disabled={!!busy} loading={busy === site.id} onClick={() => void act(site.id, site.status === "stopped" ? "start" : "stop")}>{site.status === "stopped" ? "Start pilot" : "Stop pilot"}</Btn>
      {site.status === "running" && <><Btn size="sm" disabled={!!busy} onClick={() => void act(site.id, "inspect")}>Read WordPress version</Btn><Btn size="sm" disabled={!!busy} onClick={() => void act(site.id, "backup")}>Back up pilot</Btn>{ready.length > 0 && <><Select aria-label={`Baseline to refresh ${site.name} from`} disabled={!!busy || busySite(site.id)} value={refreshChoice[site.id] ?? ready[0]!.id} onChange={e => setRefreshChoice(old => ({ ...old, [site.id]: e.target.value }))}>{ready.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</Select><Btn size="sm" disabled={!!busy || busySite(site.id)} onClick={() => setRefresh({ id: site.id, name: site.name, baselineId: refreshChoice[site.id] ?? ready[0]!.id })}>Refresh from baseline</Btn></>}{site.backups.length > 0 && <><Select aria-label="Backup to restore" disabled={!!busy} value={selectedBackups[site.id] ?? site.backups.at(-1)!.id} onChange={e => setSelectedBackups(old => ({ ...old, [site.id]: e.target.value }))}>{site.backups.map((backup, i) => <option key={backup.id} value={backup.id}>Backup {i + 1} · {backup.id.slice(0, 8)}</option>)}</Select><Btn size="sm" disabled={!!busy} onClick={() => setRestore({ id: site.id, backupId: selectedBackups[site.id] ?? site.backups.at(-1)!.id })}>Restore backup</Btn></>}</>}
      {site.status === "running" && site.url && <a className="inline-flex min-h-11 items-center underline" href={site.url} target="_blank" rel="noreferrer">Open pilot</a>}
    </div>
    {site.status === "running" && <div className="flex flex-wrap items-end gap-2"><Field label="Baseline name" value={baselineNames[site.id] ?? ""} onChange={v => setBaselineNames(old => ({ ...old, [site.id]: v }))} disabled={!!busy || busySite(site.id)} placeholder={`${site.name} baseline`} /><Btn size="sm" disabled={!!busy || busySite(site.id)} loading={busy === `baseline:${site.id}`} onClick={async () => { const name = (baselineNames[site.id] ?? "").trim() || `${site.name} baseline`; if (await baselineAction(`baseline:${site.id}`, `/${encodeURIComponent(site.id)}/baseline`, { name })) setBaselineNames(old => ({ ...old, [site.id]: "" })); }}>Save as baseline</Btn></div>}
    {busySite(site.id) && <p role="status" className="text-sm">{OPERATION_LABELS[operations.find(op => op.status === "running" && op.siteId === site.id)!.kind]}…</p>}
    <p className="text-xs text-text-secondary">Budgets: web 1 GiB / 2 CPU; database 768 MiB / 1 CPU. {site.measurements?.length ? site.measurements.map(m => `${m.service}: ${(m.memoryBytes / 1024 ** 2).toFixed(0)} MiB, ${m.cpuPercent.toFixed(2)}% CPU`).join(" · ") : "Measurements unavailable while stopped or before the first sample."}</p>{receipts[site.id] && <p role="status" className="break-all">{receipts[site.id]}</p>}</section>)}
    {receipts[""] && <p role="status">{receipts[""]}</p>}
    {query.data?.enabled && <section aria-label="Site baselines" className="space-y-2">
      <h4 className="font-semibold">Baselines</h4>
      <p className="text-xs text-text-secondary">A baseline saves a copy's files and database once in Zoer. Create new copies from it, or refresh a copy back to it, without fetching the original website again. Each copy gets its own files and database, so changing or refreshing one never changes another. wp-config.php is not included.{query.data.maxSites ? ` Up to ${query.data.maxSites} copies.` : ""}</p>
      {baselinesQuery.error != null && <InlineAlert error={baselinesQuery.error} onRetry={() => void baselinesQuery.refetch()} />}
      {!baselines.length && baselinesQuery.data && <p className="text-sm text-text-muted">No baselines yet. Use Save as baseline on a running copy.</p>}
      {baselines.map(b => <div key={b.id} className="min-w-0 space-y-2 rounded-md border border-border-default p-3">
        <p className="break-words text-sm"><span className="font-medium">{b.name}</span> · from {b.source.name} · {new Date(b.createdAt).toLocaleString()}{b.wordpressVersion ? ` · WordPress ${b.wordpressVersion}` : ""}{b.files && b.database ? ` · ${size(b.files.bytes)} files, ${size(b.database.bytes)} database` : ""}</p>
        {b.status === "creating" && <p role="status" className="text-sm">Saving…</p>}
        {b.status === "failed" && <p role="alert" className="break-words text-sm text-status-error">{b.error ?? "Saving failed."}</p>}
        <div className="flex flex-wrap items-end gap-2">
          {b.status === "ready" && <><Field label="New copy name" value={copyNames[b.id] ?? ""} onChange={v => setCopyNames(old => ({ ...old, [b.id]: v }))} disabled={!!busy} placeholder={`${b.name} copy`} /><Btn size="sm" variant="primary" disabled={!!busy || (!!query.data?.maxSites && (query.data?.sites.length ?? 0) >= query.data.maxSites)} loading={busy === `copy:${b.id}`} onClick={async () => { const name = (copyNames[b.id] ?? "").trim() || `${b.name} copy`; if (await baselineAction(`copy:${b.id}`, `/baselines/${encodeURIComponent(b.id)}/copies`, { name })) setCopyNames(old => ({ ...old, [b.id]: "" })); }}>New copy from baseline</Btn></>}
          <Btn size="sm" variant="danger" disabled={!!busy || operations.some(op => op.status === "running" && op.baselineId === b.id)} onClick={() => void baselineAction(`delete:${b.id}`, `/baselines/${encodeURIComponent(b.id)}`, undefined, "DELETE")}>Delete baseline</Btn>
        </div>
      </div>)}
      {operations.length > 0 && <div className="space-y-1"><h5 className="text-sm font-medium">Recent baseline activity</h5><ul className="space-y-1 text-[12px]">{operations.slice(0, 6).map(op => <li key={op.id} className="break-words"><span className="font-medium">{OPERATION_LABELS[op.kind]}</span> · {baselines.find(b => b.id === op.baselineId)?.name ?? "deleted baseline"}{op.name ? ` → ${op.name}` : op.siteId ? ` → ${query.data?.sites.find(s => s.id === op.siteId)?.name ?? op.siteId}` : ""} · <span className={op.status === "failed" ? "text-status-error" : op.status === "succeeded" ? "text-status-success" : ""}>{op.status === "running" ? "in progress" : op.status}</span>{op.recoveryBackupId ? ` · previous state kept in backup ${op.recoveryBackupId.slice(0, 8)}` : ""}{op.error ? ` · ${op.error}` : ""}</li>)}</ul></div>}
    </section>}
    {refresh && <Modal title="Refresh copy from baseline" onClose={() => setRefresh(null)} footer={<><Btn disabled={!!busy} onClick={() => setRefresh(null)}>Cancel</Btn><Btn variant="danger" disabled={!!busy} onClick={() => void baselineAction(`refresh:${refresh.id}`, `/${encodeURIComponent(refresh.id)}/refresh`, { baselineId: refresh.baselineId })}>Back up and refresh</Btn></>}><p>Replace {refresh.name}'s files and database with baseline {baselines.find(b => b.id === refresh.baselineId)?.name}. Its own address and wp-config.php are kept. Zoer first saves a recovery backup of its current state. Other copies are not changed.</p></Modal>}
    {restore && <Modal title="Restore pilot backup" onClose={() => setRestore(null)} footer={<><Btn disabled={!!busy} onClick={() => setRestore(null)}>Cancel</Btn><Btn variant="danger" disabled={!!busy} onClick={() => void act(restore.id, "restore", { backupId: restore.backupId })}>Back up current state and restore</Btn></>}><p>Replace this pilot's files and database with backup {restore.backupId}. Zoer first retains a recovery backup of its current state.</p></Modal>}
  </div></Modal>;
}
