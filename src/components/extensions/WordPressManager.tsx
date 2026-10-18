import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wordpressKeys, wordpressQueries, activeWordPressDeployment } from "../../lib/queries/wordpress";
import { resourceQueries } from "../../lib/queries/resources";
import { Select as Select } from "@zoer/plugin-ui/controls";
import HostingerBrowserLogin, { unloadedHostingerAccounts } from "./HostingerBrowserLogin";
import HostingerReconnect from "./HostingerReconnect";
import SiteStackPanel from "./SiteStackPanel";
import WordPressRepositoryDevelopment from "./WordPressRepositoryDevelopment";
import { canDevelopInstalledPlugin, type SiteRepositorySource } from "./repositoryPluginSelection";
import { useResourceSelection } from "@zoer/plugin-ui/workspace";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Cloud,
  ExternalLink,
  Globe2,
  HardDriveDownload,
  KeyRound,
  Link2,
  Loader2,
  Package,
  Pencil,
  Plus,
  Play,
  Square,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Trash2,
  Unlink2,
} from "lucide-react";
import {
  api,
  type HostingerConnectionPublic,
  type WordPressDeployment,
  type WordPressExtensionKind,
  type WordPressExtensionOperation,
  type WordPressExtensionPlan,
  type WordPressInstalledExtension,
  type WordPressManagedSite,
  type WordPressPublishPlan,
  type WordPressSiteDetails,
} from "../../lib/api";
import { getApiBase, json } from "../../lib/api/_http";
import { isDemoMode } from "@zoer/plugin-ui/workspace";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { ActionMenu as ActionMenu } from "@zoer/plugin-ui/controls";
import { StatusBadge as StatusBadge, type StatusTone } from "@zoer/plugin-ui/controls";
import { PluginPage } from "@zoer/plugin-ui/workspace";
import { PageTabs as PageTabs, PageTabPanel } from "@zoer/plugin-ui/controls";
import { Modal as Modal } from "@zoer/plugin-ui/controls";
import { openWordPressAdmin, wordpressPreviewUrl } from "../../lib/openWordPressAdmin";
import { EmptyState as EmptyState } from "@zoer/plugin-ui/controls";
import { SearchInput as SearchInput } from "@zoer/plugin-ui/controls";
import { controlClass, selectClass } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";
import WordPressUpdraftImport from "./WordPressUpdraftImport";
import { wordpressExtensionActions, wordpressExtensionActionLabel, wordpressExtensionAutoUpdateLabel } from "./wordpressExtensionActions";
import WordPressConnect from "./WordPressConnect";
import PushToLiveDialog from "./PushToLiveDialog";
import SiteSyncCard from "./SiteSyncCard";
import PluginLocalCopy from "./pluginEngine/PluginLocalCopy";
import PublicationStatus from "./pluginEngine/PublicationStatus";
import { connectionHealth } from "./pluginEngine/publicationCheck";
import HostingerWebsiteSetup from "./HostingerWebsiteSetup";
import WordPressCoreUpdates from "./WordPressCoreUpdates";
import SiteActivity from "./SiteActivity";
import WordPressSecurity from "./WordPressSecurity";
import HostingerSiteTools from "./HostingerSiteTools";
import { isTransferFence, TRANSFER_FENCE_NOTICE } from "./pluginEngine/runState";
import PluginPulls from "./pluginEngine/PluginPulls";
import ActiveTransferBanner from "./pluginEngine/ActiveTransferBanner";
import { activeSiteRuns } from "./pluginEngine/siteActivity";
import { SITE_RUN_ACTIONS } from "./pluginEngine/runState";
import { useRecentRuns } from "../../lib/queries/plugin-engine";
import { detailSectionFor, managerSection, managerSections, MANAGER_TABS, type ManagerSection, type ManagerTab } from "./managerSections";
import { extensionDisplayName, recoveryPointLabel } from "./wordpressNames";
import { mergeDeployments, parseDeploymentRecord, parseRecoveryPointRecord, parseSiteLink, recoveryPointRecord, recoveryPointsFor, withSiteLinks, type DeploymentRecord, type RecoveryPointRecord, type SiteLinkRecord } from "./pluginEngine/records";
import { commitCatalog, engineKeys, retireEngineRecords, useCatalogKind } from "../../lib/queries/plugin-engine";
import WordPressAddSite from "./WordPressAddSite";
import WordPressTrash from "./WordPressTrash";
import { hostConnections, hostEndpoints, runAction } from "../../host/actions";
import { isLocalWordPress, wordpressLifecycleAction } from "./wordpressLifecycle";
import { consolidateWordPressSites, readSeparatedSiteConnections, writeSeparatedSiteConnections } from "./wordpressSiteIdentity";
import { filterWordPressSiteGroups, groupWordPressSites, readSeparatedSitePairs, wordPressSiteCopies, wordPressSiteSource, writeSeparatedSitePairs } from "./wordpressSiteGroups";
import { databaseKeys } from "../../lib/queries/databases";

function siteLocation(site: WordPressManagedSite) {
  return site.provider === "zoer-connect" ? "External · Zoer Connect" : site.provider === "hostinger" ? "Live · Hostinger" : site.provider === "ddev" ? "Local · DDEV" : "Local · Playground";
}
function siteDomain(site: WordPressManagedSite) {
  return site.managedUrl ? new URL(site.managedUrl).hostname : site.domain || "No public URL";
}
function siteLabel(site: WordPressManagedSite) { return `${site.name} — ${siteLocation(site)}`; }
function siteOptions(sites: WordPressManagedSite[], aliases: (id: string) => WordPressManagedSite[] = () => [], copyOf: ReadonlyMap<string, WordPressManagedSite> = new Map()) {
  return Object.fromEntries(sites.map(site => {
    const source = copyOf.get(site.id);
    const status = site.status === "running" || site.status === "connected" ? "" : ` · ${statusLabel(site.status)}`;
    // Local sites' long development hosts repeat their names; live sites show their public domain.
    const where = source ? `Local copy of ${source.name}` : isLocalWordPress(site) ? siteLocation(site) : `${siteLocation(site)} · ${siteDomain(site)}`;
    return [site.id, { icon: providerIcon(site.provider), description: `${where}${status}`, keywords: [siteDomain(site), source?.name ?? "", ...aliases(site.id).map(alias => `${alias.name} ${alias.provider}`)].join(" ") }];
  }));
}

function statusTone(status: string): StatusTone {
  if (["running", "connected", "succeeded", "good", "active", "must-use"].includes(status)) return "success";
  if (["failed", "error", "critical", "invalid", "outcome_unknown"].includes(status)) return "error";
  if (["inactive", "stopped", "exited", "unknown"].includes(status)) return "neutral";
  return "warning";
}
/** Sentence case for raw provider statuses: "verification_required" → "Verification required". */
function statusLabel(status: string) {
  const text = status.replaceAll("_", " ").replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function Status({ status, variant }: { status: string; variant?: "pill" | "dot" }) {
  return <StatusBadge tone={statusTone(status)} variant={variant}>{statusLabel(status)}</StatusBadge>;
}

function humanBytes(bytes: number | undefined) {
  if (!bytes) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function providerIcon(provider: WordPressManagedSite["provider"]) {
  return provider === "hostinger" ? <Cloud className="h-4 w-4" /> : provider === "ddev" ? <Server className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />;
}

export default function WordPressManager({ page = "WordPress" }: { /** Page title; the manager draws its own header so it can contribute actions. */ page?: string }) {
  const dialogs = useDialogs();
  const [selectedId, setSelectedId] = useResourceSelection<string | null>("site", null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"blank" | "backup">("blank");
  const [restoreRunning, setRestoreRunning] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [tab, setTab] = useResourceSelection<ManagerTab>("tab", "overview", MANAGER_TABS);
  const section = managerSection(tab);
  const [busy, setBusy] = useState<string | null>(null);
  const lifecycleLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [siteQuery, setSiteQuery] = useState("");
  const [siteScope, setSiteScope] = useResourceSelection<"all" | "local">("scope", "all", ["all", "local"]);
  const [editSite, setEditSite] = useState<WordPressManagedSite | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [separatedPairs, setSeparatedPairs] = useState(() => readSeparatedSitePairs());
  const [developingPlugin,setDevelopingPlugin]=useResourceSelection<string|null>("plugin",null);
  const [extensionQuery, setExtensionQuery] = useState("");
  const [extensionSlug, setExtensionSlug] = useState("");
  const [directoryResults, setDirectoryResults] = useState<Array<{ slug: string; name: string; description: string; imageUrl: string | null }>>([]);
  const [extensionPlan, setExtensionPlan] = useState<{ input: { siteId: string; kind: WordPressExtensionKind; operation: WordPressExtensionOperation; slugs: string[] }; plan: WordPressExtensionPlan } | null>(null);
  const [pushFrom, setPushFrom] = useState<WordPressManagedSite | null>(null);
  const [pullInto, setPullInto] = useState<{ local: WordPressManagedSite; live: WordPressManagedSite } | null>(null);
  const [publishPlan, setPublishPlan] = useState<WordPressPublishPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [connectionToken, setConnectionToken] = useState("");
  const [publishSource, setPublishSource] = useState("");
  const [publishConnection, setPublishConnection] = useState("");
  const [publishDomain, setPublishDomain] = useState("");
  const [publishMode, setPublishMode] = useState<"new" | "replace">("replace");
  const [workspaceName, setWorkspaceName] = useState("WordPress workspace");
  const [retainPortableBackup, setRetainPortableBackup] = useState(true);

  const client = useQueryClient();
  const session = useOperationSession();
  // A scanner bookmark must not inspect or bootstrap the uploaded WordPress site: opened directly on
  // Security, the page lists the scanner's sites. Once the full list is loaded it stays (the scanner
  // list has local sites only, so swapping lists hid live sites and their local-copy links).
  // On Security, status still comes from the metadata-only list (starting a site there enables its scan).
  const fullSites = useQuery({ ...wordpressQueries.sites(), enabled: section !== "security" });
  const scannerSites = useQuery({ ...wordpressQueries.securitySites(), enabled: section === "security" });
  const sitesQuery = fullSites.data || section !== "security" ? fullSites : scannerSites;
  const inventoryQuery = section === "security" ? wordpressQueries.securitySites() : wordpressQueries.sites();
  const inventory = useMemo(() => {
    if (sitesQuery !== fullSites || section !== "security" || !fullSites.data || !scannerSites.data) return sitesQuery.data;
    const fresh = new Map(scannerSites.data.map(site => [site.id, site.status]));
    return fullSites.data.map(site => fresh.has(site.id) ? { ...site, status: fresh.get(site.id)! } : site);
  }, [sitesQuery.data, fullSites.data, scannerSites.data, section]); // eslint-disable-line react-hooks/exhaustive-deps
  const [separatedConnections, setSeparatedConnections] = useState(readSeparatedSiteConnections);
  // Local copies point at their source through `site-link:` records (copy.local, or migrated legacy
  // copies). Since Zoer P4 the host's site list no longer tracks copies (`sourceSiteId` is always null).
  const siteLinks = useCatalogKind("site-link");
  const sites = useMemo(() => withSiteLinks(inventory ?? [], (siteLinks.data ?? []).map(parseSiteLink).filter((link): link is SiteLinkRecord => !!link)), [inventory, siteLinks.data]);
  const identity = useMemo(() => consolidateWordPressSites(sites, separatedConnections), [sites, separatedConnections]);
  const candidateIdentity = useMemo(() => consolidateWordPressSites(sites), [sites]);
  const connectionsQuery = useQuery({ ...wordpressQueries.connections() });
  const deploymentsQuery = useQuery({ ...wordpressQueries.deployments(), refetchInterval: query => query.state.data?.some(item => activeWordPressDeployment(item.status)) ? 5_000 : false, refetchIntervalInBackground: false });
  // Receipts and recovery points migrated into the catalog (`deployment:`, `recovery-point:`) supplement Zoer's own lists.
  const deploymentRecords = useCatalogKind("deployment");
  const recoveryRecords = useCatalogKind("recovery-point");
  const connectorsQuery = useQuery(wordpressQueries.connectors());
  const selectedSummary = identity.sites.find(site => site.id === identity.canonicalId(selectedId ?? "") && (siteScope === "all" || isLocalWordPress(site))) ?? null;
  const inspectSelected = Boolean(selectedSummary && (!isLocalWordPress(selectedSummary) || selectedSummary.status === "running"));
  // Activity uses saved receipts; opening it does not need to run Site Health or inspect extensions.
  const detailSection = detailSectionFor(tab) ?? "overview";
  const inspectDetails = inspectSelected && detailSectionFor(tab) !== null;
  const detailsQuery = useQuery({ ...wordpressQueries.site(selectedSummary?.id ?? "", detailSection), enabled: inspectDetails });
  const scopedSites = siteScope === "local" ? sites.filter(isLocalWordPress) : sites;
  const pickerSites = siteScope === "local" ? identity.sites.filter(isLocalWordPress) : identity.sites;
  const connections = connectionsQuery.data ?? [];
  const deployments = useMemo(() => mergeDeployments(deploymentsQuery.data ?? [], (deploymentRecords.data ?? []).map(parseDeploymentRecord).filter((item): item is DeploymentRecord => !!item)), [deploymentsQuery.data, deploymentRecords.data]);
  const recoveryPoints = useMemo(() => (recoveryRecords.data ?? []).map(parseRecoveryPointRecord).filter((item): item is RecoveryPointRecord => !!item), [recoveryRecords.data]);
  const runtimeConnectors = connectorsQuery.data ?? [];
  const details = detailsQuery.data ?? null;
  const loading = sitesQuery.isPending;
  const detailLoading = detailsQuery.isPending && inspectDetails;
  const checkedAt = sitesQuery.dataUpdatedAt ? new Date(sitesQuery.dataUpdatedAt).toLocaleTimeString() : null;
  const detailError = inspectDetails ? detailsQuery.error?.message ?? details?.errors?.join(" ") ?? null : null;
  const readError = sitesQuery.error?.message ?? connectionsQuery.error?.message ?? deploymentsQuery.error?.message ?? connectorsQuery.error?.message;
  const load = async (_quiet = false, fresh = false) => {
    await client.cancelQueries({ queryKey: wordpressKeys.all() });
    if (fresh) {
      try { await client.fetchQuery({ ...(section === "security" ? wordpressQueries.securitySites() : wordpressQueries.sites(true)), staleTime: 0 }); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to refresh sites."); }
    }
    await Promise.all([
      client.invalidateQueries({ queryKey: wordpressKeys.all(), predicate: query => !fresh || query.queryKey[2] !== inventoryQuery.queryKey[2] }),
      client.invalidateQueries({ queryKey: resourceQueries.connectors().queryKey }),
    ]);
    return client.getQueryData(inventoryQuery.queryKey) ?? [];
  };
  const loadDetails = async (siteId: string, _quiet = false) => {
    const queryKey = wordpressQueries.site(siteId, detailSection).queryKey;
    await client.cancelQueries({ queryKey });
    await client.invalidateQueries({ queryKey });
  };
  const write = async <T,>(operation: () => Promise<T>): Promise<T> => {
    const filters: { queryKey: readonly unknown[] }[] = [{ queryKey: wordpressKeys.all() }, { queryKey: resourceQueries.computers().queryKey }, { queryKey: resourceQueries.secrets().queryKey }];
    await Promise.all(filters.map(filter => client.cancelQueries(filter)));
    try { session.assertCurrent(); const result = await operation(); session.assertCurrent(); return result; }
    finally {
      if (session.isCurrent()) {
        await Promise.all(filters.map(filter => client.cancelQueries(filter)));
        await Promise.all(filters.map(filter => client.invalidateQueries(filter)));
      }
    }
  };
  const refreshAll = async () => {
    setBusy("refresh"); setError(null);
    try { await load(true, true); } finally { setBusy(null); }
  };
  useEffect(() => {
    if (!sitesQuery.data) return;
    setSelectedId(current => current && scopedSites.some(site => site.id === current) ? current : scopedSites[0]?.id || null);
  }, [sitesQuery.data, siteScope, setSelectedId]);
  useEffect(() => { setPublishConnection(current => current || connectionsQuery.data?.[0]?.id || ""); }, [connectionsQuery.data]);
  // 0.8.0: every site uses the plugin transfer engine; the 0.7.x per-site switch records are tidied away once per page load.
  useEffect(() => { void retireEngineRecords().catch(() => undefined); }, []);
  useEffect(() => {
    setDirectoryResults([]); setExtensionQuery(""); setExtensionSlug(""); setExtensionPlan(null);
  }, [selectedId, tab]);
  const previousDeployments = useRef(deployments);
  useEffect(() => {
    const changed = previousDeployments.current.some(before => activeWordPressDeployment(before.status) && deployments.some(after => after.id === before.id && after.status !== before.status));
    previousDeployments.current = deployments;
    if (changed) {
      void client.invalidateQueries({ queryKey: wordpressQueries.sites().queryKey });
      void client.invalidateQueries({ queryKey: [...wordpressKeys.all(), "site"] });
    }
  }, [deployments, client]);

  // Zoer's cached list can still say "running" for a site that was stopped elsewhere; the inspection
  // knows better. Refresh the list once per site when they disagree.
  const staleStatusChecked = useRef(new Set<string>());
  useEffect(() => {
    const id = selectedSummary?.id;
    if (!id || !detailError || !/start the wordpress site/i.test(detailError) || staleStatusChecked.current.has(id)) return;
    staleStatusChecked.current.add(id);
    void load(true, true);
  }, [detailError, selectedSummary?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedDetails = inspectSelected && details?.site.id === selectedSummary?.id ? details : null;
  const selected = selectedSummary ?? selectedDetails?.site ?? null;
  const connectSite = selected ? identity.connector(selected) : null;
  const connectionMembers = selected ? candidateIdentity.aliases(selected.id) : [];
  // Transfers running on this website (any of its connections): the banner above the sections,
  // and the site's own changes wait while one writes to it.
  const transferSiteIds = useMemo(() => [...new Set([connectSite?.provider === "zoer-connect" ? connectSite.id : null, selected?.id ?? null, ...connectionMembers.map(member => member.id)].filter((id): id is string => !!id))], [connectSite?.id, connectSite?.provider, selected?.id, connectionMembers.map(member => member.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentRuns = useRecentRuns(SITE_RUN_ACTIONS);
  const activeTransfers = useMemo(() => activeSiteRuns(recentRuns.data ?? [], transferSiteIds), [recentRuns.data, transferSiteIds]);
  const transferWriting = activeTransfers.some(item => item.writes);
  // Section changes start at the top (the page or the panel, whichever scrolls at this width).
  const pageScroll = useRef<HTMLDivElement>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { for (const element of [pageScroll.current, panelScroll.current]) if (element) element.scrollTop = 0; }, [section, selected?.id]);
  // Deployment receipts of this website only (its own and its matched connections' IDs and addresses).
  const siteDeployments = useMemo(() => {
    if (!selected) return [];
    const members = [selected, ...connectionMembers];
    const ids = new Set(members.map(site => site.id));
    const hosts = new Set(members.flatMap(site => [site.domain, site.url, site.managedUrl].flatMap(value => { if (!value) return []; try { return [new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase()]; } catch { return []; } })));
    if (selected.provider === "ddev") hosts.add(`${selected.id.replace(/^ddev-/, "")}.ddev.site`);
    return deployments.filter(item => (item.sourceSiteId && ids.has(item.sourceSiteId)) || (item.targetSiteId && ids.has(item.targetSiteId)) || (item.domain && hosts.has(item.domain.toLowerCase())));
  }, [deployments, selected, connectionMembers]);
  const siteEndpoints = useQuery({ queryKey: ["wordpress-manager", "publish-destinations"], queryFn: () => hostEndpoints.list("site"), staleTime: 30_000 });
  // Hosting accounts this website depends on. A saved "connected" status is only as current as its
  // last test, so test each once per page load when its site is opened; failures show a banner.
  const hostingConnectionIds = [...new Set([selected, ...connectionMembers].filter((site): site is WordPressManagedSite => site?.provider === "hostinger" && !!site.connectionId).map(site => site.connectionId!))];
  const hostingConnections = connections.filter(connection => hostingConnectionIds.includes(connection.id));
  // Hostinger sign-ins Zoer holds for this plugin whose websites are not loaded here yet.
  const hostAccounts = useQuery({ queryKey: ["wordpress-manager", "host-hostinger-accounts"], queryFn: async () => (await hostConnections.list()).connections.find(entry => entry.alias === "hostinger")?.accounts ?? [], staleTime: 30_000 });
  const pendingAccounts = connectionsQuery.isSuccess ? unloadedHostingerAccounts(hostAccounts.data ?? [], connections) : [];
  const testedConnections = useRef(new Set<string>());
  useEffect(() => {
    for (const id of hostingConnectionIds) {
      if (testedConnections.current.has(id)) continue;
      testedConnections.current.add(id);
      void api.testWordPressManagerConnection(id).catch(() => undefined).finally(() => void client.invalidateQueries({ queryKey: wordpressQueries.connections().queryKey }));
    }
  }, [hostingConnectionIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const connectionsCombined = Boolean(selected && identity.aliases(selected.id).length > 1);
  const toggleConnections = () => {
    setSeparatedConnections(current => {
      const next = new Set(current);
      for (const member of connectionMembers) { if (connectionsCombined) next.add(member.id); else next.delete(member.id); }
      writeSeparatedSiteConnections(next);
      return next;
    });
  };
  const ddevConnector = runtimeConnectors.find((connector) => connector.id === "ddev");
  const siteGroups = useMemo(() => groupWordPressSites(scopedSites, separatedPairs, separatedConnections), [scopedSites, separatedPairs, separatedConnections]);
  const visibleGroups = useMemo(() => filterWordPressSiteGroups(siteGroups, siteQuery, identity.aliases), [siteGroups, siteQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  // The phone picker lists sites in the desktop list's order: each live site followed by its local copies.
  const pickerOrder = useMemo(() => siteGroups.flatMap(group => group.kind === "pair" ? [group.source, ...group.copies] : [group.site]), [siteGroups]);
  const pickerCopyOf = useMemo(() => new Map(siteGroups.flatMap(group => group.kind === "pair" ? group.copies.map(copy => [copy.id, group.source] as const) : [])), [siteGroups]);
  const selectSite = (site: WordPressManagedSite) => {
    if (site.id !== selectedId) setExtensionPlan(null);
    setSelectedId(site.id);
    setDevelopingPlugin(null);
    setTab("overview");
  };
  const setPairSeparated = (sourceId: string, separated: boolean) => {
    setSeparatedPairs((current) => {
      const next = new Set(current);
      for (const alias of identity.aliases(sourceId)) { if (separated) next.add(alias.id); else next.delete(alias.id); }
      writeSeparatedSitePairs(next);
      return next;
    });
  };
  const selectedSource = selected ? wordPressSiteSource(scopedSites, selected, separatedConnections) : null;
  const selectedCopies = selected ? wordPressSiteCopies(scopedSites, selected, separatedConnections) : [];
  // A local site's Publish form always starts from that site.
  const fixedSourceId = selected?.capabilities.deploySource ? selected.id : "";
  useEffect(() => { if (tab === "deployments" && fixedSourceId) setPublishSource(fixedSourceId); }, [tab, fixedSourceId]);

  const openSite = async (site: WordPressManagedSite, _admin: boolean) => {
    setError(null);
    setBusy(`admin:${site.id}`);
    try {
      await openWordPressAdmin(site);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open WordPress.");
    } finally {
      setBusy(null);
    }
  };

  const changeLifecycle = async (site: WordPressManagedSite) => {
    const action = wordpressLifecycleAction(site);
    if (!action || busy || lifecycleLock.current) return;
    lifecycleLock.current = true;
    try {
      if (action === "stop" && !await dialogs.confirm({ title: `Stop ${site.name}?`, description: "This takes only the local site offline. Its files and database are preserved. You can start it again here; the production website is not changed.", confirmLabel: "Stop site", tone: "danger" })) return;
      session.assertCurrent();
      if (action === "stop" && deployments.some(item => activeWordPressDeployment(item.status) && (item.sourceSiteId === site.id || item.targetSiteId === site.id))) {
        setError("Wait for this site's active transfer or deployment before stopping it."); return;
      }
      setBusy(`lifecycle:${site.id}`); setError(null); setNotice(null);
      await write(() => action === "start" ? api.startComputer(site.id) : api.stopComputer(site.id));
      session.assertCurrent();
      await load(true, true);
      await client.invalidateQueries({ queryKey: databaseKeys.all() });
      const current = client.getQueryData(inventoryQuery.queryKey)?.find(item => item.id === site.id);
      setNotice(`${site.name}: ${current?.status ?? `${action} request completed`}. Files and database preserved.`);
    } catch (caught) {
      if (session.isCurrent()) { setError(caught instanceof Error ? caught.message : "Unable to change site status. Refresh before retrying."); await load(true, true); }
    } finally { lifecycleLock.current = false; if (session.isCurrent()) setBusy(null); }
  };

  const removeSite = async (site: WordPressManagedSite) => {
    if (site.provider === "hostinger") {
      setError("Production sites must be removed through their hosting provider.");
      return;
    }
    const description = site.provider === "ddev"
      ? "This stops the DDEV site and moves it to the Zoer trash. Its project and database files remain on the DDEV server; restore it from Trash in this workspace before its scheduled purge."
      : "This stops the Playground site and moves it to Zoer trash. Its workspace remains recoverable until the trash retention period ends.";
    if (!await dialogs.confirm({ title: `Delete ${site.name}?`, description, confirmLabel: "Move to trash", tone: "danger" })) return;
    setBusy(`delete:${site.id}`);
    setError(null);
    setNotice(null);
    try {
      // DDEV: S9 managed resources through the site.archive action (runtime:manage). Playground is a
      // Docker profile without a runtime connector and keeps the workspace route.
      const result = site.provider === "ddev"
        ? await write(() => runAction<{ summary: string }>("site.archive", { siteId: site.id }))
        : (await write(() => api.destroyComputer(site.id)), null);
      setSelectedId(null);
      setNotice(`${site.name} was moved to trash.${result?.summary ? ` ${result.summary}` : ""}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete this WordPress site.");
    } finally {
      setBusy(null);
    }
  };

  const createWorkspace = async (kind: "playground" | "ddev") => {
    const name = workspaceName.trim();
    if (!name) return;
    const action = `create:${kind}`;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      if (kind === "ddev") {
        // S9: a DDEV site owned by WordPress Manager (site.create → runtime.create.v1, runtime:manage).
        if (name.length > 80) throw new Error("Use a DDEV site name of up to 80 characters.");
        const created = await write(() => runAction<{ siteId?: string; summary: string }>("site.create", { name }));
        setWorkspaceName("WordPress workspace");
        setNotice(created.summary || `${name} is being prepared. It will appear in the site list when ready.`);
        if (created.siteId) setSelectedId(created.siteId);
        setCreateOpen(false);
        return;
      }
      const computer = await write(() => api.createComputer({ name, runtime: "docker", runtimeProfile: "wordpress-playground", aiMode: "api" }));
      setWorkspaceName("WordPress workspace");
      setNotice(`${computer.name} is being prepared. It will appear in the site list when ready.`);
      setSelectedId(computer.id);
      setCreateOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the WordPress workspace.");
    } finally {
      setBusy(null);
    }
  };

  const openBackupImport = () => {
    setCreateMode("backup");
    setCreateOpen(true);
  };

  const planExtension = async (kind: WordPressExtensionKind, operation: WordPressExtensionOperation, slugs: string[]) => {
    if (!selected || selectedDetails?.site.id !== selected.id) return;
    setBusy(`plan:${kind}:${operation}`);
    setError(null);
    setNotice(null);
    try {
      const input = { siteId: selected.id, kind, operation, slugs };
      const response = await api.planWordPressExtensionChange(input);
      setExtensionPlan({ input, plan: response.plan });
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to plan the extension change.");
    } finally {
      setBusy(null);
    }
  };

  const searchDirectory = async (kind: WordPressExtensionKind) => {
    if (!selected || selectedDetails?.site.id !== selected.id || extensionSlug.trim().length < 3) return;
    setBusy(`search:${kind}`);
    setError(null);
    try {
      const response = await api.searchWordPressExtensions(selected.id, kind, extensionSlug.trim());
      setDirectoryResults(response.results);
      if (!response.results.length) setNotice(`No matching ${kind}s were found.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to search ${kind}s.`);
    } finally {
      setBusy(null);
    }
  };

  const applyExtension = async () => {
    if (!extensionPlan) return;
    setBusy("apply-extension");
    setError(null);
    try {
      const response = await write(() => api.applyWordPressExtensionChange({ ...extensionPlan.input, fingerprintSha256: extensionPlan.plan.fingerprintSha256, ...(extensionPlan.plan.confirmationPhrase ? { confirmation } : {}) }));
      setNotice(response.result.state === "queued" ? "Hostinger accepted the operation. Refresh after its asynchronous job completes." : "WordPress change completed and passed the safety checks.");
      setExtensionPlan(null);
      setConfirmation("");
      setExtensionSlug("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to apply the extension change.");
    } finally {
      setBusy(null);
    }
  };

  const addConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("add-connection");
    setError(null);
    try {
      await write(() => api.createWordPressManagerConnection({ name: connectionName, token: connectionToken }));
      setConnectionName("");
      setConnectionToken("");
      setNotice("Hostinger connection verified. The token is encrypted in Zoer Secrets and was not retained in the form.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to connect Hostinger.");
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async (connection: HostingerConnectionPublic) => {
    setBusy(`test:${connection.id}`);
    setError(null);
    try {
      const result = await write(() => api.testWordPressManagerConnection(connection.id));
      setNotice(`Connected: ${result.websites} website(s), ${result.installations} WordPress installation(s).`);
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.message} Use Sign in again on the account to reconnect it.` : "Connection test failed.");
    } finally {
      void connectionsQuery.refetch();
      setBusy(null);
    }
  };

  const removeConnection = async (connection: HostingerConnectionPublic) => {
    if (!await dialogs.confirm({ title: `Remove ${connection.name}?`, description: "Removes the connection, its token and its recorded Hostinger recovery points from Zoer, and its sites leave the list. Hostinger websites are not changed. If the login expired, use Sign in again instead: it keeps all of this.", confirmLabel: "Remove connection", tone: "danger" })) return;
    setBusy(`remove:${connection.id}`);
    try {
      await write(() => api.deleteWordPressManagerConnection(connection.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove the connection.");
    } finally {
      setBusy(null);
    }
  };

  const recordRecovery = async () => {
    if (!selected?.connectionId || !selected.domain) return;
    const label = await dialogs.prompt({ title: "Confirm Hostinger recovery point", description: "First create and verify a completed backup in hPanel. Zoer records your confirmation; it does not create the remote backup.", label: "Backup label", defaultValue: `hPanel backup before changes ${new Date().toLocaleDateString()}`, submitLabel: "Continue" });
    if (!label) return;
    if (!await dialogs.confirm({ title: "Was the hPanel backup verified?", description: "Only confirm after Hostinger shows the backup completed successfully and is restorable.", confirmLabel: "Yes, record recovery point" })) return;
    setBusy("recovery");
    try {
      const { connectionId, domain } = selected;
      const { recoveryPoint } = await write(() => api.recordWordPressRecoveryPoint({ connectionId: connectionId!, domain: domain!, label, confirmed: true }));
      // Zoer keeps the point for its 24-hour checks but does not list it; keep a copy so this page shows it.
      if (recoveryPoint?.id) await commitCatalog({ records: [recoveryPointRecord(recoveryPoint)] }, "recovery-point").then(() => client.invalidateQueries({ queryKey: engineKeys.catalog("recovery-point") })).catch(() => undefined);
      setNotice("Recovery point recorded for 24-hour production safety checks.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the recovery point.");
    } finally {
      setBusy(null);
    }
  };

  const createPortableBackup = async () => {
    if (!selected || selected.provider !== "ddev") return;
    setBusy("portable-backup");
    setError(null);
    setNotice(null);
    try {
      const { backup } = await write(() => api.createWordPressPortableBackup(selected.id, retainPortableBackup));
      const link = document.createElement("a");
      let objectUrl = "";
      if (isDemoMode()) {
        objectUrl = URL.createObjectURL(await api.downloadWordPressPortableBackup(selected.id, backup.id, backup.sha256));
        link.href = objectUrl;
      } else if (backup.file) {
        link.href = `${getApiBase()}/files/${encodeURIComponent(backup.file.id)}/download`;
      } else {
        link.href = `${getApiBase()}/wordpress-manager/sites/${encodeURIComponent(selected.id)}/portable-backups/${encodeURIComponent(backup.id)}/download?sha256=${encodeURIComponent(backup.sha256)}`;
      }
      link.download = backup.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const retentionMessage = backup.retention === "retained"
        ? " A verified copy is also retained in Files."
        : backup.retention === "too_large"
          ? " It was too large for the Files quota, so only the direct download was prepared."
          : "";
      setNotice(`Portable backup created and the download started.${retentionMessage}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the portable website backup.");
    } finally {
      setBusy(null);
    }
  };

  const planPublish = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("plan-publish");
    setError(null);
    try {
      const response = await api.planWordPressPublish({ sourceSiteId: publishSource, connectionId: publishConnection, domain: publishDomain, mode: publishMode });
      setPublishPlan(response.plan);
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to plan the deployment.");
    } finally {
      setBusy(null);
    }
  };

  const executePublish = async (acknowledgeCoreUpdate = false) => {
    if (!publishPlan) return;
    setBusy("execute-publish");
    setError(null);
    try {
      const response = await write(() => api.executeWordPressPublish({ sourceSiteId: publishPlan.sourceSiteId, connectionId: publishPlan.connectionId, domain: publishPlan.domain, mode: publishPlan.mode, fingerprintSha256: publishPlan.fingerprintSha256, confirmation, acknowledgeCoreUpdate }));
      setNotice(`Deployment ${response.deployment.id.slice(0, 8)} queued. Progress will refresh here.`);
      setPublishPlan(null);
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start the deployment.");
    } finally {
      setBusy(null);
    }
  };

  const confirmDeployment = async (deployment: WordPressDeployment) => {
    if (!await dialogs.confirm({ title: `Verify ${deployment.domain || "Hostinger replacement"}?`, description: "Confirm only after hPanel shows the import completed and you inspected the public page, WordPress Admin, permalinks, and assets.", confirmLabel: "Mark verified" })) return;
    setBusy(`verify:${deployment.id}`);
    setError(null);
    try {
      await write(() => api.confirmWordPressDeployment(deployment.id));
      setNotice("Hostinger replacement marked as manually verified.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify the deployment.");
    } finally {
      setBusy(null);
    }
  };

  const saveSiteName = async () => {
    if (!editSite || !isLocalWordPress(editSite)) return;
    setBusy(`rename:${editSite.id}`); setEditError(null);
    try {
      await write(() => api.renameLocalWordPressSite(editSite.id, editName.trim()));
      const updated = (await api.listWordPressManagedSites(true)).sites.find(site => site.id === editSite.id);
      if (updated?.name !== editName.trim()) throw new Error("The saved name could not be verified. Refresh sites and try again.");
      setNotice("Site name updated in Zoer. The development URL and WordPress title stayed the same.");
      setEditSite(null);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "Unable to rename the site.");
    } finally { setBusy(null); }
  };

  const headerActions = [
    { label: "Connect existing site", icon: <Link2 className="h-4 w-4" />, onClick: () => setAddSiteOpen(true) },
    { label: "Provider accounts", icon: <Cloud className="h-4 w-4" />, onClick: () => setProvidersOpen(true) },
    { label: "Trash", icon: <Trash2 className="h-4 w-4" />, onClick: () => setTrashOpen(true) },
    { label: "Refresh", iconOnly: true, tooltip: checkedAt ? `Last checked ${checkedAt}` : undefined, icon: <RefreshCw className="h-4 w-4" />, loading: busy === "refresh", disabled: busy !== null, onClick: () => void refreshAll() },
  ];
  const newSiteButton = <Btn variant="primary" aria-label="New local site" icon={<Plus className="h-4 w-4" />} onClick={() => { setCreateMode("blank"); setCreateOpen(true); }}><span className="sm:hidden">New site</span><span className="hidden sm:inline">New local site</span></Btn>;
  if (loading) return <PluginPage title={page} fill actions={headerActions} primary={newSiteButton}><div className="flex min-h-72 items-center justify-center text-[13px] text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sites…</div></PluginPage>;

  const lifecycle = selected ? wordpressLifecycleAction(selected) : null;
  const siteSections = managerSections(selected?.provider);
  const updating = Boolean(selected && busy === `lifecycle:${selected.id}`);
  const canAdmin = Boolean(selected?.capabilities.admin && selected.status === "running");
  const previewUrl = selected?.capabilities.preview ? wordpressPreviewUrl(selected) : null;
  const openPublish = (site: WordPressManagedSite) => {
    setPublishPlan(null); setConfirmation("");
    if (site.capabilities.deploySource) { setPublishSource(site.id); setPublishDomain(""); }
    else { setPublishDomain(site.domain || ""); setPublishConnection(site.connectionId || ""); setPublishSource(""); }
    setPublishMode("replace"); setTab("deployments");
  };
  // One main button per site; everything else is in the site menu, on phones as well as desktop.
  // Pushing and publishing live on Overview and Publish; the menu keeps site-level actions.
  const siteMenu = selected ? [
    ...(previewUrl ? [{ label: "Open site in a new tab", icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(previewUrl, "_blank", "noopener,noreferrer") }] : []),
    ...(isLocalWordPress(selected) && !lifecycle ? [{ label: "Refresh site status", icon: <RefreshCw className="h-4 w-4" />, disabled: busy !== null, onClick: () => void refreshAll() }] : []),
    { label: "Site name & URL", icon: <Pencil className="h-4 w-4" />, onClick: () => { setEditSite(selected); setEditName(selected.name); setEditError(null); } },
    ...(lifecycle === "stop" ? [{ label: "Stop site", icon: <Square className="h-4 w-4" />, disabled: busy !== null || transferWriting, onClick: () => void changeLifecycle(selected) }] : []),
    ...(isLocalWordPress(selected) ? [{ label: "Move to trash", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, loading: busy === `delete:${selected.id}`, disabled: busy !== null || transferWriting, onClick: () => void removeSite(selected) }] : []),
  ] : [];
  // A connected external site opens the same dialog to run transfers; only an unconnected one needs connecting.
  const connectLabel = selected?.status === "connected" ? "Transfers" : "Connect Zoer";
  // While a start or stop runs, the main slot says which (the stop itself is in the site menu).
  const mainAction = !selected ? null : updating
    ? <Btn variant="primary" disabled loading>{lifecycle === "stop" ? "Stopping site" : "Starting site"}</Btn>
    : lifecycle === "start"
    ? <Btn variant="primary" disabled={busy !== null} icon={<Play className="h-4 w-4" />} onClick={() => void changeLifecycle(selected)}>Start site</Btn>
    // No dead primary: a site that is starting (or an external site, which has no admin sign-in here) shows none.
    : canAdmin ? <Btn variant="primary" disabled={busy !== null} loading={busy === `admin:${selected.id}`} icon={<KeyRound className="h-4 w-4" />} onClick={() => void openSite(selected, true)}>WordPress admin</Btn>
    : selected.provider === "zoer-connect" ? <WordPressConnect key={selected.id} siteId={selected.id} siteName={selected.name} label={connectLabel} primary />
    : null;
  // A website reachable through Zoer Connect always offers its Transfers, also when WordPress admin is the main button.
  const transfersAction = selected && canAdmin && connectSite?.provider === "zoer-connect" && connectSite.status === "connected" ? <WordPressConnect key={`transfers:${connectSite.id}`} siteId={connectSite.id} siteName={selected.name} label="Transfers" headerButton /> : null;
  const scopeSelect = (className: string, short = false) => <label className={className}><span className="sr-only">Show sites</span><Select aria-label="Show WordPress sites" presentation="dropdown" searchable={false} value={siteScope} onChange={event => setSiteScope(event.target.value as "all" | "local")} className={selectClass("compact", "w-full")}><option value="all">{short ? "All" : "All sites"}</option><option value="local">{short ? "Local" : "Local only"}</option></Select></label>;

  return (
    <PluginPage title={page} badge={pickerSites.length || undefined} fill actions={headerActions} primary={newSiteButton}>
    <section className="flex min-h-0 flex-1 flex-col" aria-label="WordPress Sites manager">
      <WordPressAddSite open={addSiteOpen} onOpenChange={setAddSiteOpen} existingUrls={sites.flatMap(site => [site.url, site.managedUrl, site.provider === "hostinger" && site.domain ? `https://${site.domain}` : null].filter((value): value is string => Boolean(value)))} onAdded={async id => { await load(true, true); setSelectedId(id); setTab("overview"); setNotice("Website connected."); }} />
      {trashOpen && <WordPressTrash onClose={() => setTrashOpen(false)} onChanged={async (restoredId) => { await load(true, true); if (restoredId) { setSelectedId(restoredId); setTab("overview"); } }} />}

      {(error || readError || notice) && <div className="space-y-2 px-3 pt-3 sm:px-4">
        {(error || readError) && <div role="alert" className="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-[13px] text-status-error">{error || readError}</div>}
        {notice && <div role="status" className="rounded-md border border-status-success/25 bg-status-success/10 px-3 py-2 text-[13px] text-status-success">{notice}</div>}
      </div>}

      {editSite && <Modal mobileSheet title="Edit WordPress site" onClose={() => { if (busy === null) setEditSite(null); }} footer={<div className="flex justify-end gap-2"><Btn disabled={busy !== null} onClick={() => setEditSite(null)}>Cancel</Btn>{isLocalWordPress(editSite) && <Btn variant="primary" disabled={!editName.trim() || editName.trim().length > 100 || busy !== null} loading={busy === `rename:${editSite.id}`} onClick={() => void saveSiteName()}>Save name</Btn>}</div>}>
        <div className="space-y-4 text-sm">
          {editError && <div role="alert" className="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-status-error">{editError}</div>}
          {isLocalWordPress(editSite) ? <label className="block"><span className="mb-1.5 block text-text-primary">Name in Zoer</span><input value={editName} maxLength={100} onChange={event => setEditName(event.target.value)} className={controlClass()} /></label> : <p className="text-text-secondary">{editSite.provider === "hostinger" ? "This name comes from the Hostinger WordPress installation. Change the site title in WordPress admin under Settings → General, then refresh sites." : "This name was saved when the site was connected. To change it, reconnect the site with the preferred name."}</p>}
          <div><div className="mb-1.5 text-text-primary">Site URL</div><div className="break-all rounded-md border border-border-default bg-surface-secondary px-3 py-2 text-text-secondary">{editSite.managedUrl || editSite.url || editSite.domain || "No public URL"}</div><p className="mt-2 text-xs leading-5 text-text-secondary">{isLocalWordPress(editSite) ? "Zoer keeps this development address stable so existing links and logins continue to work. The WordPress site title can be changed separately in WordPress admin under Settings → General." : editSite.provider === "hostinger" ? "Change the production domain in Hostinger. Zoer will discover the updated address after you refresh sites." : "Reconnect this site with its new address through Add site."}</p></div>
        </div>
      </Modal>}

      {createOpen && <Modal mobileSheet title="New WordPress site" onClose={() => { if (busy === null && !restoreRunning) setCreateOpen(false); }} footer={createMode === "blank" ? <div className="flex flex-wrap justify-end gap-2">
        <Btn disabled={busy !== null} onClick={() => setCreateOpen(false)}>Cancel</Btn>
        <Btn variant="primary" icon={<Plus className="h-3.5 w-3.5" />} loading={busy === "create:playground"} disabled={!workspaceName.trim() || busy !== null} onClick={() => void createWorkspace("playground")}>Create Playground</Btn>
        <Btn variant="secondary" icon={<Server className="h-3.5 w-3.5" />} loading={busy === "create:ddev"} disabled={!workspaceName.trim() || busy !== null || !ddevConnector?.active} onClick={() => void createWorkspace("ddev")}>Create DDEV site</Btn>
      </div> : undefined}>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="How to start the WordPress site">
        <button type="button" aria-pressed={createMode === "blank"} disabled={restoreRunning || busy !== null} onClick={() => setCreateMode("blank")} className={`min-h-16 rounded-lg border p-3 text-left text-sm ${createMode === "blank" ? "border-accent bg-accent-subtle text-text-primary" : "border-border-default text-text-secondary hover:bg-surface-hover"}`}><span className="block font-medium">Start a blank site</span><span className="mt-1 block text-xs">Choose Playground or DDEV.</span></button>
        <button type="button" aria-pressed={createMode === "backup"} disabled={restoreRunning || busy !== null} onClick={() => setCreateMode("backup")} className={`min-h-16 rounded-lg border p-3 text-left text-sm ${createMode === "backup" ? "border-accent bg-accent-subtle text-text-primary" : "border-border-default text-text-secondary hover:bg-surface-hover"}`}><span className="block font-medium">Restore from backup</span><span className="mt-1 block text-xs">Upload an UpdraftPlus or Hostinger backup and start a local site.</span></button>
      </div>
      {createMode === "blank" ? <section aria-labelledby="wordpress-create-workspace" className="rounded-lg border border-border-default bg-surface-secondary/60 p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] lg:items-end">
          <div>
            <h3 id="wordpress-create-workspace" className="sr-only">Choose a runtime</h3>
            <p className="mt-1 text-[12px] leading-5 text-text-secondary">Playground for experiments. DDEV for full development. Both persist until moved to trash.</p>
          </div>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-medium text-text-primary">Name</span>
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className={controlClass()} placeholder="WordPress workspace" />
          </label>
        </div>
        {!ddevConnector?.active && (
          <p className="mt-2 break-words text-[13px] leading-4 text-status-warning">{ddevConnector?.unavailableReason || "The DDEV connector is not available. Configure it in Extensions."}</p>
        )}
      </section> : <WordPressUpdraftImport ddevAvailable={!!ddevConnector?.active} ddevUnavailableReason={ddevConnector?.unavailableReason} onRunningChange={setRestoreRunning} />}

      </Modal>}

      {/* Fills the remaining height: the site list and the site panel scroll independently (SidebarLayout shape). */}
      <div className="flex min-h-0 flex-1">
        <aside aria-label="WordPress sites" className="hidden w-[280px] shrink-0 flex-col border-r border-border-default p-3 lg:flex">
          <div className="flex gap-2"><SearchInput className="min-w-0 flex-1" value={siteQuery} onChange={setSiteQuery} placeholder="Search sites" />{scopeSelect("w-28 shrink-0")}</div>
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {visibleGroups.map((group) => group.kind === "pair"
              ? <SitePairCard key={`pair:${group.id}`} source={group.source} copies={group.copies} selectedId={selected?.id ?? null} onSelect={selectSite} onSeparate={() => setPairSeparated(group.id, true)} />
              : <SiteCard key={group.site.id} site={group.site} selected={selected?.id === group.site.id} onSelect={selectSite} mergeInto={(() => {
                  // A separated copy, or a live site with separated copies, offers to merge again.
                  const source = wordPressSiteSource(sites, group.site, separatedConnections);
                  if (source) return identity.aliases(source.id).some(alias => separatedPairs.has(alias.id)) ? source : null;
                  return identity.aliases(group.site.id).some(alias => separatedPairs.has(alias.id)) && wordPressSiteCopies(sites, group.site, separatedConnections).length ? group.site : null;
                })()} onMerge={(source) => setPairSeparated(source.id, false)} />)}
            {!visibleGroups.length && <EmptyState icon={<Globe2 />} title={siteQuery ? "No matches" : siteScope === "local" ? "No local sites" : "No sites yet"} description={siteQuery ? undefined : "Create a local site or connect one."} />}
          </div>
        </aside>

        {/* Phones and tablets scroll this whole column (the header scrolls away, the section picker
            stays); desktops keep the header fixed and scroll only the section. */}
        <div ref={pageScroll} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
          {/* Phones: the site list is a picker, grouped like the desktop list, with the scope filter beside it. */}
          <div className="flex items-center gap-2 px-3 pt-3 lg:hidden">
            <label className="min-w-0 flex-1"><span className="sr-only">Site</span><Select searchable aria-label="Select WordPress site" optionDetails={siteOptions(pickerOrder, identity.aliases, pickerCopyOf)} value={selectedSummary?.id || ""} onChange={e => { setExtensionPlan(null); setDevelopingPlugin(null); setSelectedId(e.target.value); setTab("overview"); }} className={selectClass("compact")}><option value="" disabled>Select a site</option>{pickerOrder.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</Select></label>
            {scopeSelect("w-[5.5rem] shrink-0", true)}
          </div>
          <div className="shrink-0 px-3 py-3 sm:px-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-text-heading">{selected?.name || "No site selected"}</h2>
                {selected ? <>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-secondary">
                    <span className="inline-flex items-center gap-1.5">{providerIcon(selected.provider)}{connectionsCombined ? "Live · Hostinger + Zoer Connect" : siteLocation(selected)}</span>
                    <span role="status" className="inline-flex items-center gap-2">
                      <StatusBadge tone={updating ? "info" : statusTone(selected.status)} icon={updating ? <Loader2 className="animate-spin" /> : undefined}>{updating ? "Updating" : statusLabel(selected.status)}</StatusBadge>
                      {lifecycle === "start" && !updating && <span className="text-[12px] text-text-muted">Start to inspect.</span>}
                    </span>
                    <a className="inline-flex min-h-8 min-w-0 max-w-full items-center truncate text-[12px] underline underline-offset-2 hover:text-text-primary sm:min-h-0" href={wordpressPreviewUrl(selected) || undefined} target="_blank" rel="noreferrer">{siteDomain(selected)}</a>
                  </p>
                  {(selectedSource || selectedCopies.length > 0) && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-text-secondary">
                    <span>{selectedSource ? "Local copy of" : selectedCopies.length === 1 ? "Local copy" : "Local copies"}</span>
                    {(selectedSource ? [selectedSource] : selectedCopies).map((counterpart) => <button key={counterpart.id} type="button" onClick={() => selectSite(counterpart)} className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-border-default px-2 py-0.5 font-medium text-text-primary hover:border-border-strong hover:bg-surface-hover sm:min-h-0"><ArrowLeftRight className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{counterpart.name}</span></button>)}
                  </div>}
                </> : <p className="mt-1 text-[13px] text-text-secondary">Select a site, or create one.</p>}
              </div>
              {selected && <div className="flex shrink-0 items-center gap-1.5">
                <span className="hidden sm:contents">{transfersAction}{mainAction}</span>
                <ActionMenu label="Site actions" items={siteMenu} />
              </div>}
            </div>
            {/* Phones put the main button on its own row so the title keeps its width. */}
            {selected && (mainAction || transfersAction) && <div className="mt-3 flex flex-wrap gap-2 sm:hidden">{mainAction}{transfersAction}</div>}
            {activeTransfers.length > 0 && <div className="mt-3"><ActiveTransferBanner active={activeTransfers} onOpen={section === "history" ? undefined : () => setTab("history")} /></div>}
          </div>
          {/* Narrow panels choose the section from a list; wide ones show the tab strip. */}
          <div className="sticky top-0 z-10 shrink-0 border-b border-border-default bg-surface-base px-3 py-2 @2xl:hidden">
            <label className="flex items-center gap-2 text-[13px] text-text-secondary"><span className="shrink-0">Section</span><Select aria-label="Site section" presentation="dropdown" searchable={false} value={section} onChange={event => setTab(event.target.value as ManagerSection)} className={selectClass("compact", "w-full")}>{siteSections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>
          </div>
          <div className="hidden shrink-0 @2xl:block"><PageTabs id="wordpress-sections" label="WordPress manager sections" tabs={siteSections} value={section} onChange={setTab} /></div>
          <div ref={panelScroll} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <PageTabPanel id="wordpress-sections" value={section} className="p-3 sm:p-4">
            {pendingAccounts.map(account => <div key={account.id} role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-default bg-surface-secondary px-3 py-2 text-[13px]"><span className="min-w-0 break-words">Hostinger account “{account.label}” is signed in, but its websites aren't loaded here yet.</span><Btn size="sm" variant="primary" loading={busy === `adopt:${account.id}`} disabled={busy !== null} onClick={() => void (async () => { setBusy(`adopt:${account.id}`); setError(null); try { await api.adoptHostingerOAuthConnection(account.id); setNotice("Hostinger websites loaded."); await load(true, true); void connectionsQuery.refetch(); void hostAccounts.refetch(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load this Hostinger account."); } finally { setBusy(null); } })()}>Load websites</Btn></div>)}
            {hostingConnections.filter(connection => !connectionHealth(connection).ok).map(connection => <div key={connection.id} role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning"><span className="min-w-0 break-words">Hostinger account “{connection.name}” needs reconnecting. Zoer cannot clear its cache or manage this site until then.{connection.lastError ? ` Last error: ${connection.lastError}` : ""}</span><HostingerReconnect connection={connection} onDone={message => { setNotice(message); void connectionsQuery.refetch(); }} /></div>)}
            {detailError && (isTransferFence(detailError)
              ? <div role="status" className="mb-3 text-sm text-status-warning">{TRANSFER_FENCE_NOTICE} <Btn size="sm" onClick={() => selected && void loadDetails(selected.id)}>Retry section</Btn></div>
              : <div role="alert" className="mb-3 text-sm text-status-error">{detailError} <Btn size="sm" onClick={() => selected && void loadDetails(selected.id)}>Retry section</Btn></div>)}
            {section === "development" ? <div className="min-w-0 space-y-6"><WordPressRepositoryDevelopment />{selected && <SiteStackPanel site={selected} />}</div>
            : section === "history" ? (selected ? <SiteActivity key={selected.id} site={selected} transferSiteIds={transferSiteIds} siteIds={selected ? [selected.id, ...connectionMembers.map(member => member.id)] : []} sites={sites} canonicalId={identity.canonicalId} deployments={siteDeployments} loading={deploymentsQuery.isFetching} error={deploymentsQuery.error?.message || deploymentRecords.error?.message} onRefresh={() => { void deploymentsQuery.refetch(); void deploymentRecords.refetch(); }} busy={busy} onVerify={confirmDeployment} /> : <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Select a WordPress site" />)
            : detailLoading && section !== "overview" ? <div className="flex min-h-52 items-center justify-center text-[12px] text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Inspecting site…</div> : (
              <>
                {section === "overview" && <OverviewTab site={selected} connectSite={connectSite} details={selectedDetails} loading={detailLoading} onSetup={()=>selected && void openSite(selected,true)} onRestore={openBackupImport} onReconnect={() => setProvidersOpen(true)} publicEndpoint={siteEndpoints.data?.endpoints.find(endpoint => endpoint.id === (connectSite?.id ?? selected?.id)) ?? null}
                  sync={selected && (selected.provider === "ddev" || selected.provider === "hostinger" || selected.provider === "zoer-connect") ? <SiteSyncCard site={selected} live={selectedSource} copies={selectedCopies} onSelect={selectSite} onPush={setPushFrom} onRefresh={(local, live) => setPullInto({ local, live })} paused={transferWriting}
                    makeCopy={selected.provider !== "ddev" ? <WordPressConnect key={connectSite?.id ?? selected.id} siteId={connectSite?.id ?? selected.id} siteName={selected.name} label={selectedCopies.length ? "Make another local copy" : "Make a local copy"} localCopy onSetup={selected.provider === "hostinger" ? () => void openSite(selected, true) : undefined} onRestore={openBackupImport} /> : undefined} /> : null} />}
                {connectionMembers.length > 1 && section === "overview" && <section aria-label="Website connections" className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border-muted pt-3 text-[13px]"><p className="text-text-secondary">{connectionsCombined ? "This page combines the site's Hostinger hosting and its Zoer Connect transfers." : "Hostinger and Zoer Connect have the same website address."}</p><Btn size="sm" variant="ghost" onClick={toggleConnections}>{connectionsCombined ? "Show them separately" : "Combine them"}</Btn></section>}
                {section === "plugins" && <ExtensionsTab key={tab === "themes" ? "theme" : "plugin"} developingPlugin={developingPlugin} onDevelop={tab === "themes" ? undefined : setDevelopingPlugin} kind={tab === "themes" ? "theme" : "plugin"} onKind={kind => setTab(kind === "theme" ? "themes" : "plugins")} onSecurity={selected?.provider === "ddev" ? () => setTab("security") : undefined} paused={transferWriting} site={selected} connectSiteId={connectSite?.id} connectConnected={connectSite?.provider === "zoer-connect" && connectSite.status === "connected"} rows={(tab === "themes" ? selectedDetails?.themes : selectedDetails?.plugins) || []} query={extensionQuery} setQuery={setExtensionQuery} slug={extensionSlug} setSlug={setExtensionSlug} directoryResults={directoryResults} busy={busy} error={error} onSearch={searchDirectory} onPlan={planExtension} />}
                {section === "security" && selected && <WordPressSecurity key={selected.id} site={selected} onStart={() => void changeLifecycle(selected)} />}
                {section === "backups" && connectSite?.provider === "zoer-connect" && <div className="mb-5"><PluginPulls key={connectSite.id} siteId={connectSite.id} siteName={selected?.name ?? connectSite.name} /></div>}
                {section === "backups" && <BackupsTab site={selected} details={selectedDetails} recoveryPoints={selected ? recoveryPointsFor([...(selectedDetails?.recoveryPoints ?? []), ...recoveryPoints], selected) : []} busy={busy} paused={transferWriting} retainPortableBackup={retainPortableBackup} onRetainPortableBackup={setRetainPortableBackup} onCreatePortableBackup={createPortableBackup} onRecordRecovery={recordRecovery} onImportBackup={openBackupImport} />}
                {section === "deployments" && selected && selected.provider !== "ddev" && <LiveTransferTab site={selected} connectSite={connectSite?.provider === "zoer-connect" ? connectSite : null} copies={selectedCopies} onPush={setPushFrom} onSelect={selectSite} makeCopy={<WordPressConnect key={`copy:${connectSite?.id ?? selected.id}`} siteId={connectSite?.id ?? selected.id} siteName={selected.name} label="Make a local copy" localCopy onSetup={selected.provider === "hostinger" ? () => void openSite(selected, true) : undefined} onRestore={openBackupImport} />} hostingerPublish={selected.provider === "hostinger" || connectionsCombined ? <DeploymentsTab sites={sites} fixedSource={null} connections={connections} source={publishSource} setSource={setPublishSource} connection={publishConnection} setConnection={setPublishConnection} domain={publishDomain} setDomain={setPublishDomain} mode={publishMode} setMode={setPublishMode} busy={busy} onPlan={planPublish} onImport={() => setTab("backups")} compact /> : null} onActivity={() => setTab("history")} />}
                {section === "deployments" && selected?.provider === "ddev" && <DeploymentsTab onPushToLive={() => setPushFrom(selected)} paused={transferWriting} sites={sites} fixedSource={selected.capabilities.deploySource ? selected : null} connections={connections} source={publishSource} setSource={setPublishSource} connection={publishConnection} setConnection={setPublishConnection} domain={publishDomain} setDomain={setPublishDomain} mode={publishMode} setMode={setPublishMode} busy={busy} onPlan={planPublish} onImport={() => setTab("backups")} onActivity={() => setTab("history")} />}
              </>
            )}
          </PageTabPanel>
          </div>
        </div>
      </div>

      {pushFrom && <PushToLiveDialog key={pushFrom.id} source={sites.find(site => site.id === pushFrom.id) ?? pushFrom} onStartSource={() => void changeLifecycle(sites.find(site => site.id === pushFrom.id) ?? pushFrom)} sites={sites} onClose={() => setPushFrom(null)} onHosting={pushFrom.capabilities.deploySource && connections.length ? () => { openPublish(pushFrom); setPushFrom(null); } : undefined} />}
      {pullInto && (() => { const live = identity.connector(pullInto.live) ?? pullInto.live; return <Modal mobileSheet title={`Pull from live · ${pullInto.local.name}`} onClose={() => setPullInto(null)}>
        {live.provider === "zoer-connect" ? <PluginLocalCopy siteId={live.id} siteName={pullInto.live.name} sourceUrl={live.url} refreshSiteId={pullInto.local.id} /> : <p className="text-sm text-text-secondary">Connect {pullInto.live.name} with Zoer Connect to pull from it. Open the live site and choose <strong>Make a local copy</strong> for setup steps.</p>}
      </Modal>; })()}
      {providersOpen && <Modal title="Provider accounts" onClose={() => setProvidersOpen(false)}><ConnectionsTab onConnected={() => void load(true, true)} connections={connections} name={connectionName} setName={setConnectionName} token={connectionToken} setToken={setConnectionToken} busy={busy} onAdd={addConnection} onTest={testConnection} onRemove={removeConnection} /></Modal>}
      {extensionPlan && <ReviewPanel title={`${wordpressExtensionActionLabel(extensionPlan.plan.operation)} ${extensionPlan.plan.kind}${extensionPlan.plan.slugs.length > 1 ? "s" : ""}`} plan={extensionPlan.plan} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy === "apply-extension"} onApply={applyExtension} onCancel={() => { setExtensionPlan(null); setConfirmation(""); }} />}
      {publishPlan && <ReviewPanel title={`${publishPlan.mode === "replace" ? "Replace" : "Publish"} ${publishPlan.domain}`} plan={publishPlan} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy === "execute-publish"} onApply={executePublish} onCancel={() => { setPublishPlan(null); setConfirmation(""); }} />}
    </section>
    </PluginPage>
  );
}

function SiteBadges({ site }: { site: WordPressManagedSite }) {
  if (!site.updates && !site.vulnerabilities) return null;
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{site.updates ? <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[12px] text-status-warning">{site.updates} {site.updates === 1 ? "update" : "updates"}</span> : null}{site.vulnerabilities ? <span className="rounded bg-status-error/10 px-1.5 py-0.5 text-[12px] text-status-error">{site.vulnerabilities} {site.vulnerabilities === 1 ? "risk" : "risks"}</span> : null}</div>;
}

/** Healthy sites get a quiet dot; any other state keeps its label so it stands out. */
function SiteStatus({ status }: { status: string }) {
  if (status === "running" || status === "connected") return <span role="img" aria-label={statusLabel(status)} className="mt-1 h-2 w-2 shrink-0 rounded-full bg-status-success" />;
  return <Status status={status} />;
}

function siteHost(site: WordPressManagedSite) {
  return site.managedUrl ? new URL(site.managedUrl).hostname : site.domain || site.provider;
}

const pairControlClass = "inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-text-muted transition hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-focus";

function SiteCard({ site, selected, onSelect, mergeInto, onMerge }: { site: WordPressManagedSite; selected: boolean; onSelect: (site: WordPressManagedSite) => void; mergeInto: WordPressManagedSite | null; onMerge: (source: WordPressManagedSite) => void }) {
  return <div className={`rounded-lg border transition ${selected ? "border-accent/40 bg-accent-subtle" : "border-border-muted bg-surface-primary/40 hover:border-border-default hover:bg-surface-hover"}`}>
    <button type="button" aria-pressed={selected} onClick={() => onSelect(site)} className="w-full rounded-lg p-2.5 text-left">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-text-primary">{providerIcon(site.provider)}<span className="break-words">{site.name}</span></span>
        <SiteStatus status={site.status} />
      </div>
      <div className="mt-1 truncate text-xs text-text-secondary">{siteLocation(site)} · {siteHost(site)}</div>
      <SiteBadges site={site} />
    </button>
    {mergeInto && <div className="flex justify-end border-t border-border-muted/60 px-1.5 py-1">
      <button type="button" title={mergeInto.id === site.id ? "Show this site and its local copies as one card" : `Show this local copy on the ${mergeInto.name} card`} onClick={() => onMerge(mergeInto)} className={pairControlClass}><Link2 className="h-3 w-3" aria-hidden="true" />{mergeInto.id === site.id ? "Merge with local copies" : "Merge with live site"}</button>
    </div>}
  </div>;
}

/** One card for a live site and the local copies made from it; each environment is its own row. */
function SitePairCard({ source, copies, selectedId, onSelect, onSeparate }: { source: WordPressManagedSite; copies: WordPressManagedSite[]; selectedId: string | null; onSelect: (site: WordPressManagedSite) => void; onSeparate: () => void }) {
  const members = [source, ...copies];
  const active = members.some((site) => site.id === selectedId);
  return <div className={`rounded-lg border p-1.5 transition ${active ? "border-accent/40" : "border-border-muted bg-surface-primary/40"}`}>
    <div className="flex items-start justify-between gap-2 px-1 pt-0.5">
      <div className="min-w-0">
        <div className="break-words text-[13px] font-medium text-text-primary">{source.name}</div>
      </div>
      <button type="button" title="Show the live site and its local copies as separate cards" onClick={onSeparate} className={`${pairControlClass} -mr-0.5`}><Unlink2 className="h-3 w-3" aria-hidden="true" />Separate</button>
    </div>
    <div className="mt-1.5 space-y-1">
      {members.map((site) => {
        const selected = site.id === selectedId;
        return <button key={site.id} type="button" aria-pressed={selected} onClick={() => onSelect(site)} className={`w-full rounded-md border p-2 text-left transition ${selected ? "border-accent/40 bg-accent-subtle" : "border-transparent hover:border-border-default hover:bg-surface-hover"}`}>
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">{providerIcon(site.provider)}<span className="truncate">{siteLocation(site)}</span></span>
            <SiteStatus status={site.status} />
          </div>
          <div className="mt-1 truncate text-xs text-text-secondary">{siteHost(site)}</div>
          <SiteBadges site={site} />
        </button>;
      })}
    </div>
  </div>;
}

function OverviewTab({ site, connectSite, details, loading, onSetup, onRestore, sync, onReconnect, publicEndpoint }: { site: WordPressManagedSite | null; connectSite: WordPressManagedSite | null; details: WordPressSiteDetails | null; loading: boolean; onSetup: () => void; onRestore: () => void; /** The local ⇄ live card. */ sync?: React.ReactNode; onReconnect?: () => void; /** The site's Zoer Connect endpoint, whose public pages can be checked. */ publicEndpoint?: { id: string; origin: string } | null }) {
  if (!site) return <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Select a WordPress site" />;
  const health = details?.health || [];
  return <div className="space-y-4">
    {publicEndpoint && <PublicationStatus key={publicEndpoint.id} siteId={publicEndpoint.id} siteUrl={publicEndpoint.origin} onReconnect={onReconnect} />}
    {sync}
    {site.provider === "ddev" && <WordPressCoreUpdates key={site.id} site={site} />}
    {site.provider === "hostinger" && <HostingerSiteTools key={site.id} site={site} />}
    {!sync && (site.provider === "hostinger" || site.provider === "zoer-connect") && <section className="rounded-lg border border-border-default p-4"><h4 className="text-sm font-medium text-text-heading">Local development copy</h4><p className="my-3 text-sm text-text-secondary">Download this website into a separate local WordPress site for testing and development.</p><WordPressConnect key={connectSite?.id ?? site.id} siteId={connectSite?.id ?? site.id} siteName={site.name} label="Make a local copy" localCopy onSetup={site.provider === "hostinger" ? onSetup : undefined} onRestore={onRestore} /></section>}
    <details><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-sm text-text-secondary">Site details</summary><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Info label="Provider" value={site.provider} /><Info label="Environment" value={site.environment} />
      <Info label="WordPress" value={site.wordpressVersion || "Provider-managed"} />
      <Info label="PHP" value={site.phpVersion || "Not reported"} />
      <Info label="Cached updates" value={site.updates === null ? "Not checked" : String(site.updates)} />
    </div></details>

    {site.limitation && !(site.provider === "zoer-connect" && site.status === "connected") && (site.status === "error" || site.status === "unavailable"
      ? <div className="rounded-md border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-[12px] leading-5 text-status-warning"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />{site.limitation}</div>
      : <p className="text-[12px] leading-5 text-text-secondary">{site.limitation}</p>)}
    {loading ? <p role="status" className="text-sm text-text-secondary">Checking Site Health…</p> : <section><h4 className="text-[13px] font-semibold text-text-heading">Site Health</h4><div className="mt-2 grid gap-2 md:grid-cols-2">{health.map((item, index) => <div key={`${item.test}-${index}`} className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-text-primary">{item.label || item.test}</span><Status status={item.status || "unknown"} /></div>{item.status !== "good" && item.description && <p className="mt-1 line-clamp-3 text-[12px] leading-4 text-text-secondary">{item.description}</p>}</div>)}{!health.length && <p className="text-[12px] text-text-secondary">{site.provider === "ddev" ? "No Site Health checks were returned." : "This provider doesn't report Site Health."}</p>}</div></section>}
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="text-[12px] text-text-secondary">{label}</div><div className="mt-1 truncate text-[13px] font-medium capitalize text-text-primary">{value}</div></div>;
}

function ExtensionsTab({ developingPlugin=null, onDevelop, kind, onKind, onSecurity, paused = false, site, connectSiteId, connectConnected = false, rows, query, setQuery, slug, setSlug, directoryResults, busy, error, onSearch, onPlan }: { developingPlugin?:string|null; onDevelop?:(slug:string|null)=>void; kind: WordPressExtensionKind; /** Switches between the Plugins and Themes halves. */ onKind: (kind: WordPressExtensionKind) => void; /** Opens the local scanner (local DDEV sites). */ onSecurity?: () => void; /** A transfer is changing this site; changes wait. */ paused?: boolean; site: WordPressManagedSite | null; connectSiteId?: string; /** Zoer Connect is already connected (no pairing box). */ connectConnected?: boolean; rows: WordPressInstalledExtension[]; query: string; setQuery: (value: string) => void; slug: string; setSlug: (value: string) => void; directoryResults: Array<{ slug: string; name: string; description: string; imageUrl: string | null }>; busy: string | null; error: string | null; onSearch: (kind: WordPressExtensionKind) => void; onPlan: (kind: WordPressExtensionKind, operation: WordPressExtensionOperation, slugs: string[]) => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const sources=useQuery({queryKey:[getApiBase(),"site-repository-development",site?.id],queryFn:()=>json<{repositories:SiteRepositorySource[]}>(`/wordpress-manager/sites/${encodeURIComponent(site!.id)}/repository-development`),enabled:kind==='plugin'&&site?.provider==='ddev'&&!isDemoMode(),refetchInterval:30000});
  const sourceFor=(slug:string)=>sources.data?.repositories.find(source=>!!source.link&&source.link.siteId===site?.id&&source.link.slug===slug);
  const developed=rows.find(row=>row.slug===developingPlugin&&canDevelopInstalledPlugin(site?.provider??'',kind,row.status,row.slug));
  const decode = (value: string) => { const el = document.createElement("textarea"); el.innerHTML = value; return el.value; };
  const title = (row: WordPressInstalledExtension) => extensionDisplayName(row.name, row.slug);
  const filtered = rows.filter(row => `${row.name} ${row.slug} ${title(row)}`.toLowerCase().includes(query.toLowerCase()));
  const updates = rows.filter(row => row.updateAvailable).map(row => row.slug);
  const locked = busy !== null || paused;
  const plan = (operation: WordPressExtensionOperation, slugs: string[]) => { setAddOpen(false); onPlan(kind, operation, slugs); };
  // The common change is a button; deleting and development are in the row's menu.
  const actions = (row: WordPressInstalledExtension) => {
    const operations = wordpressExtensionActions(kind, row.status, row.updateAvailable);
    const develop = onDevelop && canDevelopInstalledPlugin(site?.provider ?? "", kind, row.status, row.slug);
    const menu = [
      ...(develop ? [{ label: sourceFor(row.slug) ? "Development" : "Develop from a repository", icon: <Package className="h-4 w-4" />, disabled: busy !== null, onClick: () => onDevelop!(row.slug) }] : []),
      ...operations.filter(op => op === "uninstall").map(op => ({ label: `${wordpressExtensionActionLabel(op)} ${kind}`, icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, disabled: locked, onClick: () => plan(op, [row.slug]) })),
    ];
    return <div className="flex items-center justify-end gap-1">
      {operations.filter(op => op !== "uninstall").map(op => <Btn key={op} size="sm" variant={op === "update" ? "primary" : "secondary"} aria-label={`${wordpressExtensionActionLabel(op)} ${title(row)}`} disabled={locked} onClick={() => plan(op, [row.slug])}>{wordpressExtensionActionLabel(op)}</Btn>)}
      {menu.length > 0 && <ActionMenu label={`More actions for ${title(row)}`} size="sm" items={menu} />}
    </div>;
  };
  const allUnchecked = rows.length > 0 && rows.every(row => !row.securityCheckedAt && !row.vulnerabilities.length);
  const security = (row: WordPressInstalledExtension) => row.vulnerabilities.length ? `${row.vulnerabilities.length} known risks` : row.securityCheckedAt ? "No reported risks" : "Not checked";
  const version = (row: WordPressInstalledExtension) => row.version || "—";
  const kindButton = (value: WordPressExtensionKind, label: string) => <button type="button" aria-pressed={kind === value} onClick={() => kind !== value && onKind(value)} className={`min-h-9 rounded-md px-3 text-[13px] font-medium transition ${kind === value ? "bg-surface-active text-text-heading shadow-sm" : "text-text-secondary hover:text-text-primary"}`}>{label}</button>;
  if (!site) return <EmptyState icon={<Package className="h-7 w-7" />} title="Select a site" />;
  const switcher = <div role="group" aria-label="Plugins or themes" className="inline-flex shrink-0 rounded-lg border border-border-default p-0.5">{kindButton("plugin", "Plugins")}{kindButton("theme", "Themes")}</div>;
  if (!site.capabilities.extensions) return <div className="space-y-3">{switcher}<EmptyState icon={<Package className="h-7 w-7" />} title={`${kind === "plugin" ? "Plugin" : "Theme"} management unavailable`} description={site.limitation || undefined} /></div>;
  if (isLocalWordPress(site) && site.status !== "running") return <div className="space-y-3">{switcher}<EmptyState icon={<Package className="h-7 w-7" />} title={`Start the site to see its ${kind}s`} description="Zoer reads the installed plugins and themes from the running site. Use Start site above." /></div>;
  return <div className="@container space-y-3">
    {developed&&onDevelop&&<Modal title={`Development · ${title(developed)}`} onClose={()=>onDevelop(null)} footer={<Btn onClick={()=>onDevelop(null)}>Close development</Btn>}><WordPressRepositoryDevelopment key={`${site.id}:${developed.slug}`} targetPlugin={{siteId:site.id,slug:developed.slug}}/></Modal>}
    {kind === "plugin" && !connectConnected && rows.some(row => row.slug === "zoer-connect" && row.status === "active") && <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-default p-3"><div><h4 className="text-sm font-medium">Zoer Connect</h4><p className="text-xs text-text-secondary">Paste the connection info generated in WordPress.</p></div><WordPressConnect key={connectSiteId ?? site.id} siteId={connectSiteId ?? site.id} siteName={site.name} /></section>}
    <div className="flex flex-wrap items-center gap-2">{switcher}<SearchInput className="min-w-0 flex-1 basis-44" value={query} onChange={setQuery} placeholder={`Filter installed ${kind}s…`} /><Btn size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} disabled={paused} onClick={() => { setAddOpen(true); setSearched(false); setSlug(""); }}>Add {kind}</Btn>{updates.length > 0 && <Btn size="sm" disabled={locked} onClick={() => plan("update", updates)}>Review {updates.length} {updates.length === 1 ? "update" : "updates"}</Btn>}</div>
    {paused && <p role="status" className="text-xs text-status-warning">A transfer is changing this site. {kind === "plugin" ? "Plugin" : "Theme"} changes are paused until it finishes, and this list may change.</p>}
    {allUnchecked && onSecurity && <p className="text-xs text-text-secondary">Known vulnerabilities haven't been checked for these {kind}s. <button type="button" className="min-h-8 text-accent underline underline-offset-2 sm:min-h-0" onClick={onSecurity}>Run a security scan</button></p>}
    {addOpen && <Modal title={`Add ${kind}`} onClose={() => setAddOpen(false)}>
      <form onSubmit={e => { e.preventDefault(); if (slug.trim().length >= 3) { setSearched(true); onSearch(kind); } }} className="flex gap-2"><input autoFocus aria-label={`Search ${kind} directory`} className={controlClass()} value={slug} onChange={e => setSlug(e.target.value)} placeholder={`Search WordPress.org ${kind}s…`} /><Btn type="submit" disabled={slug.trim().length < 3 || busy !== null} loading={busy === `search:${kind}`}>Search</Btn></form>
      <p className="mt-2 text-xs text-text-secondary">Choose a result to review installation.</p>
      {error && <p role="alert" className="mt-3 text-sm text-status-error">{error}</p>}
      {searched && busy !== `search:${kind}` && <div className="mt-4 space-y-3">{directoryResults.map(result => <article key={result.slug} className="rounded-lg border border-border-default p-3"><h3 className="text-sm font-medium">{decode(result.name)}</h3><p className="mt-1 text-xs text-text-muted">{result.slug}</p><p className="my-2 text-sm text-text-secondary">{decode(result.description)}</p><Btn disabled={locked} onClick={() => plan("install", [result.slug])}>Review installation</Btn></article>)}{!directoryResults.length && !error && <p className="text-sm text-text-secondary">No results. Try another name.</p>}</div>}
      <details className="mt-5 border-t border-border-default pt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-sm text-text-secondary">Advanced: install by exact slug</summary><p className="my-2 text-xs text-text-secondary">Use a WordPress.org slug such as contact-form-7 in the search field above.</p><Btn disabled={!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) || locked} onClick={() => plan("install", [slug.trim()])}>Review slug installation</Btn></details>
    </Modal>}
    <ul className="space-y-2 @2xl:hidden">{filtered.map(row => <li key={row.slug} className="flex items-center justify-between gap-2 rounded-lg border border-border-default p-3"><div className="flex min-w-0 flex-1 items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words text-sm font-medium">{title(row)}</h4><p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary"><Status status={row.status} /><span>{version(row)}{row.updateAvailable ? ` → ${row.updateVersion || "latest"}` : ""}</span><span>Auto-update {wordpressExtensionAutoUpdateLabel(row.autoUpdate).toLowerCase()}</span>{!allUnchecked && <span>{security(row)}</span>}</p>{sourceFor(row.slug)&&<p className="mt-1 break-words text-xs text-accent">Repository: {sourceFor(row.slug)!.name}</p>}</div></div><div className="shrink-0">{actions(row)}</div></li>)}</ul>
    <div className="hidden overflow-x-auto rounded-lg border border-border-default @2xl:block"><table className="w-full text-left text-sm"><thead className="bg-surface-primary text-xs text-text-secondary"><tr><th className="p-3">{kind === "plugin" ? "Plugin" : "Theme"}</th><th className="p-3">Status</th><th className="p-3">Version</th><th className="p-3">Auto-update</th>{!allUnchecked && <th className="p-3">Security</th>}<th className="p-3 text-right"><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map(row => <tr key={row.slug} className="border-t border-border-muted"><td className="p-3"><div className="font-medium">{title(row)}</div><div className="text-xs text-text-secondary">{row.slug}</div>{sourceFor(row.slug)&&<p className="mt-1 text-xs text-accent">Repository: {sourceFor(row.slug)!.name}</p>}</td><td className="p-3"><Status status={row.status} /></td><td className="p-3 text-xs">{version(row)}{row.updateAvailable && <div className="text-status-warning">→ {row.updateVersion || "latest"}</div>}</td><td className="p-3 text-xs text-text-secondary">{wordpressExtensionAutoUpdateLabel(row.autoUpdate)}</td>{!allUnchecked && <td className="p-3 text-xs text-text-secondary">{security(row)}{row.securitySource && <div className="mt-1">{row.securitySource}{row.securityCheckedAt ? ` · ${new Date(row.securityCheckedAt).toLocaleString()}` : ""}</div>}</td>}<td className="p-3">{actions(row)}</td></tr>)}</tbody></table></div>
    {!filtered.length && <p className="py-6 text-center text-sm text-text-secondary">{query ? `No ${kind}s match “${query}”.` : `No installed ${kind}s reported.`}</p>}
    <p className="text-xs text-text-muted">Auto-update shows what the site reports. Change it in WordPress or your hosting dashboard.</p>
  </div>;
}

function BackupsTab({ site, details, recoveryPoints, busy, paused = false, retainPortableBackup, onRetainPortableBackup, onCreatePortableBackup, onRecordRecovery, onImportBackup }: { site: WordPressManagedSite | null; details: WordPressSiteDetails | null; recoveryPoints: RecoveryPointRecord[]; busy: string | null; /** A transfer is changing this site. */ paused?: boolean; retainPortableBackup: boolean; onRetainPortableBackup: (value: boolean) => void; onCreatePortableBackup: () => void; onRecordRecovery: () => void; onImportBackup: () => void }) {
  return <div className="space-y-5">
    {site?.provider === "hostinger" && <section className="rounded-md border border-status-warning/25 bg-status-warning/5 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-[13px] font-semibold text-status-warning">Remote recovery points</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Create and verify a backup in hPanel, then record it here. Required within 24 hours of production changes.</p></div><Btn size="sm" loading={busy === "recovery"} icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={onRecordRecovery}>Record verified backup</Btn></div><div className="mt-3 space-y-2">{recoveryPoints.map((point) => <div key={point.id} className="rounded border border-border-muted bg-surface-primary/40 px-3 py-2 text-[13px]"><span className="font-medium text-text-primary">{point.label}</span><span className="ml-2 text-text-secondary">{new Date(point.verifiedAt).toLocaleString()}</span></div>)}{!recoveryPoints.length && <p className="text-[13px] text-text-secondary">No verified recovery point recorded.</p>}</div></section>}
    {site?.provider === "ddev" && <><section className="rounded-md border border-border-default p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-[13px] font-semibold text-text-heading">Download a full backup</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Files and database in one archive. The site is in maintenance mode for a moment while it is made.</p><label className="mt-3 flex items-start gap-2 text-[13px] text-text-secondary"><input type="checkbox" checked={retainPortableBackup} onChange={(event) => onRetainPortableBackup(event.target.checked)} className="ui-checkbox mt-0.5 h-4 w-4 shrink-0" /><span>Also keep a copy in Files</span></label></div><Btn className="w-full shrink-0 sm:w-auto" size="sm" variant="primary" icon={<HardDriveDownload className="h-3.5 w-3.5" />} loading={busy === "portable-backup"} disabled={site.status !== "running" || busy !== null || paused} onClick={onCreatePortableBackup}>Download backup</Btn></div>{site.status !== "running" && <p className="mt-2 text-[13px] text-status-warning">Start this DDEV site before creating a portable backup.</p>}{paused && <p className="mt-2 text-[13px] text-status-warning">Wait for the running transfer to finish before backing up.</p>}</section><section><h4 className="text-[13px] font-semibold text-text-heading">Automatic recovery points</h4><p className="mt-1 text-xs text-text-secondary">Saved automatically before each managed change (a plugin update, a refresh from live), for rolling that change back. They stay on the server and can't be downloaded.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{details?.backups.map((backup) => <div key={backup.id} className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="truncate text-[12px] font-medium text-text-primary" title={backup.name || backup.id}>{recoveryPointLabel(backup.name || backup.id)}</div><div className="mt-1 text-[12px] text-text-secondary">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : ""}</div><div className="mt-2 text-[12px] text-text-secondary">Database {humanBytes(backup.database?.bytes)} · Files {humanBytes(backup.content?.bytes)}</div></div>)}{!details?.backups.length && <p className="text-[13px] text-text-secondary">No recovery points yet.</p>}</div></section></>}
    <section className="rounded-md border border-border-default p-3"><h4 className="text-[13px] font-semibold text-text-heading">Restore a backup</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Upload an UpdraftPlus or Hostinger backup to start a new local site from it. This site is not changed.</p><Btn className="mt-3" size="sm" icon={<HardDriveDownload className="h-4 w-4" />} onClick={onImportBackup}>Restore into a new local site</Btn></section>
  </div>;
}

/**
 * Transfer & publish for a live website: its Zoer Connect transfers, pushing from its local
 * copies, publishing through a Hostinger account (folded away) and this website's receipts.
 */
function LiveTransferTab({ site, connectSite, copies, onPush, onSelect, makeCopy, hostingerPublish, onActivity }: {
  site: WordPressManagedSite; connectSite: WordPressManagedSite | null; copies: WordPressManagedSite[];
  onPush: (local: WordPressManagedSite) => void; onSelect: (site: WordPressManagedSite) => void; makeCopy: React.ReactNode; hostingerPublish: React.ReactNode;
  /** Opens Activity, where transfers and receipts are listed. */ onActivity: () => void;
}) {
  return <div className="min-w-0 space-y-4">
    <section className="space-y-2 rounded-lg border border-border-default p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-text-heading"><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Transfers</h4>
      {connectSite ? <>
        <p className="text-[13px] text-text-secondary">Pull, back up, export or find &amp; replace on {site.name}. Transfers run on the Zoer server.</p>
        <WordPressConnect key={`tab:${connectSite.id}`} siteId={connectSite.id} siteName={site.name} label="Open transfers" headerButton />
      </> : <>
        <p className="text-[13px] text-text-secondary">Install Zoer Connect on this website to pull, push and back it up from Zoer.</p>
        <WordPressConnect key={`tab:${site.id}`} siteId={site.id} siteName={site.name} label="Set up Zoer Connect" />
      </>}
    </section>
    <section className="space-y-2 rounded-lg border border-border-default p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-text-heading"><Rocket className="h-4 w-4" aria-hidden="true" />Push from a local copy</h4>
      {copies.length ? <ul className="space-y-2">{copies.map(copy => <li key={copy.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted p-2.5">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(copy)}><span className="block truncate font-medium">{copy.name}</span><span className="block truncate text-[12px] text-text-secondary">{copy.managedUrl || copy.url} · {copy.status}</span></button>
        <Btn size="sm" variant="primary" onClick={() => onPush(copy)}>Push to live</Btn>
      </li>)}</ul> : <p className="text-[13px] text-text-secondary">No local copy yet. Make one to develop safely, then push your changes back here.</p>}
      {makeCopy}
    </section>
    {hostingerPublish && <details className="min-w-0 rounded-lg border border-border-default p-4"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm font-medium sm:min-h-0">Publish a local site through your Hostinger account (without Zoer Connect)</summary><div className="mt-3">{hostingerPublish}</div></details>}
    <ActivityPointer onActivity={onActivity} />
  </div>;
}

function ActivityPointer({ onActivity }: { onActivity: () => void }) {
  return <p className="text-[13px] text-text-secondary">Running and past transfers, and publishing receipts, are in <button type="button" className="min-h-8 text-accent underline underline-offset-2 sm:min-h-0" onClick={onActivity}>Activity</button>.</p>;
}

function DeploymentsTab({ compact = false, onPushToLive, paused = false, sites, fixedSource, connections, source, setSource, connection, setConnection, domain, setDomain, mode, setMode, busy, onPlan, onImport, onActivity }: { compact?: boolean; onPushToLive?: () => void; /** A transfer is changing this site. */ paused?: boolean; sites: WordPressManagedSite[]; fixedSource: WordPressManagedSite | null; connections: HostingerConnectionPublic[]; source: string; setSource: (value: string) => void; connection: string; setConnection: (value: string) => void; domain: string; setDomain: (value: string) => void; mode: "new" | "replace"; setMode: (value: "new" | "replace") => void; busy: string | null; onPlan: (event: React.FormEvent) => void; onImport: () => void; /** Opens Activity (full pages only). */ onActivity?: () => void }) {
  const destinations = useQuery({queryKey:["wordpress","hostinger-setup",connection],queryFn:()=>api.getHostingerSetupInventory(connection),enabled:!!connection,staleTime:0});
  const publishForm = <form onSubmit={onPlan} className="rounded-lg border border-border-default bg-surface-primary p-4">
      <h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><Rocket className="h-4 w-4 shrink-0" />{onPushToLive ? "Publish through a Hostinger account" : "Publish local changes"}</h4>
      <p className="mt-1 text-[13px] text-text-secondary">{fixedSource ? `From ${fixedSource.name}. ` : ""}Replaces the live site; live edits are not merged.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* On a local site's own page it is already the source; only other pages ask. */}
        {fixedSource ? null : <label className="min-w-0 space-y-1 text-sm">From: local site<Select searchable aria-label="Deployment source site" optionDetails={siteOptions(sites)} className={selectClass("compact")} value={source} onChange={event => setSource(event.target.value)}><option value="">Choose local site</option>{sites.filter(site => site.capabilities.deploySource).map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}</Select></label>}
        <label className="min-w-0 space-y-1 text-sm">Hostinger account<Select searchable aria-label="Hostinger connection" className={selectClass("compact")} value={connection} onChange={event => { setConnection(event.target.value); setDomain(""); }}><option value="">Choose account</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="min-w-0 space-y-1 text-sm">Destination type<Select aria-label="Deployment mode" className={selectClass("compact")} value={mode} onChange={event => { setMode(event.target.value as "new" | "replace"); setDomain(""); }}><option value="replace">Update an existing live site</option><option value="new">Publish to a new / empty site</option></Select></label>
        {mode === "replace" ? <label className="min-w-0 space-y-1 text-sm">To: live site<Select searchable aria-label="Target live site" optionDetails={Object.fromEntries(sites.filter(site => site.provider === "hostinger").map(site => [site.domain, { icon: providerIcon(site.provider), description: siteDomain(site) }]))} className={selectClass("compact")} value={domain} onChange={event => setDomain(event.target.value)}><option value="">Choose live destination</option>{sites.filter(site => site.provider === "hostinger" && site.connectionId === connection).map(site => <option key={site.id} value={site.domain || ""}>{siteLabel(site)}</option>)}</Select></label>
          : <label className="min-w-0 space-y-1 text-sm">To: empty Hostinger website<Select searchable aria-label="Target empty Hostinger website" value={domain} onChange={e=>setDomain(e.target.value)}><option value="">Choose created destination</option>{destinations.data?.websites.filter(w=>!w.hasWordPress).map(w=><option key={w.domain} value={w.domain}>{w.domain}</option>)}</Select><Btn type="button" size="sm" loading={destinations.isFetching} onClick={()=>void destinations.refetch()}>Refresh destinations</Btn>{destinations.error && <p role="alert" className="text-status-warning">{destinations.error instanceof Error?destinations.error.message:"Destinations unavailable."}</p>}</label>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">{mode === "replace" && <p className="mr-auto text-sm text-text-secondary">Back up the live site first.</p>}<Btn type="submit" variant="primary" loading={busy === "plan-publish"} disabled={!source || !connection || !domain || paused}>Review publication</Btn></div>
    </form>;
  return <div className="space-y-5">
    {onPushToLive && fixedSource && <section className="space-y-3 rounded-lg border border-border-default bg-surface-primary p-4">
      <h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><Rocket className="h-4 w-4 shrink-0" />Push to live</h4>
      <p className="text-[13px] text-text-secondary">Send {fixedSource.name}'s changes (code only, or everything) to a site connected with Zoer Connect. You review the result before the live site switches.</p>
      <Btn variant="primary" disabled={paused} onClick={onPushToLive}>Push to live</Btn>
      {paused && <p className="text-[13px] text-status-warning">Wait for the running transfer to finish before pushing.</p>}
    </section>}
    {onPushToLive && !compact ? <details className="min-w-0 rounded-lg border border-border-default p-4"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm font-medium sm:min-h-0">Publish through a Hostinger account (without Zoer Connect)</summary><div className="mt-3">{publishForm}</div></details> : publishForm}
    {!compact && <details className="min-w-0 rounded-lg border border-border-default p-4"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm font-medium sm:min-h-0">Create a Hostinger website, or restore a Hostinger backup</summary><div className="mt-3 space-y-4">
    <HostingerWebsiteSetup connections={connections} onCreated={()=>void destinations.refetch()} />
    <section className="rounded-lg border border-border-default p-4"><h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><HardDriveDownload className="h-4 w-4 shrink-0" />Hostinger → local</h4><p className="my-3 text-sm leading-6 text-text-secondary">Restore an UpdraftPlus or Hostinger backup of the live site into a new local site.</p><Btn onClick={onImport}>Open backup import</Btn></section>
    </div></details>}
    {!compact && onActivity && <ActivityPointer onActivity={onActivity} />}
  </div>;
}

function ConnectionsTab({ onConnected, connections, name, setName, token, setToken, busy, onAdd, onTest, onRemove }: { onConnected: () => void; connections: HostingerConnectionPublic[]; name: string; setName: (value: string) => void; token: string; setToken: (value: string) => void; busy: string | null; onAdd: (event: React.FormEvent) => void; onTest: (connection: HostingerConnectionPublic) => void; onRemove: (connection: HostingerConnectionPublic) => void }) {
  return <div className="space-y-5">
    <section><h4 className="flex items-center gap-2 text-[13px] font-semibold text-text-heading"><Cloud className="h-4 w-4" /> Hostinger connections</h4><p className="mt-1 text-[13px] leading-4 text-text-secondary">Connect your account to discover and manage its WordPress sites.</p><HostingerBrowserLogin name={name} setName={setName} onConnected={onConnected} connections={connections} /><details className="mt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-[13px] text-text-secondary">Advanced setup · API token</summary><form onSubmit={onAdd} className="mt-3 grid gap-2 rounded-md border border-border-muted bg-surface-primary/40 p-3 md:grid-cols-[1fr_2fr_auto]"><input aria-label="Connection name" className={controlClass("compact")} value={name} onChange={(event) => setName(event.target.value)} placeholder="My Hostinger account" /><input aria-label="Hostinger API token" type="password" autoComplete="new-password" className={controlClass("compact")} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Hostinger API token" /><Btn size="sm" type="submit" variant="primary" loading={busy === "add-connection"} disabled={!name || !token}>Connect</Btn></form></details><div className="mt-3 space-y-2">{connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-muted bg-surface-primary/50 p-3"><div><div className="flex items-center gap-2 text-[12px] font-medium text-text-primary">{connection.name}{(() => { const health = connectionHealth(connection); return <StatusBadge tone={!health.ok ? "error" : health.stale ? "neutral" : "success"}>{!health.ok ? "Needs reconnecting" : health.stale ? "Not checked recently" : "Working"}</StatusBadge>; })()}</div><div className="mt-1 text-[12px] text-text-secondary">{connection.oauthConnectionId ? "Browser sign-in · Zoer connection" : connection.authMethod === "browser-login" ? "Browser sign-in" : "API token"} · Last tested {connection.lastTestedAt ? new Date(connection.lastTestedAt).toLocaleString() : "never"}</div>{connection.lastError && <div className="mt-1 text-[12px] text-status-error">{connection.lastError}</div>}</div><div className="flex gap-1"><Btn size="sm" variant="ghost" loading={busy === `test:${connection.id}`} onClick={() => onTest(connection)}>Test</Btn><Btn size="sm" variant="ghost" loading={busy === `remove:${connection.id}`} icon={<Trash2 className="h-3 w-3" />} onClick={() => onRemove(connection)}>Remove</Btn></div>{!connectionHealth(connection).ok && <div className="w-full border-t border-border-muted pt-3"><p className="mb-2 text-[12px] text-text-secondary">Reconnect keeps this account's sites, recovery points and cache links. Zoer opens a fresh browser for the sign-in.</p><HostingerReconnect connection={connection} onDone={onConnected} /></div>}</div>)}{!connections.length && <p className="text-[13px] text-text-secondary">No Hostinger connection configured.</p>}</div></section>
    {connections.length > 0 && <details className="min-w-0 rounded-lg border border-border-default p-3"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-[13px] font-medium sm:min-h-0">Create a new Hostinger website</summary><div className="mt-3"><HostingerWebsiteSetup connections={connections} onCreated={onConnected} /></div></details>}
  </div>;
}

function ReviewPanel({ title, plan, confirmation, setConfirmation, busy, onApply, onCancel }: { title: string; plan: WordPressExtensionPlan | WordPressPublishPlan; confirmation: string; setConfirmation: (value: string) => void; busy: boolean; onApply: (acknowledgeCoreUpdate?: boolean) => void; onCancel: () => void }) {
  const phrase = plan.confirmationPhrase;
  const [coreAcknowledged, setCoreAcknowledged] = useState(false);
  const core = "coreCheck" in plan ? plan.coreCheck : null;
  return <Modal mobileSheet title={`Review ${title}`} onClose={() => { if (!busy) onCancel(); }} footer={<><Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn><Btn variant="danger" loading={busy} disabled={Boolean(phrase && confirmation !== phrase) || (core?.status === "available" && !coreAcknowledged)} onClick={()=>onApply(coreAcknowledged)}>Apply reviewed plan</Btn></>}><div className="min-w-0 break-words"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-accent" /><div><h3 className="text-[15px] font-semibold text-text-heading">Review: {title}</h3><p className="mt-1 text-[13px] text-text-secondary">Exact plan fingerprint <span className="font-mono">sha256:{plan.fingerprintSha256}</span></p></div></div>{core && <section aria-label="WordPress publication check" className="mt-4 space-y-2 text-sm"><p>WordPress {core.installed} · Latest stable {core.latest}</p><p className="text-text-secondary">Checked {new Date(core.checkedAt).toLocaleString()}</p>{core.status === "available" && <label className="flex items-start gap-2"><input type="checkbox" className="ui-checkbox" checked={coreAcknowledged} onChange={e=>setCoreAcknowledged(e.target.checked)} /><span>Publish WordPress {core.installed} for now. I have reviewed the available update.</span></label>}</section>}{plan.warnings.length > 0 && <div className="mt-4 rounded-md border border-status-warning/25 bg-status-warning/5 p-3"><div className="text-[13px] font-semibold text-status-warning">Warnings</div><ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-4 text-status-warning">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}<div className="mt-4"><div className="text-[13px] font-semibold text-text-secondary">Planned steps</div><ol className="mt-2 space-y-2">{plan.steps.map((step, index) => <li key={`${index}-${step}`} className="flex gap-2 text-[12px] text-text-secondary"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[12px] text-accent">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol></div>{phrase && <div className="mt-4"><label className="mb-1 block text-[13px] text-text-secondary">Type <strong className="font-mono text-text-primary">{phrase}</strong> to confirm</label><input autoFocus className={controlClass()} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>}</div></Modal>;
}
