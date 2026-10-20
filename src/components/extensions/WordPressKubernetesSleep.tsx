import { useState } from "react";
import { Btn, Modal, Select, InlineAlert } from "@zoer/plugin-ui/controls";
import { json } from "../../lib/api/_http";
export interface PilotSleepPolicy { idleMinutes: number; wakeOnRequest: boolean; lastActivityAt: string }
export default function WordPressKubernetesSleep({ siteId, policy, onSaved }: { siteId: string; policy: PilotSleepPolicy; onSaved: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<PilotSleepPolicy | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  async function save() {
    if (!draft || busy) return; setBusy(true); setError(null);
    try { await json(`/wordpress-manager/runtime-pilots/${encodeURIComponent(siteId)}/policy`, { method: "PUT", body: JSON.stringify({ idleMinutes: draft.idleMinutes, wakeOnRequest: draft.wakeOnRequest }) }); setDraft(null); await onSaved(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div className="space-y-2"><p className="text-xs text-text-secondary">{policy.idleMinutes ? `Sleep after ${policy.idleMinutes} minutes idle` : "Keep running"} · {policy.wakeOnRequest ? "Wake when opened" : "Start manually"}</p><Btn size="sm" onClick={() => { setDraft(policy); setError(null); }}>Sleep settings</Btn>
    {draft && <Modal title="Kubernetes sleep settings" onClose={() => { if (!busy) setDraft(null); }} footer={<><Btn disabled={busy} onClick={() => setDraft(null)}>Cancel</Btn><Btn variant="primary" loading={busy} onClick={() => void save()}>Save sleep settings</Btn></>}><div className="space-y-4 text-sm">
      <label className="block space-y-1"><span>When idle</span><Select aria-label="When idle" value={String(draft.idleMinutes)} onChange={e => setDraft({ ...draft, idleMinutes: Number(e.target.value) })}><option value="0">Keep running</option><option value="5">Sleep after 5 minutes</option><option value="30">Sleep after 30 minutes</option><option value="60">Sleep after 1 hour</option><option value="120">Sleep after 2 hours</option></Select></label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={draft.wakeOnRequest} onChange={e => setDraft({ ...draft, wakeOnRequest: e.target.checked })} />Wake when the site is opened</label>
      <p>Transfers, editing and active requests keep the site awake. Sleeping retains its files, database and recovery points. Resource polling does not count as activity.</p>
      {error != null && <InlineAlert error={error} />}
    </div></Modal>}
  </div>;
}
