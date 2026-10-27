import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Btn, Modal } from "@zoer/plugin-ui/controls";
import { api, type HostingerConnectionPublic, type WordPressManagedSite } from "../../lib/api";
import { json } from "../../lib/api/_http";
import type { ZoerConnectConnection } from "../../lib/api/types/wordpress-transfer";
import { cancelRun, commitCatalog, engineKeys, getRun, listCatalog, startEngineAction, useCatalogKind, useRecentRuns } from "../../lib/queries/plugin-engine";
import { wordpressQueries } from "../../lib/queries/wordpress";
import { defaultImportOptions } from "../../lib/wordpress-transfer/options";
import HostingerWebsiteSetup from "./HostingerWebsiteSetup";
import { addStackLive, DEPLOY_KIND } from "./siteStack";
import { hostingerTestSites, type HostingerTestSite } from "./hostingerTestSites";
import { PushProgress, pushExportOptions, pushImportOptions, requestOneClickPush, startPushExport } from "./pluginEngine/OneClickPush";
import { findOneClickPush, isOneClickPush } from "./pluginEngine/oneClickRuns";
import type { RecentRun } from "./pluginEngine/runState";
import { ENGINE_ACTIONS, engineErrorMessage, isTerminalStatus, newHexId, progressView, runInput, SITE_RUN_ACTIONS } from "./pluginEngine/runState";

/**
 * Create a live site for a local site, as one process: Hostinger creates the website and Zoer
 * pairs Zoer Connect while the local site is already being exported; when the website is ready,
 * the push, requested and approved when the user confirmed (Zoer asks once, right then), binds
 * to it by its exact address and sends everything, finishing by itself. A local site without a live site is linked to the new one; a
 * local site that has one keeps it, and the new website is another live site of its own. The plan
 * is a `go-live:<local site>` catalog record, so it carries on after a reload or in another browser.
 */
export interface GoLivePlan { sourceSiteId: string; deploymentId: string; connectionId: string; domain: string; pullId: string; exportRunId: string; startedAt: string; endpointId?: string; pushRunId?: string; error?: string }

const KIND = "go-live";
const recordId = (sourceSiteId: string) => `go-live:${sourceSiteId}`;
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
const RUN_ACTIONS = [...SITE_RUN_ACTIONS, ENGINE_ACTIONS.preview] as const;

/**
 * Zoer's decision on a requested push. A new run is pending, then claimed and running for a moment
 * before it waits for approval, so none of those statuses means approved: only a started worker
 * does (Zoer starts it after the approval). An ended run that never started was declined.
 */
export function pushApproval(run: { status: string; resumable?: { startedAt?: string | null; slices?: number } | null }): "pending" | "approved" | "declined" {
  if (run.resumable?.startedAt || (run.resumable?.slices ?? 0) > 0) return "approved";
  return isTerminalStatus(run.status) ? "declined" : "pending";
}

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

/**
 * Capabilities of the Zoer Connect release Zoer installs on the websites it creates (0.9.1): the
 * push is requested before the website exists, so its options cannot come from the site's status.
 */
const CREATED_SITE_CAPABILITIES = { replacementVariants: true, replacementRules: true, keepActivePlugins: true, authorMapping: true, createTables: true, reviewPause: true, lateFence: true, cachePurge: true };

/**
 * Requests the push of the local export `pullId` into the website `domain` that Hostinger is still
 * creating, and its comparison: Zoer asks for the push's approval now, and both wait on the server
 * until a Zoer Connect site with exactly that address is listed (`siteId` `await:<domain>`, worker
 * push.js). The comparison leaves out what the new WordPress already has, as on any one-click push.
 */
export async function requestNewWebsitePush(source: WordPressManagedSite, domain: string, pullId: string) {
  const name = domain.trim().toLowerCase(), siteId = `await:${name}`, previewId = newHexId();
  const push = await startEngineAction(ENGINE_ACTIONS.push, {
    siteId, confirmTarget: `https://${name}`, exportPullId: pullId, sourceSiteId: source.id, importId: newHexId(), previewId, autoSelect: { database: true },
    importOptions: pushImportOptions("everything", { ...defaultImportOptions(), createTables: true }, CREATED_SITE_CAPABILITIES),
    finishAutomatically: true, replacementAccepted: true,
  }, { approval: true });
  try { return { push, preview: await startEngineAction(ENGINE_ACTIONS.preview, { siteId, previewId, exportPullId: pullId }) }; }
  catch (caught) { await cancelRun(push).catch(() => undefined); throw caught; }
}

/** The one-click push this plan started: its own run, or (older plans) the newest from its local site after the plan began. */
export function planPush(plan: Pick<GoLivePlan, "sourceSiteId" | "startedAt" | "endpointId" | "pushRunId">, runs: readonly RecentRun[]) {
  const own = plan.pushRunId ? runs.find(run => run.runId === plan.pushRunId) : undefined;
  if (own) return findOneClickPush(runs, plan.sourceSiteId, String(runInput(own).siteId));
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
 * its Zoer Connect endpoint is listed, links a local site without a live site to it. (Plans saved
 * before the push was requested at once also request their push here.)
 */
export function useGoLiveOrchestrator(sites: WordPressManagedSite[]) {
  const client = useQueryClient();
  const plans = useGoLivePlans();
  const pending = plans.filter(plan => !plan.pushRunId && !plan.error);
  // Plans whose push was approved up front: the endpoint still has to be recorded (and linked).
  const unbound = plans.filter(plan => plan.pushRunId && plan.pushRunId !== "requesting" && !plan.endpointId && !plan.error);
  const deployments = useQuery({ ...wordpressQueries.deployments(), refetchInterval: pending.length || unbound.length ? 10_000 : false });
  const endpoints = useQuery({ ...wordpressQueries.endpoints(), refetchInterval: pending.length || unbound.length ? 15_000 : false });
  const runs = useRecentRuns(RUN_ACTIONS, { enabled: plans.length > 0 });
  // A plan whose push succeeded is done: the sites are linked and Local and live shows the push.
  useEffect(() => {
    for (const plan of plans) {
      const found = planPush(plan, runs.data ?? []);
      // An approved-up-front plan is linked first (its endpoint recorded), then forgotten.
      if (!found || found.push.status !== "succeeded" || (plan.pushRunId && !plan.endpointId) || busy.current.has(`done:${plan.sourceSiteId}`)) continue;
      busy.current.add(`done:${plan.sourceSiteId}`);
      void forgetGoLivePlan(plan.sourceSiteId).catch(() => undefined).finally(() => void client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }));
    }
  }, [plans, runs.data, client]);
  // Plans this tab has handled stay claimed: a list read older than the push must not start another.
  const busy = useRef(new Set<string>());
  useEffect(() => {
    for (const plan of unbound) {
      const source = sites.find(item => item.id === plan.sourceSiteId);
      const endpoint = (endpoints.data?.endpoints ?? []).find(item => item.alias === "site" && host(item.origin) === plan.domain.toLowerCase());
      if (!source || !endpoint || busy.current.has(`link:${plan.sourceSiteId}`)) continue;
      busy.current.add(`link:${plan.sourceSiteId}`);
      void (async () => {
        try {
          const saved = await readGoLivePlan(plan.sourceSiteId);
          if (!saved || saved.endpointId || saved.pushRunId !== plan.pushRunId) return;
          // Without a live site, the new website becomes this local site's; one that has one keeps
          // it as the main live site, and the new website joins its card as another live site.
          if (!source.sourceSiteId) await commitCatalog({ records: [{ id: `site-link:${source.id}`, kind: "site-link", title: `Live site of ${source.name}`, data: { v: 1, targetSiteId: source.id, sourceSiteId: endpoint.id } }] }, "site-link");
          else await addStackLive(source, endpoint.id);
          await saveGoLivePlan({ ...saved, endpointId: endpoint.id });
        } catch { busy.current.delete(`link:${plan.sourceSiteId}`); }
        finally { await Promise.all([client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }), client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") }), client.invalidateQueries({ queryKey: engineKeys.catalog(DEPLOY_KIND) })]); }
      })();
    }
  }, [unbound, endpoints.data, sites, client]);
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
          // Without a live site, the new website becomes this local site's (Local and live, Push to live);
          // a local site that has one keeps it, so deploying another instance never moves its pairing.
          if (!source.sourceSiteId) await commitCatalog({ records: [{ id: `site-link:${source.id}`, kind: "site-link", title: `Live site of ${source.name}`, data: { v: 1, targetSiteId: source.id, sourceSiteId: endpoint.id } }] }, "site-link");
          else await addStackLive(source, endpoint.id);
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
          await Promise.all([client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }), client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") }), client.invalidateQueries({ queryKey: engineKeys.catalog(DEPLOY_KIND) }), client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] })]);
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
export function GoLiveDialog({ source, live = null, connections, onClose, onStartSource }: { source: WordPressManagedSite; /** The live site the local site already has: it stays linked and unchanged. */ live?: WordPressManagedSite | null; connections: HostingerConnectionPublic[]; onClose: () => void; onStartSource?: () => void }) {
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

  // Started when the user confirms, before the website is created: the export (it runs while
  // Hostinger sets up the website) and the push, so Zoer asks for its one approval right then.
  const prepared = useRef<{ domain: string; pullId: string; exportRunId: string; pushRunId: string; startedAt: string } | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  /** Zoer's decision on the push: approving it is the one confirmation; the website is created only then. */
  async function approvalOf(pushRunId: string) {
    const deadline = Date.now() + 15 * 60_000;
    for (;;) {
      const run = await getRun(pushRunId).catch(() => null);
      const decision = run ? pushApproval(run) : "pending";
      if (decision !== "pending") return decision;
      if (Date.now() > deadline) return "timeout";
      await new Promise(done => setTimeout(done, 2_000));
    }
  }
  async function confirmed(domain: string) {
    setError("");
    const startedAt = new Date().toISOString();
    let exported: { pullId: string; runId: string };
    try { exported = await startPushExport(source, pushExportOptions("everything")); }
    catch (caught) { throw new Error(`Nothing was created: ${source.name} could not be exported (${engineErrorMessage(caught)}).`); }
    let pushRunId: string, previewRunId: string;
    try { ({ push: pushRunId, preview: previewRunId } = await requestNewWebsitePush(source, domain, exported.pullId)); }
    catch (caught) { await cancelRun(exported.runId).catch(() => undefined); throw new Error(`Nothing was created: the push could not be requested (${engineErrorMessage(caught)}).`); }
    const undo = async () => { prepared.current = null; await Promise.all([cancelRun(pushRunId), cancelRun(previewRunId), cancelRun(exported.runId)].map(done => done.catch(() => undefined))); };
    void client.invalidateQueries({ queryKey: [...engineKeys.all(), "recent"] });
    setApproving(domain);
    const decision = await approvalOf(pushRunId).finally(() => setApproving(null));
    if (decision !== "approved") { await undo(); throw new Error(decision === "declined" ? "The push was declined in Zoer, so nothing was created." : "Zoer's approval was not given within 15 minutes, so nothing was created."); }
    prepared.current = { domain, pullId: exported.pullId, exportRunId: exported.runId, pushRunId, startedAt };
    return { undo };
  }
  async function started(deployment: { id: string; connectionId?: string | null; domain?: string | null }) {
    const ready = prepared.current;
    if (!ready) return;
    try { await saveGoLivePlan({ sourceSiteId: source.id, deploymentId: deployment.id, connectionId: deployment.connectionId ?? "", domain: deployment.domain ?? ready.domain, pullId: ready.pullId, exportRunId: ready.exportRunId, pushRunId: ready.pushRunId, startedAt: ready.startedAt }); }
    catch (caught) { setError(`The website, export and push are under way, but this page could not save their progress: ${engineErrorMessage(caught)}`); }
    finally { await client.invalidateQueries({ queryKey: engineKeys.catalog(KIND) }); }
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
  const another = !!live;
  return <Modal mobileSheet size="wide" title={plan ? `Live site for ${source.name}` : another ? "Deploy to a new Hostinger website" : "Create a live site"} onClose={onClose}>
    <div className="min-w-0 space-y-4 text-sm">
      {!plan && <>
        {!running && <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/40 p-3"><span className="min-w-0 flex-1">Start <strong>{source.name}</strong> first; its export runs while the website is created.</span>{onStartSource && <Btn size="sm" onClick={onStartSource}>Start site</Btn>}</div>}
        {connections.length ? <div className={running ? "" : "pointer-events-none opacity-50"} aria-disabled={!running}>
          <HostingerWebsiteSetup newSite confirmedInFlow connections={connections} onCreated={() => void deployments.refetch()} onConfirmed={confirmed} onStarted={started} createLabel="Create and publish"
            intro={another
              ? <p className="text-[12px] leading-5 text-text-secondary">A new website on a free temporary domain, with everything from <strong>{source.name}</strong> pushed into it. It joins this card as another live site; <strong>{live!.name}</strong> stays the main one and is not changed. You approve once, before anything is created.</p>
              : <p className="text-[12px] leading-5 text-text-secondary">A new website on a free temporary domain that becomes the live site of <strong>{source.name}</strong>, with everything from it pushed in. You approve once, before anything is created.</p>} />
        </div> : <p>Connect a Hostinger account under <strong>Provider accounts</strong> first.</p>}
      </>}
      {plan && <>
        <p className="text-text-secondary">{source.name} → <strong className="text-text-primary">{plan.domain}</strong></p>
        <ol className="min-w-0 space-y-1.5 rounded-lg border border-border-default p-3" aria-label="Go-live stages">
          <Step state={site?.ready ? "done" : site && !site.running ? "failed" : "active"} label={`Create ${plan.domain} on Hostinger with Zoer Connect`} detail={site?.ready ? null : site && !site.running ? (site.error ?? site.step) : (site?.step ?? "Starting…")} />
          <Step state={exportRun?.status === "succeeded" ? "done" : exportFailed ? "failed" : "active"} label={`Export ${source.name}`} detail={exportFailed ? (exportRun?.error ?? "The export stopped.") : exportView ? [exportView.label, exportView.detail].filter(Boolean).join(" · ") : null} />
          {!oneClick && <Step state={plan.error ? "failed" : "pending"} label={another ? "Start the push" : "Link the sites and start the push"} detail={plan.error ?? (site?.ready ? "Starting… keep this page open; Zoer asks you to approve the push." : null)} />}
        </ol>
        {oneClick && <PushProgress key={oneClick.push.runId} runs={oneClick} destinationHost={plan.domain} />}
        <div className="flex flex-wrap items-center gap-2">
          {ended && oneClick.push.status === "succeeded" && <a href={`https://${plan.domain}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent underline sm:min-h-0">Open {plan.domain}</a>}
          {site && !site.ready && !site.running && <Btn size="sm" loading={busy} onClick={() => void retrySetup()}>Retry setup</Btn>}
          {(!oneClick || ended) && <Btn size="sm" variant="ghost" loading={busy} onClick={() => void stop()}>{ended ? "Done" : "Stop here"}</Btn>}
        </div>
        {!ended && <p className="text-xs text-text-secondary">{oneClick ? "Runs on the Zoer server by itself; you can close this window and this page." : "Runs on the Zoer server. Keep the WordPress page open in some tab so the push starts when the website is ready; you can close this window."}</p>}
      </>}
      {approving && <p role="status" className="flex items-center gap-2 rounded-md border border-status-warning/40 p-3"><Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />Approve the push to {approving} in Zoer's dialog. The website is created as soon as you approve; declining creates nothing.</p>}
      {error && <p role="alert" className="break-words text-status-error">{error}</p>}
    </div>
  </Modal>;
}
