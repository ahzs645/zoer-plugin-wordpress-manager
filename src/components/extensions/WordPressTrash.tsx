import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import DeleteSiteDialog from "./DeleteSiteDialog";
import { Btn } from "@zoer/plugin-ui/controls";
import { Modal } from "@zoer/plugin-ui/controls";
import { ActionMenu, EmptyState, controlClass } from "@zoer/plugin-ui/controls";
import { requestAction, runAction } from "../../host/actions";
import { forgetErasedSiteRecords } from "../../lib/queries/plugin-engine";
import { purgeLabel, removalRequest, sortTrashedSites, type SiteRemovalPlan, type TrashedSite } from "./wordpressTrashPolicy";
import { formatWhen } from "../../lib/formatWhen";
import { api } from "../../lib/api";

/**
 * Trashed DDEV sites on Zoer's S9 managed resources: `sites.trash` lists them
 * (`includeArchived: true`), `site.restore` restores one, and removal from Zoer reviews the S9
 * plan (`site.removal-plan`), takes the typed phrase and sends `site.remove` through the host's
 * approval (`destructive`, `approval: always`). Both providers use the same permanent erasure review.
 */
export default function WordPressTrash({ onClose, onChanged }: { onClose: () => void; onChanged: (restoredId?: string) => Promise<void> | void }) {
  const [sites, setSites] = useState<TrashedSite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<SiteRemovalPlan | null>(null);
  const [typed, setTyped] = useState("");
  const [eraseTarget, setEraseTarget] = useState<TrashedSite | null>(null);

  const refresh = async () => {
    const [ddev, kubernetes] = await Promise.allSettled([
      runAction<{ sites: TrashedSite[] }>("sites.trash"),
      api.listTrashedWordPressPilots(),
    ]);
    const pilots = kubernetes.status === "fulfilled" ? kubernetes.value.sites
      .filter(site => site.provider === "kubernetes" && site.state === "archived")
      .map((site): TrashedSite => ({ ...site, id: site.siteId, provider: "kubernetes", scheduledPurgeAt: null })) : [];
    const ddevSites = ddev.status === "fulfilled"
      ? (ddev.value.sites ?? []).map(site => ({ ...site, scheduledPurgeAt: site.scheduledPurgeAt || null })) : [];
    setSites(sortTrashedSites([...ddevSites, ...pilots]));
    setError([ddev.status === "rejected" ? "DDEV" : "", kubernetes.status === "rejected" ? "Kubernetes" : ""].filter(Boolean).map(provider => `Unable to list ${provider} sites in Trash.`).join(" ") || null);
  };
  useEffect(() => { void refresh(); }, []);

  const restore = async (site: TrashedSite) => {
    setBusy(`restore:${site.id}`); setError(null); setNotice(null);
    try {
      if (site.provider === "kubernetes") {
        await api.restoreWordPressPilot(site.id);
        setNotice(`${site.name} was restored and is still stopped.`);
      } else {
        const result = await runAction<{ summary: string }>("site.restore", { siteId: site.id, start: true });
        setNotice(`${site.name}: ${result.summary}`);
      }
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

  if (eraseTarget) {
    return <DeleteSiteDialog trashed site={eraseTarget} onClose={() => setEraseTarget(null)} onTrash={async () => undefined} onErased={result => {
      setNotice(`${eraseTarget.name} was deleted. Removed: ${result.erased.join("; ") || "the site"}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
      void forgetErasedSiteRecords(eraseTarget.id).catch(() => undefined).finally(() => { void onChanged(); void refresh(); });
    }} />;
  }

  if (plan) {
    return <Modal fit mobileSheet title={`Remove ${plan.name} from Zoer`} onClose={() => { if (!busy) setPlan(null); }} footer={<><Btn variant="ghost" disabled={busy !== null} onClick={() => setPlan(null)}>Back</Btn><Btn variant="danger" loading={busy !== null} disabled={!removalRequest(plan, typed) || busy !== null} onClick={() => void remove()}>Request removal</Btn></>}>
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
      {!!sites?.length && <p className="text-text-secondary"><strong className="font-medium text-text-primary">Delete everything</strong> permanently removes a site's files and database after review. Kubernetes sites have no automatic purge. For DDEV, <strong className="font-medium text-text-primary">Remove from Zoer</strong> leaves the project files on the DDEV server.</p>}
      {sites === null && <p className="text-text-secondary">Loading trashed sites…</p>}
      {sites?.length === 0 && !error && <EmptyState icon={<Trash2 className="h-7 w-7" />} title="Trash is empty" description="Deleted local sites stay here until they're purged. Playground sites are in Computers trash." />}
      {sites?.map(site => <div key={site.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted p-3">
        <div className="min-w-0"><div className="font-medium text-text-primary">{site.name}</div><div className="text-xs text-text-secondary">{site.provider === "kubernetes" ? "Kubernetes · " : ""}{purgeLabel(site.scheduledPurgeAt)}{site.archivedAt ? ` · trashed ${formatWhen(site.archivedAt)}` : ""}{site.owned === false ? " · created outside WordPress Manager" : ""}</div></div>
        <div className="flex flex-wrap items-center gap-1">
          {!site.erasurePending && <Btn size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === `restore:${site.id}`} disabled={busy !== null} onClick={() => void restore(site)}>Restore</Btn>}
          <Btn size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={busy !== null} onClick={() => setEraseTarget(site)}>{site.erasurePending ? "Finish erasure" : "Delete everything"}</Btn>
          {site.provider !== "kubernetes" && <ActionMenu label={`More actions for ${site.name}`} size="sm" items={[
            { label: "Remove from Zoer…", icon: <Trash2 className="h-4 w-4" />, loading: busy === `plan:${site.id}`, disabled: busy !== null, onClick: () => void review(site) },
          ]} />}
        </div>
      </div>)}
      {notice && <p role="status" className="text-status-success">{notice}</p>}
      {error && <p role="alert" className="text-status-error">{error}</p>}
    </div>
  </Modal>;
}
