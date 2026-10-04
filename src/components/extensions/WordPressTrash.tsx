import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import { Modal } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import { requestAction, runAction } from "../../host/actions";
import { purgeLabel, removalRequest, sortTrashedSites, type SiteRemovalPlan, type TrashedSite } from "./wordpressTrashPolicy";

/**
 * Trashed DDEV sites on Zoer's S9 managed resources: `sites.trash` lists them
 * (`includeArchived: true`), `site.restore` restores one, and removal from Zoer reviews the S9
 * plan (`site.removal-plan`), takes the typed phrase and sends `site.remove` through the host's
 * approval (`destructive`, `approval: always`). Playground sites are restored from the Zoer
 * Computers trash, as before.
 */
export default function WordPressTrash({ onClose, onChanged }: { onClose: () => void; onChanged: (restoredId?: string) => Promise<void> | void }) {
  const [sites, setSites] = useState<TrashedSite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<SiteRemovalPlan | null>(null);
  const [typed, setTyped] = useState("");

  const refresh = async () => {
    try { setSites(sortTrashedSites((await runAction<{ sites: TrashedSite[] }>("sites.trash")).sites ?? [])); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to list trashed sites."); setSites(current => current ?? []); }
  };
  useEffect(() => { void refresh(); }, []);

  const restore = async (site: TrashedSite) => {
    setBusy(`restore:${site.id}`); setError(null); setNotice(null);
    try {
      const result = await runAction<{ summary: string }>("site.restore", { siteId: site.id, start: true });
      setNotice(`${site.name}: ${result.summary}`);
      await onChanged(site.id);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to restore this site."); }
    finally { setBusy(null); }
  };

  const review = async (site: TrashedSite) => {
    setBusy(`plan:${site.id}`); setError(null); setNotice(null); setTyped("");
    try { setPlan((await runAction<{ plan: SiteRemovalPlan }>("site.removal-plan", { siteId: site.id })).plan); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to plan the removal."); }
    finally { setBusy(null); }
  };

  const remove = async () => {
    const request = plan ? removalRequest(plan, typed) : null;
    if (!plan || !request) return;
    setBusy(`remove:${plan.resourceId}`); setError(null);
    try {
      // The host shows its approval card; the run waits for the decision.
      const result = await requestAction<{ summary: string }>("site.remove", request);
      setNotice(`${plan.name}: ${result.summary}`);
      setPlan(null); setTyped("");
      await onChanged();
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The site was not removed."); }
    finally { setBusy(null); }
  };

  if (plan) {
    return <Modal mobileSheet title={`Remove ${plan.name} from Zoer`} onClose={() => { if (!busy) setPlan(null); }} footer={<><Btn variant="ghost" disabled={busy !== null} onClick={() => setPlan(null)}>Back</Btn><Btn variant="danger" loading={busy !== null} disabled={!removalRequest(plan, typed) || busy !== null} onClick={() => void remove()}>Request removal</Btn></>}>
      <div className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-4 text-status-warning">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        <div><div className="font-medium">Steps</div><ol className="mt-1 list-decimal space-y-1 pl-5 text-text-secondary">{plan.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
        {plan.retainedResources.length > 0 && <div><div className="font-medium">Stays in place</div><ul className="mt-1 list-disc space-y-1 pl-4 text-text-secondary">{plan.retainedResources.map(entry => <li key={entry}>{entry}</li>)}</ul></div>}
        <p className="text-xs text-text-secondary">Plan fingerprint <span className="font-mono">sha256:{plan.fingerprintSha256}</span>. Zoer asks for approval before anything is removed and refuses a changed plan.</p>
        <label className="block"><span className="mb-1 block">Type <strong className="font-mono">{plan.confirmationPhrase}</strong> to confirm</span><input autoFocus className={controlClass()} value={typed} onChange={event => setTyped(event.target.value)} /></label>
        {error && <p role="alert" className="text-status-error">{error}</p>}
      </div>
    </Modal>;
  }

  return <Modal mobileSheet title="Trash" onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-3 text-sm">
      <p className="text-text-secondary">Local DDEV sites moved to the trash stay restorable until their scheduled purge. Playground sites are restored from the Zoer Computers trash.</p>
      {sites === null && <p className="text-text-secondary">Loading trashed sites…</p>}
      {sites?.length === 0 && !error && <p className="text-text-secondary">The trash is empty.</p>}
      {sites?.map(site => <div key={site.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted p-3">
        <div className="min-w-0"><div className="font-medium text-text-primary">{site.name}</div><div className="text-xs text-text-secondary">{purgeLabel(site.scheduledPurgeAt)}{site.archivedAt ? ` · trashed ${new Date(site.archivedAt).toLocaleString()}` : ""}{site.owned ? "" : " · created outside WordPress Manager"}</div></div>
        <div className="flex gap-1">
          <Btn size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === `restore:${site.id}`} disabled={busy !== null} onClick={() => void restore(site)}>Restore</Btn>
          <Btn size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy === `plan:${site.id}`} disabled={busy !== null} onClick={() => void review(site)}>Remove from Zoer…</Btn>
        </div>
      </div>)}
      {notice && <p role="status" className="text-status-success">{notice}</p>}
      {error && <p role="alert" className="text-status-error">{error}</p>}
    </div>
  </Modal>;
}
