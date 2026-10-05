import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Trash2 } from "lucide-react";
import { Btn, useDialogs } from "@zoer/plugin-ui/controls";
import { deletePull, downloadFileSet, engineKeys, useCatalogKind } from "../../../lib/queries/plugin-engine";
import { pullContents } from "../../../lib/wordpress-transfer/options";
import { formatTransferBytes } from "../wordpressPullProgress";
import { engineErrorMessage } from "./runState";
import { isReadyPull, parsePullRecord, pullHasDatabase, type PullRecord } from "./records";

const STATUS: Record<string, string> = { ready: "Verified", "dry-run": "Dry run · no files kept", downloading: "Downloading", cancelled: "Cancelled" };

/** Plugin-engine pulls, backups and local exports of one site: download, delete, or copy locally. */
export default function PluginPulls({ siteId, siteName, onLocalCopy }: { siteId: string; siteName: string; onLocalCopy?: (pull: PullRecord) => void }) {
  const dialogs = useDialogs();
  const client = useQueryClient();
  const records = useCatalogKind("pull");
  const pulls = (records.data ?? []).map(parsePullRecord).filter((pull): pull is PullRecord => !!pull && pull.siteId === siteId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileBase = `${siteName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "wordpress"}`;

  async function download(pull: PullRecord, part: "database" | "archive") {
    if (!pull.setId) return;
    setBusy(`${pull.pullId}:${part}`); setError("");
    try {
      await downloadFileSet(part === "database" ? { setId: pull.setId, path: "database.sql" } : { setId: pull.setId, format: "tar.gz" },
        `${fileBase}-${pull.createdAt.slice(0, 10)}${part === "database" ? ".sql" : ".tar.gz"}`);
    } catch (caught) { setError(engineErrorMessage(caught, "Download failed.")); }
    finally { setBusy(null); }
  }
  async function remove(pull: PullRecord) {
    if (!await dialogs.confirm({ title: "Delete this download?", description: "Removes its files from the Zoer server and the prepared export on the website, so the site accepts a new export. The website's content is unchanged. Pushes and local copies can no longer use it.", confirmLabel: "Delete download", cancelLabel: "Keep", tone: "danger" })) return;
    setBusy(`${pull.pullId}:delete`); setError(""); setNotice("");
    try {
      // The pull action deletes the file set, the record and the source's export (like the host engine's delete).
      const result = await deletePull(pull);
      if (result.remoteRemoved === false) setNotice(`Deleted from the Zoer server, but the export on the site could not be removed: ${result.remoteError ?? "no answer"}. Remove it in WordPress → Tools → Zoer Connect before the next export.`);
      await client.invalidateQueries({ queryKey: engineKeys.catalog("pull") });
    } catch (caught) { setError(engineErrorMessage(caught, "The download could not be deleted.")); }
    finally { setBusy(null); }
  }

  return <section className="min-w-0 space-y-2" aria-label="Plugin-engine downloads">
    <h4 className="text-sm font-semibold text-text-heading">Downloads on the Zoer server</h4>
    {records.isLoading && <p className="text-sm text-text-secondary">Loading downloads…</p>}
    {records.error && <p role="alert" className="text-sm text-status-error">Could not load downloads: {engineErrorMessage(records.error)} <Btn size="sm" onClick={() => void records.refetch()}>Retry</Btn></p>}
    {records.data && !pulls.length && <p className="text-sm text-text-secondary">No plugin-engine downloads of this site yet.</p>}
    <ul className="min-w-0 space-y-2">{pulls.map(pull => {
      const contents = pullContents(pull.options);
      const ready = isReadyPull(pull);
      const deleting = busy === `${pull.pullId}:delete`;
      return <li key={pull.pullId} className="min-w-0 space-y-2 rounded-md border border-border-muted bg-surface-primary/50 p-3">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-medium text-text-primary">{pull.kind === "local-export" ? "Local export" : contents.label}</p>
          <p className="text-[12px] tabular-nums text-text-secondary">{new Date(pull.createdAt).toLocaleString()} · {STATUS[pull.status] ?? pull.status}
            {pull.totalBytes ? ` · ${formatTransferBytes(pull.totalBytes)}` : ""}{pull.fileCount ? ` · ${pull.fileCount.toLocaleString()} files` : ""}{pull.skippedCount ? ` · ${pull.skippedCount.toLocaleString()} skipped` : ""}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {ready && pullHasDatabase(pull) && <Btn size="sm" className="w-full sm:w-auto" icon={<Download className="h-4 w-4" />} loading={busy === `${pull.pullId}:database`} disabled={busy !== null} onClick={() => void download(pull, "database")}>Database (.sql)</Btn>}
          {ready && <Btn size="sm" className="w-full sm:w-auto" icon={<Download className="h-4 w-4" />} loading={busy === `${pull.pullId}:archive`} disabled={busy !== null} onClick={() => void download(pull, "archive")}>Archive (.tar.gz)</Btn>}
          {ready && onLocalCopy && pull.kind === "pull" && <Btn size="sm" className="w-full sm:w-auto" icon={<Copy className="h-4 w-4" />} disabled={busy !== null} onClick={() => onLocalCopy(pull)}>Make a local copy</Btn>}
          {pull.status !== "downloading" && <Btn size="sm" className="w-full sm:w-auto" variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={deleting} disabled={busy !== null} onClick={() => void remove(pull)}>Delete</Btn>}
        </div>
      </li>;
    })}</ul>
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {notice && <p role="status" className="break-words text-sm text-status-warning">{notice}</p>}
  </section>;
}
