import { useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Btn, controlClass } from "@zoer/plugin-ui/controls";
import type { RecoveryGate } from "./recoveryGate";

/**
 * Shown where a live Hostinger plugin or theme change was refused for want of a recent backup.
 * Hostinger's API can't make one, so the person makes it in hPanel; Zoer records their
 * confirmation and retries the change.
 */
export default function RecoveryPointPanel({ gate, action, busy, error, onRecord, onDismiss }: {
  gate: RecoveryGate;
  /** What was refused, e.g. "Update 2 plugins". */
  action: string;
  busy: boolean;
  error?: string | null;
  onRecord: (label: string) => void;
  onDismiss: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [label, setLabel] = useState(`hPanel backup ${new Date().toLocaleDateString()}`);
  const missing = !gate.connectionId || !gate.domain;
  return <section role="region" aria-label="Backup needed before this change" className="space-y-3 rounded-lg border border-status-warning/40 bg-status-warning/5 p-3 text-[13px]">
    <div>
      <h4 className="flex items-center gap-1.5 font-semibold text-status-warning"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Back up the live site first</h4>
      <p className="mt-1 text-text-secondary"><span className="font-medium text-text-primary">{action}</span> changes the live website. Zoer needs a Hostinger backup from the last {gate.validHours} hours, and Hostinger only lets you make one in hPanel.</p>
    </div>
    <ol className="list-decimal space-y-1 pl-5 text-text-secondary">
      <li><a className="inline-flex items-center gap-1 text-accent underline underline-offset-2" href={gate.hpanelUrl} target="_blank" rel="noreferrer">Open hPanel backups<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>{gate.domain ? ` for ${gate.domain}` : ""}, create a backup and wait until it shows as completed.</li>
      <li>Confirm below. Zoer records it and tries the change again.</li>
    </ol>
    <label className="flex items-start gap-2 text-text-primary"><input type="checkbox" className="ui-checkbox mt-0.5 h-4 w-4 shrink-0" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I created and checked a backup in hPanel</span></label>
    <label className="block"><span className="mb-1 block text-xs text-text-secondary">Backup label (optional)</span><input className={controlClass("compact")} value={label} onChange={event => setLabel(event.target.value)} maxLength={120} /></label>
    {missing && <p role="alert" className="text-status-error">This site isn't linked to a Hostinger account in Zoer, so the backup can't be recorded here. Open the site's Hostinger record from the site list.</p>}
    {error && <p role="alert" className="text-status-error">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Btn size="sm" variant="primary" loading={busy} disabled={!confirmed || missing || busy} onClick={() => onRecord(label.trim() || `hPanel backup ${new Date().toLocaleDateString()}`)}>Record backup and continue</Btn>
      <Btn size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>Cancel</Btn>
    </div>
  </section>;
}
