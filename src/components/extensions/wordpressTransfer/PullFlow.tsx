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
  const caps = connection.status.capabilities;
  const options = exportOptionsForAction(action, draft.exportOptions);
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
    <WordPressPull key={siteId} siteId={siteId} enabled={enabled} action={action === "backup" || action === "export" ? action : "pull"} options={gated.options} errors={exportOptionsErrors(gated.options)}
      notices={gated.downgraded.map(label => `${label} need Zoer Connect 0.4.0 on this site and will not be applied.`)}
      startLabel={action === "backup" ? "Back up database" : action === "export" ? "Start export" : "Start pull"}
      onReady={action === "pull" ? onLocalCopy : undefined} />
  </div>;
}
