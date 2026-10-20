import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Btn, Modal } from "@zoer/plugin-ui/controls";
import { api, type HostingerConnectionPublic, type WordPressManagedSite } from "../../lib/api";
import { json } from "../../lib/api/_http";
import type { ZoerConnectConnection } from "../../lib/api/types/wordpress-transfer";
import { cancelRun, commitCatalog, engineKeys, listCatalog, useCatalogKind, useRecentRuns } from "../../lib/queries/plugin-engine";
import { wordpressQueries } from "../../lib/queries/wordpress";
import { defaultImportOptions } from "../../lib/wordpress-transfer/options";
import HostingerWebsiteSetup from "./HostingerWebsiteSetup";
import { hostingerTestSites, type HostingerTestSite } from "./hostingerTestSites";
import { PushProgress, pushExportOptions, requestOneClickPush, startPushExport } from "./pluginEngine/OneClickPush";
import { findOneClickPush, isOneClickPush } from "./pluginEngine/oneClickRuns";
import type { RecentRun } from "./pluginEngine/runState";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, progressView, SITE_RUN_ACTIONS } from "./pluginEngine/runState";

/**
 * Create a live site for a local site that has none, as one process: Hostinger creates the
 * website and Zoer pairs Zoer Connect while the local site is already being exported; when the
 * website is ready, the page links the two, starts the comparison and requests the push (Zoer asks
 * once), which then sends everything and finishes by itself. The plan is a `go-live:<local site>`
 * catalog record, so it carries on after a reload or in another browser.
 */
export interface GoLivePlan { sourceSiteId: string; deploymentId: string; connectionId: string; domain: string; pullId: string; exportRunId: string; startedAt: string; endpointId?: string; pushRunId?: string; error?: string }

const KIND = "go-live";
const recordId = (sourceSiteId: string) => `go-live:${sourceSiteId}`;
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
const RUN_ACTIONS = [...SITE_RUN_ACTIONS, ENGINE_ACTIONS.preview] as const;

export function parseGoLivePlan(record: { kind?: string; data?: unknown }): GoLivePlan | null {
  const data = record.data as Partial<GoLivePlan> | undefined;
  if (record.kind !== KIND || !data) return null;
  const text = (value: unknown) => typeof value === "string" && value ? value : undefined;
  const sourceSiteId = text(data.sourceSiteId), deploymentId = text(data.deploymentId), connectionId = text(data.connectionId), domain = text(data.domain), pullId = text(data.pullId), exportRunId = text(data.exportRunId), startedAt = text(data.startedAt);
  if (!sourceSiteId || !deploymentId || !connectionId || !domain || !pullId || !exportRunId || !startedAt) return null;
  return { sourceSiteId, deploymentId, connectionId, domain, pullId, exportRunId, startedAt, endpointId: text(data.endpointId), pushRunId: text(data.pushRunId), error: text(data.error) };
}

async function saveGoLivePlan(plan: GoLivePlan) {
  await commitCatalog({ records: [{ id: recordId(plan.sourceSiteId), kind: KIND, title: `Go live ${plan.domain}`, data: { v: 1, ...plan } }] }, KIND);
}
async function forgetGoLivePlan(sourceSiteId: string) {
  await commitCatalog({ deletes: [recordId(sourceSiteId)] }, KIND);
}

/** The plan as saved now (the list query may be older). */
async function readGoLivePlan(sourceSiteId: string) {
  const { records } = await listCatalog(KIND, { prefix: recordId(sourceSiteId), max: 5 });
  const record = records.find(item => item.id === recordId(sourceSiteId));
  return record ? parseGoLivePlan(record) : null;
}

/** The one-click push this plan started: from its local site, after the plan began (to its endpoint when known). */
export function planPush(plan: Pick<GoLivePlan, "sourceSiteId" | "startedAt" | "endpointId">, runs: readonly RecentRun[]) {
  const pushes = runs.filter(run => isOneClickPush(run) && (run.input as { sourceSiteId?: unknown }).sourceSiteId === plan.sourceSiteId && Date.parse(run.createdAt) >= Date.parse(plan.startedAt)
    && (!plan.endpointId || (run.input as { siteId?: unknown }).siteId === plan.endpointId));
  const push = pushes.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return push ? findOneClickPush(runs, plan.sourceSiteId, (push.input as { siteId: string }).siteId) : null;
}

export function useGoLivePlans() {
  const records = useCatalogKind(KIND);
  return (records.data ?? []).map(parseGoLivePlan).filter((plan): plan is GoLivePlan => !!plan);
}

/** The step a go-live plan is at, from its website receipt and its push. */
export function goLiveStage(plan: GoLivePlan, site: HostingerTestSite | undefined): { text: string; tone: "running" | "warning" | "error" } {
  if (plan.error) return { text: plan.error, tone: "error" };
  if (!site) return { text: `Creating ${plan.domain}…`, tone: "running" };
  if (site.running) return { text: `Creating ${plan.domain}: ${site.step.charAt(0).toLowerCase()}${site.step.slice(1)}…`, tone: "running" };
  if (!site.ready) return { text: `Creating ${plan.domain} stopped: ${site.error ?? site.step}`, tone: "error" };
  return { text: plan.pushRunId ? `Publishing to ${plan.domain}…` : `${plan.domain} is ready; starting the push…`, tone: "running" };
}

/**
 * Carries go-live plans on while the WordPress page is open: once a plan's website is ready and
 * its Zoer Connect endpoint is listed, links the local site to it and requests the push.
 */
export function useGoLiveOrchestrator(sites: WordPressManagedSite[]) {
  const client = useQueryClient();
  const plans = useGoLivePlans();
  const pending = plans.filter(plan => !plan.pushRunId && !plan.error);
  const deployments = useQuery({ ...wordpressQueries.deployments(), refetchInterval: pending.length ? 10_000 : false });
  const endpoints = useQuery({ ...wordpressQueries.endpoints(), refetchInterval: pending.length ? 15_000 : false });
  const runs = useRecentRuns(RUN_ACTIONS, { enabled: plans.length > 0 });
  // A plan whose push succeeded is done: the sites are linked and Local and live shows the push.
  useEffect(() => {
    for (const plan of plans) {
      const found = planPush(plan, runs.data ?? []);
      if (!found || found.push.status !== "succeeded" || busy.current.has(`done:${plan.sourceSiteId}`)) continue;
      busy.current.add(`done:${plan.sourceSiteId}`);
      void forgetGoLivePlan(plan.sourceSiteId).catch(() => undefined).finally(() => void client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }));
    }
  }, [plans, runs.data, client]);
  // Plans this tab has handled stay claimed: a list read older than the push must not start another.
  const busy = useRef(new Set<string>());
  useEffect(() => {
    const created = hostingerTestSites(deployments.data ?? []);
    for (const plan of pending) {
      const site = created.find(item => item.id === plan.deploymentId);
      const source = sites.find(item => item.id === plan.sourceSiteId);
      const endpoint = (endpoints.data?.endpoints ?? []).find(item => item.alias === "site" && host(item.origin) === plan.domain.toLowerCase());
      if (!site?.ready || !source || !endpoint || busy.current.has(plan.sourceSiteId) || !runs.data) continue;
      busy.current.add(plan.sourceSiteId);
      void (async () => {
        let current: GoLivePlan = { ...plan, endpointId: endpoint.id };
        try {
          // Another tab, or this one before a reload, may have started it already.
          const saved = await readGoLivePlan(plan.sourceSiteId);
          if (!saved || saved.pushRunId || saved.error) return;
          const existing = planPush(current, runs.data ?? []);
          if (existing) { await saveGoLivePlan({ ...current, pushRunId: existing.push.runId }); return; }
          const { connection } = await json<{ connection: ZoerConnectConnection | null }>(`/wordpress-manager/connect/${encodeURIComponent(endpoint.id)}`);
          if (!connection) throw new Error(`${plan.domain} has no Zoer Connect key yet.`);
          // The new website is this local site's live site from now on (Local and live, Push to live).
          await commitCatalog({ records: [{ id: `site-link:${source.id}`, kind: "site-link", title: `Live site of ${source.name}`, data: { v: 1, targetSiteId: source.id, sourceSiteId: endpoint.id } }] }, "site-link");
          // Claim the plan before asking, so another tab does not request a second push.
          current = { ...current, pushRunId: "requesting" };
          await saveGoLivePlan(current);
          const caps = connection.status.capabilities;
          const started = await requestOneClickPush({ source, destinationId: endpoint.id, connection, pullId: plan.pullId, mode: "everything", importOptions: { ...defaultImportOptions(), createTables: caps?.createTables === true } });
          current = { ...current, pushRunId: started.push };
          await saveGoLivePlan(current);
        } catch (caught) {
          await saveGoLivePlan({ ...current, pushRunId: undefined, error: `Could not start the push: ${engineErrorMessage(caught)}` }).catch(() => undefined);
        } finally {
          await Promise.all([client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }), client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") }), client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] })]);
        }
      })();
    }
  }, [pending, deployments.data, endpoints.data, runs.data, sites, client]);
}

function Step({ state, label, detail }: { state: "done" | "active" | "pending" | "failed"; label: string; detail?: string | null }) {
  const icon = state === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" /> : state === "active" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" /> : state === "failed" ? <XCircle className="h-4 w-4 shrink-0 text-status-error" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />;
  return <li className="min-w-0"><div className={`flex min-h-7 items-center gap-2 text-sm ${state === "pending" ? "text-text-muted" : ""} ${state === "active" ? "font-medium" : ""}`}>{icon}<span className="min-w-0 break-words">{label}</span></div>
    {detail && <p className={`ml-6 break-words text-xs ${state === "failed" ? "text-status-error" : "text-text-secondary"}`}>{detail}</p>}</li>;
}

/**
 * Create a live site: before starting, the Hostinger form (plan, temporary domain); afterwards the
 * process: create the website (with the export running alongside), then the push's own stages.
 */
export function GoLiveDialog({ source, connections, onClose, onStartSource }: { source: WordPressManagedSite; connections: HostingerConnectionPublic[]; onClose: () => void; onStartSource?: () => void }) {
  const client = useQueryClient();
  const plans = useGoLivePlans();
  const saved = plans.find(item => item.sourceSiteId === source.id) ?? null;
  // A finished plan is forgotten; the dialog keeps showing how it ended.
  const [lastPlan, setLastPlan] = useState<GoLivePlan | null>(null);
  useEffect(() => { if (saved) setLastPlan(saved); }, [saved]);
  const plan = saved ?? lastPlan;
  const deployments = useQuery(wordpressQueries.deployments());
  const site = plan ? hostingerTestSites(deployments.data ?? []).find(item => item.id === plan.deploymentId) : undefined;
  const runs = useRecentRuns(RUN_ACTIONS);
  const exportRun = plan ? (runs.data ?? []).find(run => run.runId === plan.exportRunId) ?? null : null;
  const oneClick = plan ? planPush(plan, runs.data ?? []) : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = source.status === "running";

  async function started(deployment: { id: string; connectionId?: string | null; domain?: string | null }) {
    setError("");
    try {
      // The export runs while Hostinger sets up the website, so the push can start as soon as it is ready.
      const exported = await startPushExport(source, pushExportOptions("everything"));
      await saveGoLivePlan({ sourceSiteId: source.id, deploymentId: deployment.id, connectionId: deployment.connectionId ?? "", domain: deployment.domain ?? "", pullId: exported.pullId, exportRunId: exported.runId, startedAt: new Date().toISOString() });
    } catch (caught) { setError(`The website is being created, but the local export could not start: ${engineErrorMessage(caught)}`); }
    finally { await client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }); await client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] }); }
  }
  async function retrySetup() {
    if (!plan || !site) return;
    setBusy(true); setError("");
    try { await api.retryHostingerTestSite(site.connectionId, site.id); await deployments.refetch(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not continue the setup."); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!plan) return;
    setBusy(true); setError("");
    try {
      if (exportRun && !isTerminalStatus(exportRun.status) && !plan.pushRunId) await cancelRun(exportRun.runId).catch(() => undefined);
      await forgetGoLivePlan(source.id);
      setLastPlan(null);
      await client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) });
    } catch (caught) { setError(engineErrorMessage(caught)); }
    finally { setBusy(false); }
  }

  const exportView = exportRun && !isTerminalStatus(exportRun.status) ? progressView(exportRun.resumable?.progress) : null;
  const exportFailed = !!exportRun && isTerminalStatus(exportRun.status) && exportRun.status !== "succeeded";
  const ended = !!oneClick && isTerminalStatus(oneClick.push.status);
  return <Modal mobileSheet size="wide" title={plan ? `Live site for ${source.name}` : "Create a live site"} onClose={onClose}>
    <div className="min-w-0 space-y-4 text-sm">
      {!plan && <>
        {!running && <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/40 p-3"><span className="min-w-0 flex-1">Start <strong>{source.name}</strong> first; its export runs while the website is created.</span>{onStartSource && <Btn size="sm" onClick={onStartSource}>Start site</Btn>}</div>}
        {connections.length ? <div className={running ? "" : "pointer-events-none opacity-50"} aria-disabled={!running}>
          <HostingerWebsiteSetup newSite connections={connections} onCreated={() => void deployments.refetch()} onStarted={started} createLabel="Create and publish"
            confirmText={`Hostinger creates the website with WordPress and Zoer pairs Zoer Connect (about 5 to 15 minutes), while ${source.name} is exported. When the website is ready, everything from ${source.name} is pushed into it. Zoer asks you to approve the push once.`}
            intro={<p className="text-[12px] leading-5 text-text-secondary">A new Hostinger website on a free temporary domain, with Zoer Connect, that becomes the live site of <strong>{source.name}</strong>. Everything from {source.name} is pushed into it as soon as it's ready; you approve once.</p>} />
        </div> : <p>Connect a Hostinger account under <strong>Provider accounts</strong> first.</p>}
      </>}
      {plan && <>
        <p className="text-text-secondary">{source.name} → <strong className="text-text-primary">{plan.domain}</strong></p>
        <ol className="min-w-0 space-y-1.5 rounded-lg border border-border-default p-3" aria-label="Go-live stages">
          <Step state={site?.ready ? "done" : site && !site.running ? "failed" : "active"} label={`Create ${plan.domain} on Hostinger with Zoer Connect`} detail={site?.ready ? null : site && !site.running ? (site.error ?? site.step) : (site?.step ?? "Starting…")} />
          <Step state={exportRun?.status === "succeeded" ? "done" : exportFailed ? "failed" : "active"} label={`Export ${source.name}`} detail={exportFailed ? (exportRun?.error ?? "The export stopped.") : exportView ? [exportView.label, exportView.detail].filter(Boolean).join(" · ") : null} />
          <Step state={oneClick ? "done" : plan.error ? "failed" : "pending"} label="Link the sites and start the push" detail={oneClick ? null : plan.error ?? (site?.ready ? "Starting… keep this page open; Zoer asks you to approve the push." : null)} />
        </ol>
        {oneClick && <PushProgress key={oneClick.push.runId} runs={oneClick} destinationHost={plan.domain} />}
        <div className="flex flex-wrap gap-2">
          {site && !site.ready && !site.running && <Btn size="sm" loading={busy} onClick={() => void retrySetup()}>Retry setup</Btn>}
          {(!oneClick || ended) && <Btn size="sm" variant="ghost" loading={busy} onClick={() => void stop()}>{ended ? "Done" : "Stop here"}</Btn>}
        </div>
        {!ended && <p className="text-xs text-text-secondary">Runs on the Zoer server. Keep the WordPress page open in some tab so the push starts when the website is ready; you can close this window.</p>}
      </>}
      {error && <p role="alert" className="break-words text-status-error">{error}</p>}
    </div>
  </Modal>;
}
