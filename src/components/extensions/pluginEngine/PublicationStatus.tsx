import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Globe2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Btn, Modal, StatusBadge, checkboxClass } from "@zoer/plugin-ui/controls";
import { api } from "../../../lib/api";
import { commitCatalog, engineKeys, startEngineAction, useCatalogKind, useRecentRuns } from "../../../lib/queries/plugin-engine";
import { wordpressKeys, wordpressQueries } from "../../../lib/queries/wordpress";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, runInput } from "./runState";
import {
  cacheHint, cacheLinkRecord, connectionHealth, hostingerCandidates, humanSeconds, isProblem, LAYER_LABELS, LAYER_STATE_LABELS, manualCachePath,
  parseCacheLink, parsePublicationCheck, parsePurgeReceipt, publicationView, purgeReceiptRecord, RESULT_LABELS, type PurgeLayer, type PurgeReceipt,
} from "./publicationCheck";

const VERIFY_ACTIONS = [ENGINE_ACTIONS.verify] as const;
const autoStarted = new Set<string>();

/**
 * What visitors of a Zoer Connect site receive, kept separate from the transfer result: the
 * latest `publication.verify` record, Recheck, and Clear caches and recheck (WordPress, hosting
 * and CDN layers with their own receipts). After Finish of `importId` a check starts by itself.
 */
export default function PublicationStatus({ siteId, siteUrl, importId = null, setId = null, autoStart = false, onReconnect }: {
  siteId: string; siteUrl: string; importId?: string | null; setId?: string | null; autoStart?: boolean;
  /** Opens Provider accounts to reconnect an expired hosting account. */ onReconnect?: () => void;
}) {
  const client = useQueryClient();
  const checks = useCatalogKind("publication-check", { refetchInterval: 15_000 });
  const check = parsePublicationCheck((checks.data ?? []).find(record => record.id === `publication-check:${siteId}`));
  const runs = useRecentRuns(VERIFY_ACTIONS);
  const active = (runs.data ?? []).find(run => runInput(run).siteId === siteId && !isTerminalStatus(run.status));
  const purges = useCatalogKind("cache-purge");
  const receipt = parsePurgeReceipt((purges.data ?? []).find(record => record.id === `cache-purge:${siteId}`));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const finished = useRef(new Set<string>());

  async function verify(reason: "finish" | "recheck" | "after-purge", purgeId?: string) {
    setStarting(true); setError("");
    try {
      await startEngineAction(ENGINE_ACTIONS.verify, { siteId, checkId: newHexId(), reason, ...(importId ? { importId } : {}), ...(setId ? { setId } : {}), ...(purgeId ? { purgeId } : {}) });
      await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    } catch (caught) { setError(engineErrorMessage(caught, "The public check could not start.")); }
    finally { setStarting(false); }
  }

  // Verification runs after Finish released the site: once per publication, unless a check of it exists.
  useEffect(() => {
    if (!autoStart || !importId || checks.isLoading || runs.isLoading || active) return;
    if (check && check.importId === importId) return;
    const key = `${siteId}:${importId}`;
    if (autoStarted.has(key)) return;
    autoStarted.add(key);
    void verify("finish");
  }, [autoStart, importId, checks.isLoading, runs.isLoading, active, check?.importId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished check refreshes the saved record.
  useEffect(() => {
    for (const run of runs.data ?? []) {
      if (runInput(run).siteId !== siteId || !isTerminalStatus(run.status) || finished.current.has(run.runId)) continue;
      finished.current.add(run.runId);
      void client.invalidateQueries({ queryKey: engineKeys.catalog("publication-check") });
    }
  }, [runs.data, siteId, client]);

  const view = publicationView(check, { importId, checking: !!active || starting, purgePending: !!receipt && !!check && check.purgeId === receipt.purgeId && check.status === "stale" });
  const problems = (check?.results ?? []).filter(result => isProblem(result.status));
  const icon = view.tone === "running" ? <Loader2 className="animate-spin" aria-hidden="true" /> : view.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : view.tone === "warning" || view.tone === "error" ? <AlertTriangle aria-hidden="true" /> : <Globe2 aria-hidden="true" />;
  const relevant = check && (!importId || !check.importId || check.importId === importId);

  return <section aria-label="Public website check" className="min-w-0 space-y-2 rounded-lg border border-border-default p-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-medium text-text-heading">Public website</h4>
      <span role="status"><StatusBadge tone={view.tone} icon={icon}>{view.label}</StatusBadge></span>
    </div>
    <p className="text-xs text-text-secondary">{view.description}</p>
    {relevant && check?.status === "current" && <p className="text-xs text-text-secondary">This covers the requests listed below. Other CDN locations and visitors' browsers can still hold older copies for a while.</p>}
    {relevant && problems.length > 0 && <ul className="space-y-1 text-xs" aria-label="Affected addresses">
      {problems.slice(0, 6).map(result => <li key={`${result.url}:${result.variant}`} className="min-w-0 break-words"><span className="font-medium text-text-primary">{result.path === "/" ? "Home" : result.path}</span> · {result.variant} · {RESULT_LABELS[result.status] ?? result.status}{result.freshResponse === "current" ? " (a fresh response is current, so a cache is serving the old copy)" : ""}</li>)}
      {problems.length > 6 && <li className="text-text-secondary">and {problems.length - 6} more</li>}
    </ul>}
    {relevant && check?.advisory && <p className="text-xs text-status-warning">Pages tell browsers they may reuse them for {humanSeconds(check.advisory.maxAgeSeconds)} without asking the server. Clearing caches cannot reach copies already in visitors' browsers; a hard reload shows the current page.</p>}
    {receipt && <PurgeSummary receipt={receipt} />}
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Btn size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={!!active || starting} loading={starting} onClick={() => void verify(importId && !relevant ? "finish" : "recheck")}>{relevant ? "Recheck" : "Check now"}</Btn>
      {relevant && check?.status !== "not-verifiable" && <Btn size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={!!active || starting} onClick={() => setClearing(true)}>Clear caches and recheck</Btn>}
    </div>
    {relevant && check && check.results.length > 0 && <details className="text-xs">
      <summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Checked requests ({check.results.length})</summary>
      <ul className="mt-2 space-y-1">{check.results.map(result => <li key={`${result.url}:${result.variant}:${result.kind}`} className="min-w-0 break-all rounded border border-border-muted px-2 py-1">
        <span className={isProblem(result.status) ? "text-status-warning" : "text-status-success"}>{RESULT_LABELS[result.status] ?? result.status}</span> · {result.variant} · {result.url.replace(/^https?:\/\/[^/]+/, "") || "/"}{result.httpStatus ? ` · HTTP ${result.httpStatus}` : ""}{cacheHint(result.headers) ? ` · ${cacheHint(result.headers)}` : ""}{result.redirects?.length ? ` · ${result.redirects.length} redirect${result.redirects.length === 1 ? "" : "s"}` : ""}
        {result.detail && <span className="block text-text-secondary">{result.detail}</span>}
      </li>)}</ul>
      {check.wordpressCache && <p className="mt-2 text-text-secondary">Last WordPress cache purge on the site: {check.wordpressCache.state === "queued" ? "queued, waiting for the next page load" : check.wordpressCache.ranAt ? new Date(Number(check.wordpressCache.ranAt) * 1000).toLocaleString() : "not recorded"}.</p>}
    </details>}
    {error && <p role="alert" className="break-words text-sm text-status-error">{error}</p>}
    {clearing && <ClearCachesDialog siteId={siteId} siteUrl={siteUrl} onClose={() => setClearing(false)} onReconnect={onReconnect} onDone={purgeId => { setClearing(false); void verify("after-purge", purgeId); }} />}
  </section>;
}

function PurgeSummary({ receipt }: { receipt: PurgeReceipt }) {
  return <details className="text-xs">
    <summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Last cache clearing · {receipt.requestedAt ? new Date(receipt.requestedAt).toLocaleString() : ""}</summary>
    <ul className="mt-2 space-y-1">{receipt.layers.map(layer => <li key={layer.layer} className="min-w-0 break-words"><span className="font-medium text-text-primary">{LAYER_LABELS[layer.layer]}</span>: {LAYER_STATE_LABELS[layer.state]} · {layer.detail}</li>)}</ul>
  </details>;
}

/**
 * Clear caches and recheck: each layer has its own capability and receipt. WordPress caches go
 * through Zoer Connect (`publication.purge`, Zoer's approval). The hosting cache goes through the
 * existing Hostinger site tool, only for a hosting website the user linked explicitly and only
 * when its account answers now; Hostinger documents that this also purges its CDN when enabled,
 * which stays "requested" until the public check passes.
 */
function ClearCachesDialog({ siteId, siteUrl, onClose, onDone, onReconnect }: { siteId: string; siteUrl: string; onClose: () => void; onDone: (purgeId: string) => void; onReconnect?: () => void }) {
  const client = useQueryClient();
  const sites = useQuery(wordpressQueries.sites()).data ?? [];
  const connections = useQuery(wordpressQueries.connections()).data ?? [];
  const links = useCatalogKind("cache-link");
  const link = parseCacheLink((links.data ?? []).find(record => record.id === `cache-link:${siteId}`));
  const candidates = hostingerCandidates(sites, siteUrl);
  const linkedSite = link ? sites.find(site => site.id === link.hostingerSiteId) ?? null : null;
  const connection = connections.find(item => item.id === (linkedSite?.connectionId ?? link?.connectionId));
  const health = connectionHealth(connection);
  const [wordpress, setWordpress] = useState(true);
  const [hosting, setHosting] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  let host = "";
  try { host = new URL(siteUrl).hostname; } catch { /* shown below */ }

  async function linkSite(hostingerSiteId: string) {
    const site = candidates.find(item => item.id === hostingerSiteId);
    if (!site?.connectionId || !site.domain) return;
    setBusy("link"); setError("");
    try {
      await commitCatalog({ records: [cacheLinkRecord({ siteId, hostingerSiteId: site.id, connectionId: site.connectionId, domain: site.domain, linkedAt: new Date().toISOString() })] }, "cache-link");
      await client.invalidateQueries({ queryKey: engineKeys.catalog("cache-link") });
    } catch (caught) { setError(engineErrorMessage(caught, "Could not save the hosting link.")); }
    finally { setBusy(null); }
  }

  async function run() {
    const purgeId = newHexId();
    const layers: PurgeLayer[] = [];
    setBusy("purge"); setError("");
    try {
      if (hosting && link && linkedSite) {
        // An earlier "Connected" is not current access: test the account before using it.
        let usable = false;
        try { await api.testWordPressManagerConnection(link.connectionId); usable = true; }
        catch (caught) {
          const detail = `The Hostinger account did not answer: ${engineErrorMessage(caught)}. Reconnect it, or use ${manualCachePath(link.domain)}`;
          layers.push({ layer: "server", provider: "hostinger", state: "unavailable", detail }, { layer: "cdn", provider: "hostinger", state: "unavailable", detail: "Not attempted; the hosting account needs reconnecting." });
          void client.invalidateQueries({ queryKey: wordpressKeys.all() });
        }
        if (usable) {
          try {
            const result = await api.runHostingerSiteTool(linkedSite.id, "clear-cache");
            layers.push({ layer: "server", provider: "hostinger", state: "accepted", detail: `Hostinger accepted “Clear cache” for ${link.domain}.`, at: result.requestedAt },
              { layer: "cdn", provider: "hostinger", state: "requested", detail: "Requested with the website cache clear (Hostinger documents that it also purges its CDN when enabled). Not separately confirmed; the recheck shows whether visitors get the new pages.", at: result.requestedAt });
          } catch (caught) {
            layers.push({ layer: "server", provider: "hostinger", state: "failed", detail: `${engineErrorMessage(caught)}. Manual path: ${manualCachePath(link.domain)}` }, { layer: "cdn", provider: "hostinger", state: "failed", detail: "Not purged; see the hosting cache result." });
          }
        }
      } else layers.push({ layer: "server", provider: link ? "hostinger" : "none", state: "skipped", detail: link ? "Not selected." : `No hosting website is linked. Manual path for Hostinger sites: ${manualCachePath(host || "this site")}` });
      if (wordpress) {
        try {
          const runId = await startEngineAction(ENGINE_ACTIONS.purge, { siteId, purgeId }, { approval: true });
          layers.push({ layer: "wordpress", provider: "zoer-connect", state: "requested", detail: `Sent to Zoer Connect after Zoer's approval (run ${runId.slice(0, 8)}). Cache plugins give no confirmation; the recheck is the evidence.` });
        } catch (caught) { layers.push({ layer: "wordpress", provider: "zoer-connect", state: "failed", detail: engineErrorMessage(caught) }); }
      } else layers.push({ layer: "wordpress", provider: "zoer-connect", state: "skipped", detail: "Not selected." });
      await commitCatalog({ records: [purgeReceiptRecord({ siteId, purgeId, requestedAt: new Date().toISOString(), layers })] }, "cache-purge");
      await client.invalidateQueries({ queryKey: engineKeys.catalog("cache-purge") });
      onDone(purgeId);
    } catch (caught) { setError(engineErrorMessage(caught, "Cache clearing could not be recorded.")); }
    finally { setBusy(null); }
  }

  return <Modal mobileSheet title="Clear caches and recheck" onClose={() => { if (!busy) onClose(); }}>
    <div className="min-w-0 space-y-4 text-sm">
      <p className="text-text-secondary">Clears each cache layer you choose, then rechecks the public site for up to about 16 minutes. Nothing is republished.</p>
      <label className="flex min-h-11 items-start gap-2"><input type="checkbox" className={`${checkboxClass} mt-1`} checked={wordpress} onChange={event => setWordpress(event.target.checked)} disabled={!!busy} />
        <span><span className="block font-medium">WordPress caches</span><span className="block text-xs text-text-secondary">Cache plugins and the object cache, through Zoer Connect 0.6.0+. Zoer asks for approval.</span></span></label>
      <div className="space-y-2 rounded-lg border border-border-default p-3">
        <label className="flex min-h-11 items-start gap-2"><input type="checkbox" className={`${checkboxClass} mt-1`} checked={hosting && !!link} onChange={event => setHosting(event.target.checked)} disabled={!!busy || !link} />
          <span><span className="block font-medium">Hosting cache and CDN</span><span className="block text-xs text-text-secondary">{link ? `Hostinger · ${link.domain} · account ${connection?.name ?? link.connectionId} · ${health.label}` : "Link the hosting website first."}</span></span></label>
        {link && !health.ok && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-status-warning"><span>The Hostinger account needs reconnecting before Zoer can clear its cache.</span>{onReconnect && <Btn size="sm" onClick={onReconnect}>Reconnect</Btn>}</div>}
        {!link && candidates.length > 0 && <div className="space-y-1">{candidates.map(site => <div key={site.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>Hostinger website <strong>{site.domain}</strong> ({connections.find(item => item.id === site.connectionId)?.name ?? "account"})</span><Btn size="sm" loading={busy === "link"} disabled={!!busy} onClick={() => void linkSite(site.id)}>Use for cache clearing</Btn></div>)}
          <p className="text-xs text-text-secondary">Listed because a connected Hostinger account reports this exact domain. Linking only allows cache clearing.</p></div>}
        {!link && !candidates.length && <p className="text-xs text-text-secondary">No connected hosting account lists {host || "this domain"}. Clear it in your host's dashboard (for Hostinger: {manualCachePath(host || "this site")}), then choose Recheck.</p>}
      </div>
      {error && <p role="alert" className="break-words text-status-error">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Btn onClick={onClose} disabled={!!busy}>Cancel</Btn><Btn variant="primary" loading={busy === "purge"} disabled={!!busy || (!wordpress && !(hosting && link))} onClick={() => void run()}>Clear and recheck</Btn></div>
    </div>
  </Modal>;
}
