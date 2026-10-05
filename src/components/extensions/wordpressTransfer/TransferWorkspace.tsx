import { useState } from "react";
import { Archive, DatabaseBackup, Download, Replace, Upload } from "lucide-react";
import type { TransferAction, WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, REQUIRES_040, TRANSFER_ACTIONS } from "../../../lib/wordpress-transfer/options";
import ProfilesBar from "./ProfilesBar";
import PullFlow from "./PullFlow";
import PushFlow from "./PushFlow";
import ReplaceFlow from "./ReplaceFlow";
import { ACTION_LABELS } from "./transferLabels";
import { initialAction, initialDraft, switchAction, type DraftUpdate } from "./draft";

const ICONS: Record<TransferAction, React.ReactNode> = {
  pull: <Download className="h-4 w-4" aria-hidden="true" />, push: <Upload className="h-4 w-4" aria-hidden="true" />,
  replace: <Replace className="h-4 w-4" aria-hidden="true" />, backup: <DatabaseBackup className="h-4 w-4" aria-hidden="true" />,
  export: <Archive className="h-4 w-4" aria-hidden="true" />,
};

export function actionAvailability(connection: ZoerConnectConnection): Record<TransferAction, string | null> {
  const s = connection.status;
  const pull = !s.pull ? "Enable Pull in WordPress → Tools → Zoer Connect" : !s.stagingReady ? "Private storage is unavailable on this site" : null;
  return {
    pull, backup: pull, export: pull,
    push: !s.push ? "Enable Push in WordPress → Tools → Zoer Connect" : !s.publish ? "Update Zoer Connect to an import-capable release" : null,
    replace: !hasCapability(s.capabilities, "siteReplace") ? REQUIRES_040 : !s.push ? "Enable Push in WordPress → Tools → Zoer Connect" : !s.publish ? "Update Zoer Connect to an import-capable release" : null,
  };
}

/** WP Migrate-style flow: pick an action, adjust panels, run, and follow progress. */
export default function TransferWorkspace({ siteId, connection, diagnostics, diagnosticsLoading, busy, onLocalCopy }: {
  siteId: string; connection: ZoerConnectConnection; diagnostics: WordPressDiagnostics | null | undefined; diagnosticsLoading: boolean; busy: boolean; onLocalCopy: (pullId: string) => void;
}) {
  const availability = actionAvailability(connection);
  const [draft, setDraft] = useState(() => initialDraft(initialAction(availability)));
  const update: DraftUpdate = fn => setDraft(fn);
  const action = draft.action;
  return <div className="min-w-0 space-y-4">
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium">What do you want to do?</legend>
      <div role="radiogroup" aria-label="Transfer action" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TRANSFER_ACTIONS.map(value => {
          const reason = availability[value];
          const selected = action === value;
          return <label key={value} className={`relative flex min-h-11 min-w-0 cursor-pointer flex-col gap-1 rounded-lg border p-2.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-input-focus ${selected ? "border-accent bg-surface-hover" : "border-border-default hover:bg-surface-hover"} ${reason ? "opacity-60" : ""} ${value === "export" ? "col-span-2 sm:col-span-1" : ""}`}>
            <input type="radio" name="zoer-transfer-action" className="sr-only" checked={selected} onChange={() => setDraft(d => switchAction(d, value))} aria-describedby={`zoer-action-${value}`} />
            <span className="flex items-center gap-1.5 font-medium text-text-primary">{ICONS[value]}{ACTION_LABELS[value].title}</span>
            <span id={`zoer-action-${value}`} className="text-[12px] leading-4 text-text-muted">{reason ?? ACTION_LABELS[value].description}</span>
          </label>;
        })}
      </div>
    </fieldset>
    <ProfilesBar siteId={siteId} draft={draft} update={update} />
    {availability[action] ? <p role="status" className="text-sm text-status-warning">{availability[action]}.</p> : <>
      {(action === "pull" || action === "backup" || action === "export") && <PullFlow siteId={siteId} connection={connection} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} draft={draft} update={update} enabled={!busy} onLocalCopy={onLocalCopy} />}
      {action === "push" && <PushFlow siteId={siteId} connection={connection} destination={diagnostics} draft={draft} update={update} />}
      {action === "replace" && <ReplaceFlow siteId={siteId} connection={connection} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} draft={draft} update={update} />}
    </>}
  </div>;
}
