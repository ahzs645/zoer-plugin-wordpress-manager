import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Btn, Modal, controlClass } from "@zoer/plugin-ui/controls";
import { api } from "../../lib/api";
import type { WordPressSiteDeletePreview } from "../../lib/api/wordpress-manager-client";
import { eraseConfirmed, FALLBACK_DELETE_PREVIEW, previewFailure, purgeWhen } from "./siteDeletion";

type Choice = "trash" | "erase";

/**
 * Deleting a local DDEV site: move it to the trash (restorable, purged later) or delete
 * everything now. The host says exactly what each keeps and removes.
 */
export default function DeleteSiteDialog({ site, trashed = false, onClose, onTrash, onErased }: {
  site: { id: string; name: string };
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

  useEffect(() => {
    let current = true;
    api.getWordPressSiteDeletePreview(site.id)
      .then(result => { if (current) setPreview(result); })
      .catch(caught => {
        if (!current) return;
        // Without a preview the trash still works, described generically; deleting everything waits.
        const failure = previewFailure(caught);
        setOlder(failure.olderHost);
        setWarning(failure.warning);
        setPreview(FALLBACK_DELETE_PREVIEW);
      });
    return () => { current = false; };
  }, [site.id]);

  const eraseAvailable = !!preview?.erase.available;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (choice === "trash") { await onTrash(); onClose(); return; }
      onErased(await api.eraseWordPressSite(site.id, typed.trim()));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The site wasn't deleted.");
    } finally { setBusy(false); }
  };
  const canSubmit = !!preview && !busy && (choice === "trash" ? !trashed : eraseAvailable && eraseConfirmed(site.name, typed));

  const option = (value: Choice, title: string, summary: string, disabled = false) => <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${choice === value ? "border-border-strong bg-surface-secondary/50" : "border-border-default"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
    <input type="radio" name="delete-choice" className="mt-0.5 shrink-0" checked={choice === value} disabled={disabled || busy} onChange={() => setChoice(value)} />
    <span className="min-w-0"><span className={`block font-medium ${value === "erase" ? "text-status-error" : "text-text-primary"}`}>{title}</span><span className="block text-xs text-text-secondary">{summary}</span></span>
  </label>;

  return <Modal mobileSheet title={`Delete ${site.name}?`} onClose={() => { if (!busy) onClose(); }} footer={<>
    <Btn variant="ghost" disabled={busy} onClick={onClose}>Cancel</Btn>
    <Btn variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy} disabled={!canSubmit} onClick={() => void submit()}>{choice === "trash" ? "Move to trash" : "Delete everything"}</Btn>
  </>}>
    <div className="space-y-3 text-sm">
      {!preview && !error && <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking what this site leaves behind…</p>}
      {preview && <>
        {warning && <p role="alert" className="text-xs text-status-warning">{warning}</p>}
        <div role="radiogroup" aria-label="How to delete" className="space-y-2">
          {!trashed && option("trash", "Move to trash", `Restorable from Trash. Purged ${purgeWhen(preview.trash)}.`)}
          {option("erase", "Delete everything now", eraseAvailable ? "Nothing is kept and it can't be undone." : warning ? "Unavailable until Zoer can list what it removes. Close and try again." : trashed && older ? "This Zoer version can't delete everything yet. Use Remove from Zoer in the Trash instead." : preview.erase.reason ?? "Not available for this site.", !eraseAvailable)}
        </div>
        {choice === "trash" && <div className="grid gap-3 sm:grid-cols-2">
          <div><div className="text-xs font-medium text-text-heading">Kept until the purge</div><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{preview.trash.kept.map(line => <li key={line}>{line}</li>)}</ul></div>
          <div><div className="text-xs font-medium text-text-heading">Removed at the purge</div><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{preview.trash.removedAtPurge.map(line => <li key={line}>{line}</li>)}</ul></div>
          <p className="text-xs text-text-muted sm:col-span-2">To get it back, open Trash on the WordPress page and choose Restore. {older ? "To remove everything later, use Remove from Zoer in the Trash." : eraseAvailable ? "To remove everything now, choose Delete everything instead." : ""}</p>
        </div>}
        {choice === "erase" && eraseAvailable && <div className="space-y-2">
          <div className="text-xs font-medium text-status-error">This removes</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{preview.erase.removes.map(line => <li key={line}>{line}</li>)}</ul>
          <label className="block"><span className="mb-1 block text-xs">Type <strong className="font-mono">{site.name}</strong> to confirm</span><input autoFocus aria-label="Site name to confirm" className={controlClass()} value={typed} disabled={busy} onChange={event => setTyped(event.target.value)} /></label>
        </div>}
      </>}
      {error && <p role="alert" className="text-status-error">{error}</p>}
    </div>
  </Modal>;
}
