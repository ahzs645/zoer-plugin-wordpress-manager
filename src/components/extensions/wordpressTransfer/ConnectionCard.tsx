import { AlertTriangle, ArrowUpCircle } from "lucide-react";
import type { WordPressDiagnostics, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { ZOER_CONNECT_CAPABILITIES } from "../../../lib/api/types/wordpress-transfer";
import { compareVersions } from "../../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { formatTransferBytes } from "../wordpressPullProgress";
import { connectionWarnings } from "./transferLabels";

const CAPABILITY_NAMES: Record<string, string> = {
  replacementRules: "Custom find & replace", replacementVariants: "URL variants", reviewPause: "Review before apply", createTables: "Create tables",
  authorMapping: "Author mapping", keepActivePlugins: "Active plugin choice", lateFence: "Online staging", importPauseResume: "Pause/resume",
  importCleanup: "Backup cleanup", importList: "Import list", siteReplace: "Find & Replace", cachePurge: "Cache purge",
  databaseFilters: "Database filters", resourceModes: "Theme/plugin selection", mediaSince: "Media since date", diagnostics: "Diagnostics", safeErrors: "Safe errors",
};
const MODE_NAMES: Record<string, string> = { "shared-replacement": "Shared replacement", "verified-workers": "Verified workers" };

export function pluginUpdate(connection: ZoerConnectConnection, diagnostics?: WordPressDiagnostics | null) {
  const current = diagnostics?.pluginUpdate?.current || connection.status.version;
  const latest = diagnostics?.pluginUpdate?.latest;
  return latest && current && compareVersions(latest, current) > 0 ? latest : null;
}

export default function ConnectionCard({ connection, diagnostics, diagnosticsError, busy, onTest, onReplace, onDisconnect }: {
  connection: ZoerConnectConnection; diagnostics?: WordPressDiagnostics | null; diagnosticsError?: string | null; busy: boolean;
  onTest: () => void; onReplace: () => void; onDisconnect: () => void;
}) {
  const status = connection.status;
  const caps = status.capabilities ?? {};
  const enabled = ZOER_CONNECT_CAPABILITIES.filter(cap => caps[cap] === true);
  const update = pluginUpdate(connection, diagnostics);
  const legacy = !status.apiVersion || status.apiVersion < 2;
  const warnings = connectionWarnings(diagnostics, { url: connection.url });
  const pluginsUrl = `${connection.url.replace(/\/+$/, "")}/wp-admin/plugins.php`;
  const tables = diagnostics?.database?.tables ?? [];
  return <section className="min-w-0 rounded-lg border border-border-default p-3" aria-label="Connected site">
    <p className="font-medium">Connected site</p>
    <p className="break-all text-text-secondary">{connection.url}</p>
    <p className="mt-2 text-xs text-text-secondary">
      Last verified {new Date(connection.testedAt).toLocaleString()} · Plugin {status.version}{status.apiVersion ? ` · API v${status.apiVersion}` : ""}{status.migrationMode ? ` · ${MODE_NAMES[status.migrationMode] ?? status.migrationMode}` : ""}
    </p>
    {update && <p className="mt-2 flex items-center gap-1.5 text-sm text-status-warning"><ArrowUpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />Update available: v{update} · <a className="underline" href={pluginsUrl} target="_blank" rel="noreferrer">Open plugins</a></p>}
    {!update && legacy && <p className="mt-2 text-xs text-status-warning">This site runs an older Zoer Connect. Update to 0.4.0 in <a className="underline" href={pluginsUrl} target="_blank" rel="noreferrer">WordPress → Plugins</a> for database filters, find & replace, review and online staging.</p>}
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Permissions and capabilities">
      {[["Push", status.push], ["Pull", status.pull], ["Publish", status.publish], ["Private staging", status.stagingReady]].map(([label, on]) => <li key={label as string} className={`rounded border px-1.5 py-0.5 text-[12px] ${on ? "border-status-success/40 text-status-success" : "border-border-muted text-text-muted line-through"}`}>{label as string}</li>)}
      {enabled.map(cap => <li key={cap} className="rounded border border-border-muted px-1.5 py-0.5 text-[12px] text-text-secondary">{CAPABILITY_NAMES[cap] ?? cap}</li>)}
    </ul>
    {warnings.length > 0 && <ul className="mt-3 space-y-1" aria-label="Diagnostics warnings">
      {warnings.map(warning => <li key={warning.code} className="flex items-start gap-1.5 text-xs text-status-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{warning.message}</span></li>)}
    </ul>}
    {diagnosticsError && <p className="mt-2 text-xs text-text-secondary">Diagnostics unavailable: {diagnosticsError}</p>}
    <details data-zoer-disclosure className="mt-3"><summary className="text-text-secondary">Connection details and diagnostics</summary>
      <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-text-secondary">Push permission</dt><dd>{status.push ? (status.publish ? "Enabled for imports" : "Enabled for staging") : "Disabled in WordPress"}</dd>
        <dt className="text-text-secondary">Remote pull</dt><dd>{status.pull ? "Supported by plugin" : "Unavailable"}</dd>
        {diagnostics?.wordpress && <><dt className="text-text-secondary">WordPress</dt><dd className="break-all">{diagnostics.wordpress.version ?? "—"} · prefix <code>{diagnostics.wordpress.prefix ?? "?"}</code>{diagnostics.wordpress.locale ? ` · ${diagnostics.wordpress.locale}` : ""}</dd></>}
        {diagnostics?.php && <><dt className="text-text-secondary">PHP</dt><dd>{diagnostics.php.version ?? "—"}{diagnostics.php.memoryLimit ? ` · memory ${diagnostics.php.memoryLimit}` : ""}{diagnostics.php.maxExecutionTime !== undefined ? ` · ${diagnostics.php.maxExecutionTime}s limit` : ""}</dd></>}
        {diagnostics?.database && <><dt className="text-text-secondary">Database</dt><dd>{diagnostics.database.server ?? "MySQL"} {diagnostics.database.version ?? ""} · {tables.length.toLocaleString()} tables · {formatTransferBytes(tables.reduce((sum, t) => sum + (t.bytes ?? 0), 0))}</dd></>}
        {diagnostics?.muPlugins && diagnostics.muPlugins.length > 0 && <><dt className="text-text-secondary">MU plugins</dt><dd className="break-words">{diagnostics.muPlugins.map(p => p.name || p.file).join(", ")}</dd></>}
        {diagnostics?.dropins && diagnostics.dropins.length > 0 && <><dt className="text-text-secondary">Drop-ins</dt><dd className="break-words">{diagnostics.dropins.join(", ")}</dd></>}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2"><Btn disabled={busy} onClick={onTest}>Test connection</Btn><Btn disabled={busy} variant="ghost" onClick={onReplace}>Replace key</Btn><Btn disabled={busy} variant="ghost" onClick={onDisconnect}>Disconnect from Zoer</Btn></div>
      <p className="mt-2 text-xs text-text-secondary">Disconnect removes Zoer's saved key. Revoke the key in WordPress to invalidate other copies.</p>
    </details>
  </section>;
}
