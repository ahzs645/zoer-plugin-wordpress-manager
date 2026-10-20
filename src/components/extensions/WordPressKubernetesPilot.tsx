import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Btn, Modal, Field, InlineAlert, Select } from "@zoer/plugin-ui/controls";
import { json } from "../../lib/api/_http";
import { wordpressKeys } from "../../lib/queries/wordpress";

import WordPressKubernetesSleep, { type PilotSleepPolicy } from "./WordPressKubernetesSleep";

export default function WordPressKubernetesPilot({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: [...wordpressKeys.all(), "kubernetes-pilot"], queryFn: () => json<{ enabled: boolean; sites: Array<{ id: string; name: string; status: string; url: string | null; policy: PilotSleepPolicy; backups: Array<{ id: string; createdAt: string }>; measurements: Array<{service:string;memoryBytes:number;cpuPercent:number}> | null }> }>("/wordpress-manager/runtime-pilots"), refetchInterval: 5000 });
  const [name, setName] = useState(""), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [selectedBackups, setSelectedBackups] = useState<Record<string, string>>({});
  const [restore, setRestore] = useState<{ id: string; backupId: string } | null>(null);
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
      {site.status === "running" && <><Btn size="sm" disabled={!!busy} onClick={() => void act(site.id, "inspect")}>Read WordPress version</Btn><Btn size="sm" disabled={!!busy} onClick={() => void act(site.id, "backup")}>Back up pilot</Btn>{site.backups.length > 0 && <><Select aria-label="Backup to restore" disabled={!!busy} value={selectedBackups[site.id] ?? site.backups.at(-1)!.id} onChange={e => setSelectedBackups(old => ({ ...old, [site.id]: e.target.value }))}>{site.backups.map((backup, i) => <option key={backup.id} value={backup.id}>Backup {i + 1} · {backup.id.slice(0, 8)}</option>)}</Select><Btn size="sm" disabled={!!busy} onClick={() => setRestore({ id: site.id, backupId: selectedBackups[site.id] ?? site.backups.at(-1)!.id })}>Restore backup</Btn></>}</>}
      {site.status === "running" && site.url && <a className="inline-flex min-h-11 items-center underline" href={site.url} target="_blank" rel="noreferrer">Open pilot</a>}
    </div><p className="text-xs text-text-secondary">Budgets: web 1 GiB / 2 CPU; database 768 MiB / 1 CPU. {site.measurements?.length ? site.measurements.map(m => `${m.service}: ${(m.memoryBytes / 1024 ** 2).toFixed(0)} MiB, ${m.cpuPercent.toFixed(2)}% CPU`).join(" · ") : "Measurements unavailable while stopped or before the first sample."}</p>{receipts[site.id] && <p role="status" className="break-all">{receipts[site.id]}</p>}</section>)}
    {receipts[""] && <p role="status">{receipts[""]}</p>}
    {restore && <Modal title="Restore pilot backup" onClose={() => setRestore(null)} footer={<><Btn disabled={!!busy} onClick={() => setRestore(null)}>Cancel</Btn><Btn variant="danger" disabled={!!busy} onClick={() => void act(restore.id, "restore", { backupId: restore.backupId })}>Back up current state and restore</Btn></>}><p>Replace this pilot's files and database with backup {restore.backupId}. Zoer first retains a recovery backup of its current state.</p></Modal>}
  </div></Modal>;
}
