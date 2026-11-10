import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Btn, Modal, controlClass } from "@zoer/plugin-ui/controls";
import { api } from "../../lib/api";
import type { WordPressSiteDeletePreview } from "../../lib/api/wordpress-manager-client";
import { eraseConfirmed, FALLBACK_DELETE_PREVIEW, previewFailure, purgeWhen } from "./siteDeletion";

type Choice = "trash" | "erase";

/**
 * Review what Trash keeps and the storage the selected site's erasure removes.
 */
export default function DeleteSiteDialog({ site, trashed = false, onClose, onTrash, onErased }: {
  site: { id: string; name: string; provider?: string };
  /** Already in the trash: only deleting everything is left. */
  trashed?: boolean;
  onClose: () => void;
  /** Moves the site to the trash; rejects with the reason it didn't. */
  onTrash: () => Promise<void>;
  onErased: (result: { erased: string[]; warnings: string[] }) => void;
}) {
  const [preview, setPreview] = useState<WordPressSiteDeletePreview | null>(null);
  const [older, setOlder] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>(trashed ? "erase" : "trash");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pilot = site.provider === "kubernetes";

  useEffect(() => {
    let current = true;
    api.getWordPressSiteDeletePreview(site.id)
      .then(result => { if (current) setPreview(result); })
      .catch(caught => {
        if (!current) return;
        if (pilot) {
          setError("Zoer couldn't check this Kubernetes site for Trash. Close and try again on a host that supports pilot Trash.");
          return;
        }
        // Without a preview the trash still works, described generically; deleting everything waits.
        const failure = previewFailure(caught);
        setOlder(failure.olderHost);
        setWarning(failure.warning);
        setPreview(FALLBACK_DELETE_PREVIEW);
      });
    return () => { current = false; };
  }, [site.id, pilot]);

  const eraseAvailable = (!pilot || trashed) && !!preview?.erase.available;
  const confirmationName = preview?.name || site.name;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      if (choice === "trash") { await onTrash(); onClose(); return; }
      onErased(await api.eraseWordPressSite(site.id, typed.trim()));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The site wasn't deleted.");
    } finally { setBusy(false); }
  };
  const canSubmit = !!preview && !busy && (choice === "trash" ? !trashed : eraseAvailable && eraseConfirmed(confirmationName, typed));

  const option = (value: Choice, title: string, summary: string, disabled = false) => <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${choice === value ? "border-border-strong bg-surface-secondary/50" : "border-border-default"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
    <input type="radio" name="delete-choice" className="mt-0.5 shrink-0" checked={choice === value} disabled={disabled || busy} onChange={() => setChoice(value)} />
    <span className="min-w-0"><span className={`block font-medium ${value === "erase" ? "text-status-error" : "text-text-primary"}`}>{title}</span><span className="block text-xs text-text-secondary">{summary}</span></span>
  </label>;

  return <Modal fit mobileSheet title={pilot && !trashed ? `Move ${site.name} to trash?` : `Delete ${site.name}?`} onClose={() => { if (!busy) onClose(); }} footer={<>
    <Btn variant="ghost" disabled={busy} onClick={onClose}>Cancel</Btn>
    <Btn variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy} disabled={!canSubmit} onClick={() => void submit()}>{choice === "trash" ? "Move to trash" : "Delete everything"}</Btn>
  </>}>
    <div className="space-y-3 text-sm">
      {!preview && !error && <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking what this site leaves behind…</p>}
      {preview && <>
        {warning && <p role="alert" className="text-xs text-status-warning">{warning}</p>}
        {!pilot && !trashed && <div role="radiogroup" aria-label="How to delete" className="space-y-2">
          {option("trash", "Move to trash", preview.trash.purgeAfterDays > 0 ? `Restorable from Trash. Purged ${purgeWhen(preview.trash)}.` : "Restorable from Trash. No automatic purge is scheduled.")}
          {option("erase", "Delete everything now", eraseAvailable ? "The listed data will be permanently deleted." : preview.erase.reason ?? "Not available for this site.", !eraseAvailable)}
        </div>}
        {choice === "erase" && !eraseAvailable && <p role="status" className="text-text-secondary">{preview.erase.reason ?? "Permanent deletion is not available for this site."}</p>}
        {choice === "trash" && <div className="grid gap-3 sm:grid-cols-2">
          {preview.trash.kept.length > 0 && <div className={pilot ? "sm:col-span-2" : undefined}><div className="text-xs font-medium text-text-heading">Kept</div><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{preview.trash.kept.map(line => <li key={line}>{line}</li>)}</ul></div>}
          {preview.trash.purgeAfterDays > 0 && preview.trash.removedAtPurge.length > 0 && <div><div className="text-xs font-medium text-text-heading">Removed at the purge</div><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{preview.trash.removedAtPurge.map(line => <li key={line}>{line}</li>)}</ul></div>}
          <p className="text-xs text-text-muted sm:col-span-2">This stops the site and takes its address offline. To get it back, open Trash on the WordPress page and choose Restore. {pilot ? "No automatic purge is scheduled." : older ? "To remove the site from Zoer later, use Remove from Zoer in the Trash." : eraseAvailable ? "To remove everything now, choose Delete everything instead." : ""}</p>
        </div>}
        {choice === "erase" && eraseAvailable && <div className="space-y-2">
          <div className="text-xs font-medium text-status-error">This removes</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{preview.erase.removes.map(line => <li key={line}>{line}</li>)}</ul>
          <p className="text-xs text-status-error">This cannot be undone.</p>
          <label className="block"><span className="mb-1 block text-xs">Type <strong className="font-mono">{confirmationName}</strong> to confirm</span><input autoFocus aria-label="Site name to confirm" className={controlClass()} value={typed} disabled={busy} onChange={event => setTyped(event.target.value)} /></label>
        </div>}
      </>}
      {error && <p role="alert" className="text-status-error">{error}</p>}
    </div>
  </Modal>;
}
