import { useState } from "react";
import { OptionToggle } from "./TransferPanel";
import type { WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { applyExportCapabilities, exportOptionsErrors, exportOptionsForAction } from "../../../lib/wordpress-transfer/options";
import WordPressPull from "../WordPressPull";
import DatabasePanel from "./DatabasePanel";
import FilesPanel from "./FilesPanel";
import type { DraftUpdate, TransferDraft } from "./draft";

/** Pull, Backup (database only, kept on Zoer) and Export (pull + download). */
export default function PullFlow({ siteId, connection, diagnostics, diagnosticsLoading, draft, update, enabled, onLocalCopy }: {
  siteId: string; connection: ZoerConnectConnection; diagnostics: WordPressDiagnostics | null | undefined; diagnosticsLoading: boolean;
  draft: TransferDraft; update: DraftUpdate; enabled: boolean; onLocalCopy: (pullId: string) => void;
}) {
  const action = draft.action;
  const [sourcePause, setSourcePause] = useState({ siteId, action, paused: false, writersStopped: false });
  const pauseSource = sourcePause.siteId === siteId && sourcePause.action === action && sourcePause.paused;
  const writersStopped = sourcePause.siteId === siteId && sourcePause.action === action && sourcePause.writersStopped;
  const caps = connection.status.capabilities;
  const options = exportOptionsForAction(action, draft.exportOptions);
  const canPauseSource = options.resources.database && !options.resources.core && caps?.resumableDatabaseExport === true && connection.status.push;
  const gated = applyExportCapabilities(options, caps);
  const setOptions = (next: typeof options) => update(d => ({ ...d, exportOptions: next }));
  return <div className="min-w-0 space-y-3">
    <p className="text-xs text-text-secondary">{action === "backup"
      ? "Saves a verified database snapshot on the Zoer server. Download or delete it later from Backups & import."
      : action === "export"
        ? "Downloads the selected resources to the Zoer server, then lets you save the database (.sql) or an archive (.tar.gz) to this device."
        : "Downloads the selected resources to the Zoer server. Pause keeps your progress; Resume continues from the saved checkpoint. Downloading does not import or publish anything."}</p>
    <DatabasePanel exportOptions={options} onExport={setOptions} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} sourceCaps={caps} lockDatabase={action === "backup"} defaultOpen={action === "backup"} />
    {action !== "backup" && <FilesPanel action={action} options={options} onChange={setOptions} diagnostics={diagnostics} diagnosticsLoading={diagnosticsLoading} sourceCaps={caps} />}
    {canPauseSource && <div className="space-y-2">
      <OptionToggle label="Pause source while exporting database" checked={pauseSource} onChange={value => { setSourcePause({ siteId, action, paused: value, writersStopped: false }); }} description="For large databases. WordPress requests pause until the database is saved or you cancel. Progress resumes from table and row checkpoints." />
      {pauseSource && <OptionToggle label="Background jobs and external database writers are stopped" checked={writersStopped} onChange={value => setSourcePause({ siteId, action, paused: pauseSource, writersStopped: value })} description="Stop earlier requests, scheduled jobs and direct database edits first. Hosting cache responses can remain visible. An idle pause expires after one hour; it cannot resume that snapshot afterward." />}
    </div>}
    <WordPressPull key={siteId} siteId={siteId} enabled={enabled} action={action === "backup" || action === "export" ? action : "pull"} options={gated.options} pauseSource={pauseSource && canPauseSource} sourceQuiescenceAccepted={writersStopped} errors={[...exportOptionsErrors(gated.options), ...(pauseSource && canPauseSource && !writersStopped ? ["Confirm source writers are stopped before starting."] : [])]}
      notices={gated.downgraded.map(label => `${label} need Zoer Connect 0.4.0 on this site and will not be applied.`)}
      startLabel={action === "backup" ? "Back up database" : action === "export" ? "Start export" : "Start pull"}
      onReady={action === "pull" ? onLocalCopy : undefined} />
  </div>;
}
