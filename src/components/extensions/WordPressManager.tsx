import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wordpressKeys, wordpressQueries, activeWordPressDeployment } from "../../lib/queries/wordpress";
import { resourceQueries } from "../../lib/queries/resources";
import { Select as Select } from "@zoer/plugin-ui/controls";
import HostingerBrowserLogin, { alreadyConnectedAs, unloadedHostingerAccounts } from "./HostingerBrowserLogin";
import HostingerReconnect from "./HostingerReconnect";
import SiteStackPanel from "./SiteStackPanel";
import WordPressResources from "./WordPressResources";
import WordPressKubernetesPilot from "./WordPressKubernetesPilot";
import LiveSiteDevelopment from "./LiveSiteDevelopment";
import LinkSiteDialog, { type LinkRequest } from "./LinkSiteDialog";
import ConnectionProblemCard from "./ConnectionProblemCard";
import { useConnectionHealth, type ConnectionProblem } from "./connectionHealth";
import WordPressRepositoryDevelopment from "./WordPressRepositoryDevelopment";
import { canDevelopInstalledPlugin, type SiteRepositorySource } from "./repositoryPluginSelection";
import { useResourceSelection } from "@zoer/plugin-ui/workspace";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  CheckCircle2,
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
import { GoLiveDialog, goLiveStage, useGoLiveOrchestrator, useGoLivePlans } from "./GoLive";
import { hostingerTestSites, type HostingerTestSite } from "./hostingerTestSites";
import SiteSyncCard from "./SiteSyncCard";
import SiteCompareDialog from "./SiteCompareDialog";
import StaticWebsiteExport from "./StaticWebsiteExport";
import PluginLocalCopy from "./pluginEngine/PluginLocalCopy";
import { connectionHealth } from "./pluginEngine/publicationCheck";
import HostingerWebsiteSetup from "./HostingerWebsiteSetup";
import CachingTab, { PublicWebsiteSummary } from "./CachingTab";
import WordPressCoreUpdates from "./WordPressCoreUpdates";
import SiteActivity from "./SiteActivity";
import WordPressSecurity from "./WordPressSecurity";
import { isTransferFence, TRANSFER_FENCE_NOTICE } from "./pluginEngine/runState";
import PluginPulls from "./pluginEngine/PluginPulls";
import ActiveTransferBanner from "./pluginEngine/ActiveTransferBanner";
import { activeSiteRuns } from "./pluginEngine/siteActivity";
import { SITE_RUN_ACTIONS } from "./pluginEngine/runState";
import { useRecentRuns } from "../../lib/queries/plugin-engine";
import { detailSectionFor, managerSection, managerSections, MANAGER_TABS, type ManagerSection, type ManagerTab } from "./managerSections";
import { extensionDisplayName, recoveryPointLabel } from "./wordpressNames";
import { mergeDeployments, parseDeploymentRecord, parseRecoveryPointRecord, parseSiteLink, recoveryPointRecord, recoveryPointsFor, withSiteLinks, type DeploymentRecord, type RecoveryPointRecord, type SiteLinkRecord } from "./pluginEngine/records";
import { commitCatalog, engineKeys, forgetErasedSiteRecords, retireEngineRecords, useCatalogKind } from "../../lib/queries/plugin-engine";
import WordPressAddSite from "./WordPressAddSite";
import WordPressTrash from "./WordPressTrash";
import RecoveryPointPanel from "./RecoveryPointPanel";
import DeleteSiteDialog from "./DeleteSiteDialog";
import HostingerAccountRow from "./HostingerAccountRow";
import { ApiError } from "../../lib/api/_http";
import { hostingerRecordFor, recoveryGateFrom, recoveryPointValidUntil, type RecoveryGate } from "./recoveryGate";
import { hostConnections, runAction, type HostConnectionAccount } from "../../host/actions";
import { isLocalWordPress, wordpressLifecycleAction } from "./wordpressLifecycle";
import { consolidateWordPressSites, readSeparatedSiteConnections, writeSeparatedSiteConnections } from "./wordpressSiteIdentity";
import { filterWordPressSiteGroups, groupWordPressSites, readSeparatedSitePairs, wordPressSiteCopies, wordPressSiteSource, writeSeparatedSitePairs } from "./wordpressSiteGroups";
import { databaseKeys } from "../../lib/queries/databases";
import { createdWebsiteOf, siteAccountId, siteInScope, type SiteScope } from "./wordpressSiteAccounts";
import { DEPLOY_KIND, GROUP_NAME_KIND, makeMainLive, parseGroupName, parseSiteDeploy, removeStackLive, renameGroup, type SiteDeployLink } from "./siteStack";
import { rememberConnectedWordPressSite } from "../../lib/queries/connected-wordpress-site";

function siteLocation(site: WordPressManagedSite) {
  return site.provider === "zoer-connect" ? "External · Zoer Connect" : site.provider === "hostinger" ? "Live · Hostinger" : site.provider === "kubernetes" ? "Local · Kubernetes" : site.provider === "ddev" ? "Local · DDEV" : "Local · Playground";
}
function siteDomain(site: WordPressManagedSite) {
  return site.managedUrl ? new URL(site.managedUrl).hostname : site.domain || "No public URL";
}
function siteLabel(site: WordPressManagedSite) { return `${site.name} — ${siteLocation(site)}`; }
function siteOptions(sites: WordPressManagedSite[], aliases: (id: string) => WordPressManagedSite[] = () => [], copyOf: ReadonlyMap<string, WordPressManagedSite> = new Map(), accountOf: (site: WordPressManagedSite) => string | null = () => null) {
  return Object.fromEntries(sites.map(site => {
    const source = copyOf.get(site.id);
    const status = site.status === "running" || site.status === "connected" ? "" : ` · ${statusLabel(site.status)}`;
    // Local sites' long development hosts repeat their names; live sites show their public domain.
    const account = accountOf(site);
    const where = source ? `Local copy of ${source.name}` : isLocalWordPress(site) ? siteLocation(site) : `${siteLocation(site)}${account ? ` · ${account}` : ""} · ${siteDomain(site)}`;
    return [site.id, { icon: providerIcon(site.provider), description: `${where}${status}`, keywords: [siteDomain(site), source?.name ?? "", account ?? "", ...aliases(site.id).map(alias => `${alias.name} ${alias.provider}`)].join(" ") }];
  }));
}

const DISMISSED_ACCOUNTS = "zoer.wordpress.dismissed-hostinger-accounts";
/** Signed-in Hostinger accounts whose "websites aren't loaded" notice was dismissed (Provider accounts still loads them). */
function readDismissedAccounts(): Set<string> {
  try { const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_ACCOUNTS) || "[]"); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []); }
  catch { return new Set(); }
}
function writeDismissedAccounts(ids: ReadonlySet<string>) {
  try { localStorage.setItem(DISMISSED_ACCOUNTS, JSON.stringify([...ids])); } catch { /* Display preference only. */ }
}
/**
 * A Hostinger account signed in to Zoer whose websites WordPress Manager does not load. When it turns out to be the
 * same Hostinger account as a loaded connection (an earlier or repeated sign-in), the notice says so and points to
 * where Zoer removes sign-ins; hiding it is remembered.
 */
function PendingHostingerAccount({ account, busy, onLoad, onDismiss }: { account: HostConnectionAccount; busy: string | null; onLoad: () => Promise<void>; onDismiss: () => void }) {
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadWebsites = async () => {
    setError(null);
    try { await onLoad(); }
    catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load this Hostinger account.";
      const other = alreadyConnectedAs(message);
      if (other) setDuplicateOf(other); else setError(message);
    }
  };
  return <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-default bg-surface-secondary px-3 py-2 text-[13px]">
    <span className="min-w-0 break-words">{duplicateOf
      ? <>“{account.label}” is another sign-in to the same Hostinger account as “{duplicateOf}”, whose websites are already here. Nothing more to load. To remove the extra sign-in, disconnect “{account.label}” in Zoer Settings → Adapters.</>
      : <>Hostinger account “{account.label}” is signed in, but its websites aren't loaded here yet.</>}
      {error && <span className="block text-status-error">{error}</span>}</span>
    {duplicateOf
      ? <Btn size="sm" variant="ghost" onClick={onDismiss}>Hide</Btn>
      : <><Btn size="sm" variant="primary" loading={busy === `adopt:${account.id}`} disabled={busy !== null} onClick={() => void loadWebsites()}>Load websites</Btn><Btn size="sm" variant="ghost" disabled={busy !== null} onClick={onDismiss}>Not now</Btn></>}
  </div>;
}
/** The connection check's verdict for a site, for its status dot and badge. */
const ProblemContext = createContext<(site: WordPressManagedSite) => ConnectionProblem | null>(() => null);
/** The provider account a live site is on, by name, for its list indicator. */
const AccountContext = createContext<(site: WordPressManagedSite) => string | null>(() => null);
function SiteAccount({ site }: { site: WordPressManagedSite }) {
  const name = useContext(AccountContext)(site);
  return name ? <span title={`Hostinger account ${name}`} className="max-w-[45%] shrink-0 truncate rounded border border-border-default bg-surface-secondary px-1.5 text-[11px] leading-4 text-text-secondary">{name}</span> : null;
}
const problemLabel = (problem: ConnectionProblem) => problem.kind === "unreachable" ? "Not answering" : "Key rejected";

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
  return provider === "hostinger" ? <Cloud className="h-4 w-4" /> : ["ddev", "kubernetes"].includes(provider) ? <Server className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />;
}

export default function WordPressManager({ page = "WordPress" }: { /** Page title; the manager draws its own header so it can contribute actions. */ page?: string }) {
  const dialogs = useDialogs();
  const [selectedId, setSelectedId] = useResourceSelection<string | null>("site", null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"blank" | "backup" | "hostinger">("blank");
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
  // A site link the browser's popup blocker stopped: shown with the link to open by hand.
  const [blockedLink, setBlockedLink] = useState<{ name: string; url: string } | null>(null);
  const [siteQuery, setSiteQuery] = useState("");
  const [pilotOpen, setPilotOpen] = useState(false);
  const [siteScope, setSiteScope] = useResourceSelection<"all" | "local">("scope", "all", ["all", "local"]);
  // A provider account chosen in the same filter; ignored while that account is not connected.
  const [siteAccount, setSiteAccount] = useResourceSelection<string | null>("account", null);
  const [editSite, setEditSite] = useState<WordPressManagedSite | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [separatedPairs, setSeparatedPairs] = useState(() => readSeparatedSitePairs());
  const [developingPlugin,setDevelopingPlugin]=useResourceSelection<string|null>("plugin",null);
  const [extensionQuery, setExtensionQuery] = useState("");
  const [extensionSlug, setExtensionSlug] = useState("");
  const [directoryResults, setDirectoryResults] = useState<Array<{ slug: string; name: string; description: string; imageUrl: string | null }>>([]);
  const [extensionPlan, setExtensionPlan] = useState<{ input: { siteId: string; kind: WordPressExtensionKind; operation: WordPressExtensionOperation; slugs: string[] }; plan: WordPressExtensionPlan } | null>(null);
  // A live Hostinger change refused until a recent hPanel backup is recorded; retried after recording.
  const [recoveryGate, setRecoveryGate] = useState<{ gate: RecoveryGate; input: { siteId: string; kind: WordPressExtensionKind; operation: WordPressExtensionOperation; slugs: string[] }; error?: string } | null>(null);
  const [pushFrom, setPushFrom] = useState<WordPressManagedSite | null>(null);
  /** The live site Push to live opens on, when not the local site's main one. */
  const [pushTo, setPushTo] = useState<string | null>(null);
  const pushFromTo = (local: WordPressManagedSite, liveId: string | null = null) => { setPushTo(liveId); setPushFrom(local); };
  const [goLiveFor, setGoLiveFor] = useState<WordPressManagedSite | null>(null);
  /** The one local-copy dialog: pull `live` into `local`, or into a new copy when `local` is null. */
  const [pullInto, setPullInto] = useState<{ local: WordPressManagedSite | null; live: WordPressManagedSite } | null>(null);
  const [compare, setCompare] = useState<{ live: WordPressManagedSite; local: WordPressManagedSite } | null>(null);
  const [publishPlan, setPublishPlan] = useState<WordPressPublishPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [connectionToken, setConnectionToken] = useState("");
  const [publishSource, setPublishSource] = useState("");
  const [publishConnection, setPublishConnection] = useState("");
  const [publishDomain, setPublishDomain] = useState("");
  const [publishMode, setPublishMode] = useState<"new" | "replace">("replace");
  const [workspaceName, setWorkspaceName] = useState("WordPress workspace");
  const [blankRuntime, setBlankRuntime] = useState<"ddev" | "playground" | null>(null);
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
  // DDEV sites follow the scanner list there (status, and sites trashed or created meanwhile);
  // live sites keep their last full-list state until Security is left.
  const inventory = useMemo(() => {
    if (sitesQuery !== fullSites || section !== "security" || !fullSites.data || !scannerSites.data) return sitesQuery.data;
    const fresh = new Map(scannerSites.data.map(site => [site.id, site]));
    const kept = fullSites.data.flatMap(site => site.provider !== "ddev" ? [site] : fresh.has(site.id) ? [{ ...site, status: fresh.get(site.id)!.status }] : []);
    const known = new Set(kept.map(site => site.id));
    return [...kept, ...scannerSites.data.filter(site => !known.has(site.id))];
  }, [sitesQuery.data, fullSites.data, scannerSites.data, section]); // eslint-disable-line react-hooks/exhaustive-deps
  const [separatedConnections, setSeparatedConnections] = useState(readSeparatedSiteConnections);
  // Local copies point at their source through `site-link:` records (copy.local, or migrated legacy
  // copies). Since Zoer P4 the host's site list no longer tracks copies (`sourceSiteId` is always null).
  const siteLinks = useCatalogKind("site-link");
  // Other live sites a local site was deployed to (`site-deploy:`), shown on its card.
  const siteDeploys = useCatalogKind(DEPLOY_KIND);
  const deploys = useMemo(() => (siteDeploys.data ?? []).map(parseSiteDeploy).filter((item): item is SiteDeployLink => !!item), [siteDeploys.data]);
  // Names given to cards (Rename card); a card without one shows its main site's name.
  const groupNameRecords = useCatalogKind(GROUP_NAME_KIND);
  const groupNames = useMemo(() => new Map((groupNameRecords.data ?? []).map(parseGroupName).filter((item): item is { groupId: string; name: string } => !!item).map(item => [item.groupId, item.name])), [groupNameRecords.data]);
  const renameCard = async (groupId: string, current: string, fallback: string) => {
    const name = await dialogs.prompt({ title: "Rename card", description: `Names this card in the site list. The sites, their WordPress titles and Hostinger are not changed. Leave it empty to show ${fallback} again.`, label: "Card name", defaultValue: current, submitLabel: "Save name" });
    if (name === null) return;
    setError(null);
    try { await renameGroup(groupId, name); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not rename the card."); }
    finally { await client.invalidateQueries({ queryKey: engineKeys.catalog(GROUP_NAME_KIND) }); }
  };
  const sites = useMemo(() => withSiteLinks(inventory ?? [], (siteLinks.data ?? []).map(parseSiteLink).filter((link): link is SiteLinkRecord => !!link)), [inventory, siteLinks.data]);
  const identity = useMemo(() => consolidateWordPressSites(sites, separatedConnections), [sites, separatedConnections]);
  // Saved Zoer Connect connections are tested again every 10 minutes and on Refresh (a website can be deleted or get a new key).
  const health = useConnectionHealth(sites.filter(site => site.provider === "zoer-connect").map(site => site.id));
  const problemOf = (site: WordPressManagedSite) => health.problems.get(identity.connector(site).id) ?? health.problems.get(site.id) ?? null;
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const [replaceKeyFor, setReplaceKeyFor] = useState<WordPressManagedSite | null>(null);
  const [dismissedAccounts, setDismissedAccounts] = useState(readDismissedAccounts);
  const candidateIdentity = useMemo(() => consolidateWordPressSites(sites), [sites]);
  const connectionsQuery = useQuery({ ...wordpressQueries.connections() });
  const deploymentsQuery = useQuery({ ...wordpressQueries.deployments(), refetchInterval: query => query.state.data?.some(item => activeWordPressDeployment(item.status)) ? 5_000 : false, refetchIntervalInBackground: false });
  // Receipts and recovery points migrated into the catalog (`deployment:`, `recovery-point:`) supplement Zoer's own lists.
  const deploymentRecords = useCatalogKind("deployment");
  const recoveryRecords = useCatalogKind("recovery-point");
  const connectorsQuery = useQuery(wordpressQueries.connectors());
  const connections = connectionsQuery.data ?? [];
  const createdWebsites = useMemo(() => hostingerTestSites(deploymentsQuery.data ?? []), [deploymentsQuery.data]);
  const accountOf = (site: WordPressManagedSite) => siteAccountId(site, identity.aliases(site.id), createdWebsites);
  const accountName = (site: WordPressManagedSite) => { const id = accountOf(site); return id ? connections.find(item => item.id === id)?.name ?? null : null; };
  const scope: SiteScope = siteAccount && connections.some(item => item.id === siteAccount) ? `account:${siteAccount}` : siteScope;
  const inScope = (site: WordPressManagedSite) => siteInScope(site, scope, accountOf, item => item.sourceSiteId ? sites.find(other => other.id === item.sourceSiteId) ?? null : null);
  const selectedSummary = identity.sites.find(site => site.id === identity.canonicalId(selectedId ?? "") && inScope(site)) ?? null;
  const inspectSelected = Boolean(selectedSummary && (!isLocalWordPress(selectedSummary) || selectedSummary.status === "running"));
  // Activity uses saved receipts; opening it does not need to run Site Health or inspect extensions.
  const detailSection = detailSectionFor(tab) ?? "overview";
  const inspectDetails = inspectSelected && detailSectionFor(tab) !== null;
  const detailsQuery = useQuery({ ...wordpressQueries.site(selectedSummary?.id ?? "", detailSection), enabled: inspectDetails });
  // Aliases of a shown site stay with it, so a Hostinger site and its Zoer Connect connection still combine.
  const scopedSites = scope === "all" ? sites : sites.filter(site => inScope(site) || identity.aliases(site.id).some(inScope));
  const pickerSites = scope === "all" ? identity.sites : identity.sites.filter(inScope);
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
    try { await Promise.all([load(true, true), health.recheck()]); } finally { setBusy(null); }
  };
  useEffect(() => {
    if (!sitesQuery.data) return;
    setSelectedId(current => current && scopedSites.some(site => site.id === current) ? current : scopedSites[0]?.id || null);
  }, [sitesQuery.data, scope, setSelectedId]);
  useEffect(() => { setPublishConnection(current => current || connectionsQuery.data?.[0]?.id || ""); }, [connectionsQuery.data]);
  // 0.8.0: every site uses the plugin transfer engine; the 0.7.x per-site switch records are tidied away once per page load.
  useEffect(() => { void retireEngineRecords().catch(() => undefined); }, []);
  // The backup prompt belongs to the site whose change was refused.
  useEffect(() => { setRecoveryGate(current => current && current.input.siteId !== selectedId ? null : current); }, [selectedId]);
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
  // A pair card's pull and push wait while a transfer writes to any site in that pair (and its connections).
  const pairWriting = (sites: readonly WordPressManagedSite[]) => activeSiteRuns(recentRuns.data ?? [],
    [...new Set(sites.flatMap(site => [site.id, ...candidateIdentity.aliases(site.id).map(member => member.id)]))]).some(item => item.writes);
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
  const siteEndpoints = useQuery(wordpressQueries.endpoints());
  // Hosting accounts this website depends on. A saved "connected" status is only as current as its
  // last test, so test each once per page load when its site is opened; failures show a banner.
  const hostingConnectionIds = [...new Set([selected, ...connectionMembers].filter((site): site is WordPressManagedSite => site?.provider === "hostinger" && !!site.connectionId).map(site => site.connectionId!))];
  const hostingConnections = connections.filter(connection => hostingConnectionIds.includes(connection.id));
  // Hostinger sign-ins Zoer holds for this plugin whose websites are not loaded here yet.
  const hostAccounts = useQuery({ queryKey: ["wordpress-manager", "host-hostinger-accounts"], queryFn: async () => (await hostConnections.list()).connections.find(entry => entry.alias === "hostinger")?.accounts ?? [], staleTime: 30_000 });
  const pendingAccounts = connectionsQuery.isSuccess ? unloadedHostingerAccounts(hostAccounts.data ?? [], connections).filter(account => !dismissedAccounts.has(account.id)) : [];
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
  // New site → Blank local site: DDEV unless chosen otherwise or unavailable.
  const runtime = blankRuntime ?? (ddevConnector?.active ? "ddev" : "playground");
  const siteGroups = useMemo(() => groupWordPressSites(scopedSites, separatedPairs, separatedConnections, deploys), [scopedSites, separatedPairs, separatedConnections, deploys]);
  const visibleGroups = useMemo(() => filterWordPressSiteGroups(siteGroups, siteQuery, identity.aliases), [siteGroups, siteQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  // The phone picker lists sites in the desktop list's order: each live site followed by its local copies.
  const pickerOrder = useMemo(() => siteGroups.flatMap(group => group.kind === "pair" ? [group.source, ...group.lives, ...group.copies] : [group.site]), [siteGroups]);
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
  // The selected site's stack: a local site's other live sites, or the local sites another live site was deployed from.
  const stackSite = (id: string) => identity.sites.find(site => site.id === identity.canonicalId(id)) ?? null;
  const selectedDeploys = selected ? deploys.filter(item => isLocalWordPress(selected) ? item.localSiteId === selected.id : identity.canonicalId(item.liveSiteId) === selected.id) : [];
  const selectedOtherLives = selected && isLocalWordPress(selected) ? selectedDeploys.flatMap(item => { const live = stackSite(item.liveSiteId); return live && live.id !== selectedSource?.id ? [live] : []; }) : [];
  const selectedDeployedFrom = selected && !isLocalWordPress(selected) ? selectedDeploys.flatMap(item => { const local = sites.find(site => site.id === item.localSiteId); return local && !selectedCopies.some(copy => copy.id === local.id) ? [local] : []; }) : [];
  // The live sites on a local site's card (main first), as push destinations.
  const pushStack = (local: WordPressManagedSite) => {
    const main = wordPressSiteSource(sites, local, separatedConnections);
    const others = deploys.filter(item => item.localSiteId === local.id).flatMap(item => { const live = stackSite(item.liveSiteId); return live ? [live] : []; });
    return [...new Set([...(main && !isLocalWordPress(main) ? [main] : []), ...others].map(live => identity.connector(live).id))];
  };
  const destinationAccount = (id: string) => { const site = sites.find(item => item.id === id) ?? stackSite(id); return site ? accountName(site) : null; };
  const deployOf = (live: WordPressManagedSite) => deploys.find(item => identity.canonicalId(item.liveSiteId) === live.id) ?? null;
  const changeStack = async (work: () => Promise<void>, done: string) => {
    setError(null);
    try { await work(); setNotice(done); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not change the site's card."); }
    finally { await Promise.all([client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") }), client.invalidateQueries({ queryKey: engineKeys.catalog(DEPLOY_KIND) })]); }
  };
  // A local site's Publish form always starts from that site.
  const fixedSourceId = selected?.capabilities.deploySource ? selected.id : "";
  useEffect(() => { if (tab === "deployments" && fixedSourceId) setPublishSource(fixedSourceId); }, [tab, fixedSourceId]);
  // A Hostinger site's Publish form starts with that site as the destination.
  useEffect(() => {
    if (tab !== "deployments" || selected?.provider !== "hostinger") return;
    setPublishMode("replace"); setPublishDomain(selected.domain || ""); if (selected.connectionId) setPublishConnection(selected.connectionId);
  }, [tab, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // A stopped local site has nothing to show: offer to start it, then open it. The tab opens
  // right after the confirmation (still a user gesture, so popup blockers allow it) and loads
  // the site once it runs.
  const openSiteLink = async (site: WordPressManagedSite) => {
    const url = wordpressPreviewUrl(site);
    if (!url) return;
    if (wordpressLifecycleAction(site) !== "start") { window.open(url, "_blank", "noopener,noreferrer"); return; }
    if (!await dialogs.confirm({ title: `Start ${site.name}?`, description: `${site.name} is stopped. Do you want to start this website and open it? Starting takes a minute; the tab loads it when it's ready.`, confirmLabel: "Start and open" })) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setBlockedLink(null);
    await changeLifecycle(site);
    const status = client.getQueryData(inventoryQuery.queryKey)?.find(item => item.id === site.id)?.status;
    // Opening later, without the click, would be blocked too: hand over the link instead.
    if (status === "running") { if (tab) tab.location.href = url; else setBlockedLink({ name: site.name, url }); }
    else tab?.close();
  };

  // A local DDEV site being deleted: the dialog offers the trash or deleting everything.
  // A Hostinger website WordPress Manager created can be deleted from its own page (Hostinger deletes
  // it with its files and database; the same typed phrase as Websites created here).
  const selectedWebsite = selected ? createdWebsiteOf(selected, identity.aliases(selected.id), createdWebsites) : null;
  const deleteWebsite = async (site: WordPressManagedSite, website: HostingerTestSite) => {
    const phrase = `DELETE ${website.domain}`;
    const mainOf = sites.filter(local => isLocalWordPress(local) && local.sourceSiteId && identity.canonicalId(local.sourceSiteId) === identity.canonicalId(site.id));
    const warning = mainOf.length ? ` It is the main live site of ${mainOf.map(local => local.name).join(" and ")}; make another live site main first if the card should keep one.` : "";
    const typed = await dialogs.prompt({ title: `Delete ${website.domain}?`, description: `Hostinger permanently deletes the website with its files and database, and Zoer removes its connection. This cannot be undone.${warning}`, label: `Type ${phrase}`, submitLabel: "Delete website" });
    if (typed !== phrase) return;
    setBusy(`delete:${website.id}`); setError(null); setNotice(null);
    try {
      await api.deleteHostingerTestSite(website.connectionId, website.id, typed);
      // Off any card it was another live site on; the website itself is going.
      const deploy = deploys.find(item => identity.canonicalId(item.liveSiteId) === identity.canonicalId(site.id));
      if (deploy) await removeStackLive(deploy.liveSiteId).catch(() => undefined);
      setSelectedId(null);
      setNotice(`Hostinger is deleting ${website.domain}. It can take a few minutes to disappear from hPanel and this list.`);
      await Promise.all([deploymentsQuery.refetch(), load(true, true)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the website.");
    } finally {
      setBusy(null);
    }
  };
  const [deleteTarget, setDeleteTarget] = useState<WordPressManagedSite | null>(null);
  const removeSite = async (site: WordPressManagedSite) => {
    if (site.provider === "hostinger") {
      setError("Production sites must be removed through their hosting provider.");
      return;
    }
    if (site.provider === "kubernetes") { setError("Pilot removal requires operator review; its volumes are retained."); return; }
    if (site.provider === "ddev") { setDeleteTarget(site); return; }
    const description = "This stops the Playground site and moves it to Zoer trash. Its workspace remains recoverable until the trash retention period ends.";
    if (!await dialogs.confirm({ title: `Delete ${site.name}?`, description, confirmLabel: "Move to trash", tone: "danger" })) return;
    setBusy(`delete:${site.id}`);
    setError(null);
    setNotice(null);
    try {
      // Playground is a Docker profile without a runtime connector and keeps the workspace route.
      await write(() => api.destroyComputer(site.id));
      setSelectedId(null);
      setNotice(`${site.name} was moved to trash.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete this WordPress site.");
    } finally {
      setBusy(null);
    }
  };
  /** DDEV: S9 managed resources through the site.archive action (runtime:manage). Throws so the dialog can show why. */
  const trashDdevSite = async (site: WordPressManagedSite) => {
    setBusy(`delete:${site.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await write(() => runAction<{ summary: string }>("site.archive", { siteId: site.id }));
      setSelectedId(null);
      setNotice(`${site.name} was moved to trash.${result?.summary ? ` ${result.summary}` : ""}`);
    } finally {
      setBusy(null);
    }
  };
  const siteErased = async (site: WordPressManagedSite, result: { erased: string[]; warnings: string[] }) => {
    setSelectedId(null);
    setNotice(`${site.name} was deleted. Removed: ${result.erased.join("; ") || "the site"}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
    // The plugin's own link records are plugin data, so the host can't remove them.
    await forgetErasedSiteRecords(site.id).catch(() => undefined);
    void client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") });
    await load(true, true);
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
    const input = { siteId: selected.id, kind, operation, slugs };
    // A new plan replaces any earlier refusal, so the backup prompt never retries an older change.
    setRecoveryGate(null);
    try {
      const response = await api.planWordPressExtensionChange(input);
      setExtensionPlan({ input, plan: response.plan });
      setRecoveryGate(null);
      setConfirmation("");
    } catch (caught) {
      const gate = recoveryGateFrom(caught, hostingerRecordFor(selected, identity.aliases(selected.id)));
      if (gate) { setRecoveryGate({ gate, input }); return; }
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
      const gate = recoveryGateFrom(caught, selected ? hostingerRecordFor(selected, identity.aliases(selected.id)) : null);
      if (gate) { setRecoveryGate({ gate, input: extensionPlan.input }); setExtensionPlan(null); setConfirmation(""); return; }
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

  const [renameUnavailable, setRenameUnavailable] = useState(false);
  const renameConnection = async (connection: HostingerConnectionPublic, name: string) => {
    try {
      // Only the account list changes; skip write()'s full site-list rebuild so the field closes at once.
      await api.renameWordPressManagerConnection(connection.id, name);
      setNotice(`Renamed to ${name}.`);
    } catch (caught) {
      // Older Zoer hosts have no rename route; hide the control rather than fail every time.
      if (caught instanceof ApiError && (caught.status === 404 || caught.status === 405)) { setRenameUnavailable(true); throw new Error("This Zoer version can't rename accounts yet."); }
      throw caught;
    } finally {
      void connectionsQuery.refetch();
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
    // A "Hostinger + Zoer Connect" site may be showing its Connect record, which has no account.
    const hostinger = selected ? hostingerRecordFor(selected, identity.aliases(selected.id)) : null;
    if (!hostinger?.connectionId || !hostinger.domain) { setError("This site isn't linked to a Hostinger account in Zoer, so a recovery point can't be recorded for it."); return; }
    const label = await dialogs.prompt({ title: "Confirm Hostinger recovery point", description: "First create and verify a completed backup in hPanel. Zoer records your confirmation; it does not create the remote backup.", label: "Backup label", defaultValue: `hPanel backup before changes ${new Date().toLocaleDateString()}`, submitLabel: "Continue" });
    if (!label) return;
    if (!await dialogs.confirm({ title: "Was the hPanel backup verified?", description: "Only confirm after Hostinger shows the backup completed successfully and is restorable.", confirmLabel: "Yes, record recovery point" })) return;
    setBusy("recovery");
    try {
      const { connectionId, domain } = hostinger;
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

  /** Records the hPanel backup the person confirmed in the inline panel, then plans the refused change again. */
  const recordAndRetry = async (label: string) => {
    if (!recoveryGate?.gate.connectionId || !recoveryGate.gate.domain) return;
    const { gate, input } = recoveryGate;
    setBusy("recovery");
    setRecoveryGate({ ...recoveryGate, error: undefined });
    try {
      // Retry right away; the site details refresh in the background afterwards.
      const { recoveryPoint } = await api.recordWordPressRecoveryPoint({ connectionId: gate.connectionId!, domain: gate.domain!, label, confirmed: true });
      void client.invalidateQueries({ queryKey: wordpressKeys.all() });
      if (recoveryPoint?.id) await commitCatalog({ records: [recoveryPointRecord(recoveryPoint)] }, "recovery-point").then(() => client.invalidateQueries({ queryKey: engineKeys.catalog("recovery-point") })).catch(() => undefined);
      setRecoveryGate(null);
      setNotice("Backup recorded. Review the change below.");
    } catch (caught) {
      setRecoveryGate({ gate, input, error: caught instanceof Error ? caught.message : "Unable to record the backup." });
      return;
    } finally {
      setBusy(null);
    }
    await planExtension(input.kind, input.operation, input.slugs);
  };

  const createPortableBackup = async () => {
    if (!selected || !["ddev", "kubernetes"].includes(selected.provider)) return;
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

  // Renames show at once: the cached list and details take the new name, the dialog closes, and
  // the list refreshes in the background. A failed save puts the old name back.
  const renameInCache = (id: string, change: (site: WordPressManagedSite) => WordPressManagedSite) => {
    for (const key of [wordpressQueries.sites().queryKey, wordpressQueries.securitySites().queryKey]) {
      client.setQueryData<WordPressManagedSite[]>(key, list => list?.map(site => site.id === id ? change(site) : site));
    }
    client.setQueriesData<WordPressSiteDetails>({ queryKey: [...wordpressKeys.all(), "site", id] }, data => data ? { ...data, site: change(data.site) } : data);
  };
  const saveSiteName = async () => {
    if (!editSite || !isLocalWordPress(editSite)) return;
    const site = editSite, name = editName.trim(), previous = site.name;
    if (name === previous) { setEditSite(null); return; }
    setEditError(null); setError(null);
    await client.cancelQueries({ queryKey: wordpressKeys.all() });
    renameInCache(site.id, current => ({ ...current, name }));
    setEditSite(null);
    setNotice(`Renamed to ${name}. The development URL and WordPress title stayed the same.`);
    try {
      const saved = await api.renameLocalWordPressSite(site.id, name);
      renameInCache(site.id, current => saved.site ? { ...current, ...saved.site } : { ...current, name: saved.name, managedUrl: saved.managedUrl ?? current.managedUrl });
    } catch (caught) {
      renameInCache(site.id, current => ({ ...current, name: previous }));
      setNotice(null);
      setError(caught instanceof Error ? `${previous} wasn't renamed: ${caught.message}` : `${previous} wasn't renamed.`);
    } finally {
      void client.invalidateQueries({ queryKey: wordpressKeys.all() });
    }
  };

  const headerActions = [
    { label: "Connect existing site", icon: <Link2 className="h-4 w-4" />, onClick: () => setAddSiteOpen(true) },
    { label: "Provider accounts", icon: <Cloud className="h-4 w-4" />, onClick: () => setProvidersOpen(true) },
    { label: "Trash", icon: <Trash2 className="h-4 w-4" />, onClick: () => setTrashOpen(true) },
    { label: "Refresh", iconOnly: true, tooltip: checkedAt ? `Last checked ${checkedAt}` : undefined, icon: <RefreshCw className="h-4 w-4" />, loading: busy === "refresh", disabled: busy !== null, onClick: () => void refreshAll() },
  ];
  const newSiteButton = <div className="flex flex-wrap gap-2"><Btn size="sm" onClick={() => setPilotOpen(true)}>Kubernetes pilot</Btn><Btn variant="primary" aria-label="New site" icon={<Plus className="h-4 w-4" />} onClick={() => { setCreateMode("blank"); setCreateOpen(true); }}>New site</Btn></div>;
  // Create a live site: plans continue (link + push) while this page is open.
  useGoLiveOrchestrator(sites);
  const goLivePlans = useGoLivePlans();
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
    ...(previewUrl ? [{ label: "Open site in a new tab", icon: <ExternalLink className="h-4 w-4" />, onClick: () => void openSiteLink(selected) }] : []),
    // Phones have no grouped cards, so comparing with the linked live site or local copy lives here too.
    ...(selectedSource ? [{ label: `Compare with ${selectedSource.name}`, icon: <ArrowLeftRight className="h-4 w-4" />, onClick: () => setCompare({ live: selectedSource, local: selected }) }] : []),
    ...selectedCopies.map(copy => ({ label: selectedCopies.length === 1 ? "Compare with local copy" : `Compare with ${copy.name}`, icon: <ArrowLeftRight className="h-4 w-4" />, onClick: () => setCompare({ live: selected, local: copy }) })),
    ...(isLocalWordPress(selected) && !lifecycle ? [{ label: "Refresh site status", icon: <RefreshCw className="h-4 w-4" />, disabled: busy !== null, onClick: () => void refreshAll() }] : []),
    { label: "Site name & URL", icon: <Pencil className="h-4 w-4" />, onClick: () => { setEditSite(selected); setEditName(selected.name); setEditError(null); } },
    ...(lifecycle === "stop" ? [{ label: "Stop site", icon: <Square className="h-4 w-4" />, disabled: busy !== null || transferWriting, onClick: () => void changeLifecycle(selected) }] : []),
    ...(selectedWebsite ? [{ label: "Delete this website", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, loading: busy === `delete:${selectedWebsite.id}`, disabled: busy !== null || transferWriting, onClick: () => void deleteWebsite(selected, selectedWebsite) }] : []),
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
  const goLivePlan = selected ? goLivePlans.find(plan => plan.sourceSiteId === selected.id) ?? null : null;
  const goLiveState = goLivePlan ? goLiveStage(goLivePlan, hostingerTestSites(deploymentsQuery.data ?? []).find(site => site.id === goLivePlan.deploymentId)) : null;
  // Local and live: the same card on Overview and on Publish, so pushing and pulling have one place.
  const syncCard = selected && ["ddev", "kubernetes", "hostinger", "zoer-connect"].includes(selected.provider) ? <SiteSyncCard site={selected} live={selectedSource} copies={[...selectedCopies, ...selectedDeployedFrom]} onSelect={selectSite}
    // From a live site's card, pushing goes to that live site; from a local site's, to its main live site.
    onPush={local => pushFromTo(local, isLocalWordPress(selected) ? null : identity.connector(selected).id)}
    otherLives={selectedOtherLives} accountOf={accountName} onPushTo={(local, live) => pushFromTo(local, identity.connector(live).id)}
    onMakeMain={isLocalWordPress(selected) ? live => { const record = deployOf(live); if (record) void changeStack(() => makeMainLive(selected, record.liveSiteId, selectedSource ? identity.connector(selectedSource).id : null), `${live.name} at ${siteDomain(live)} is now the main live site of ${selected.name}.`); } : undefined}
    onRemoveLive={live => { const record = deployOf(live); if (record) void changeStack(() => removeStackLive(record.liveSiteId), `${siteDomain(live)} is no longer on this card. The website was not changed.`); }} onRefresh={(local, live) => setPullInto({ local, live })} onCompare={(live, local) => setCompare({ live, local })} paused={transferWriting}
    onGoLive={connections.length && ["ddev", "kubernetes"].includes(selected.provider) ? () => setGoLiveFor(selected) : undefined} goLive={goLivePlan && (!selectedSource || (!goLivePlan.pushRunId && !goLivePlan.error)) ? goLiveState : null}
    onLink={isLocalWordPress(selected) ? () => setLinkRequest({ mode: "source", local: selected, current: selectedSource }) : undefined}
    siteIds={site => identity.aliases(site.id).map(alias => alias.id)}
    onAddCopy={!isLocalWordPress(selected) ? () => setLinkRequest({ mode: "copy", source: selected, copies: selectedCopies }) : undefined}
    makeCopy={<Btn size="sm" onClick={() => setPullInto({ local: null, live: selected })}>{selectedCopies.length ? "Make another local copy" : "Make a local copy"}</Btn>} /> : null;
  const scopeSelect = (className: string, short = false) => <label className={className}><span className="sr-only">Show sites</span><Select aria-label="Show WordPress sites" presentation="dropdown" searchable={false} value={scope} onChange={event => {
    const value = event.target.value;
    if (value.startsWith("account:")) { setSiteAccount(value.slice("account:".length)); return; }
    setSiteAccount(null); setSiteScope(value as "all" | "local");
  }} className={selectClass("compact", "w-full")}><option value="all">{short ? "All" : "All sites"}</option><option value="local">{short ? "Local" : "Local only"}</option>{connections.map(item => <option key={item.id} value={`account:${item.id}`}>{item.name}</option>)}</Select></label>;

  return (
    <ProblemContext.Provider value={problemOf}><AccountContext.Provider value={accountName}>
    <PluginPage title={page} badge={pickerSites.length || undefined} fill actions={headerActions} primary={newSiteButton}>
    <section className="flex min-h-0 flex-1 flex-col" aria-label="WordPress Sites manager">
      {pilotOpen && <WordPressKubernetesPilot onClose={() => setPilotOpen(false)} />}
      <WordPressAddSite open={addSiteOpen} onOpenChange={setAddSiteOpen} existingUrls={sites.flatMap(site => [site.url, site.managedUrl, site.provider === "hostinger" && site.domain ? `https://${site.domain}` : null].filter((value): value is string => Boolean(value)))} onAdded={async (endpoint, verified = true) => {
        await rememberConnectedWordPressSite(client, endpoint);
        setSiteQuery(""); setSiteScope("all"); setSiteAccount(null); setSelectedId(endpoint.id); setDevelopingPlugin(null); setTab("overview");
        setNotice(verified ? "Website connected." : "Connection saved. Its source check needs attention.");
        void load(true, true);
      }} />
      {trashOpen && <WordPressTrash onClose={() => setTrashOpen(false)} onChanged={async (restoredId) => { await load(true, true); if (restoredId) { setSelectedId(restoredId); setTab("overview"); } }} />}

      {(error || readError || notice || blockedLink) && <div className="space-y-2 px-3 pt-3 sm:px-4">
        {(error || readError) && <div role="alert" className="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-[13px] text-status-error">{error || readError}</div>}
        {notice && <div role="status" className="rounded-md border border-status-success/25 bg-status-success/10 px-3 py-2 text-[13px] text-status-success">{notice}</div>}
        {blockedLink && <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning">
          <span>{blockedLink.name} is running, but the browser blocked the new tab. Allow pop-ups for this site, or open it here:</span>
          <a className="underline underline-offset-2" href={blockedLink.url} target="_blank" rel="noreferrer" onClick={() => setBlockedLink(null)}>{blockedLink.url.replace(/^https?:\/\//, "")}</a>
          <button type="button" className="ml-auto text-xs underline" onClick={() => setBlockedLink(null)}>Dismiss</button>
        </div>}
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
        <Btn variant="primary" icon={<Plus className="h-3.5 w-3.5" />} loading={busy === `create:${runtime}`} disabled={!workspaceName.trim() || busy !== null || (runtime === "ddev" && !ddevConnector?.active)} onClick={() => void createWorkspace(runtime)}>{runtime === "ddev" ? "Create DDEV site" : "Create Playground"}</Btn>
      </div> : undefined}>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="How to start the WordPress site">
        {([["blank", "Blank local site", "Playground or DDEV, for building and testing."], ["backup", "Restore from backup", "UpdraftPlus or Hostinger backup into a local site."], ["hostinger", "Hostinger website", connections.length ? "Live, on a free temporary domain, with Zoer Connect." : "Needs a Hostinger account in Provider accounts."]] as const).map(([mode, title, detail]) =>
          <button key={mode} type="button" aria-pressed={createMode === mode} disabled={restoreRunning || busy !== null} onClick={() => setCreateMode(mode)} className={`min-h-16 rounded-lg border p-3 text-left text-sm ${createMode === mode ? "border-accent bg-accent-subtle text-text-primary" : "border-border-default text-text-secondary hover:bg-surface-hover"}`}><span className="block font-medium">{title}</span><span className="mt-1 block text-xs">{detail}</span></button>)}
      </div>
      {createMode === "blank" ? <section aria-labelledby="wordpress-create-workspace" className="space-y-3 rounded-lg border border-border-default bg-surface-secondary/60 p-3 sm:p-4">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend id="wordpress-create-workspace" className="mb-1.5 text-[12px] font-medium text-text-primary">Runtime</legend>
          {([["ddev", "DDEV", "Full development: Push to live, Pull from live, plugins, backups and security scans."], ["playground", "Playground", "A quick WordPress in the browser for experiments. Not a Push to live source."]] as const).map(([value, title, detail]) =>
            <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-subtle border-border-muted ${value === "ddev" && !ddevConnector?.active ? "cursor-not-allowed opacity-50" : ""}`}>
              <input type="radio" className="mt-1" name="wordpress-create-runtime" checked={runtime === value} disabled={busy !== null || (value === "ddev" && !ddevConnector?.active)} onChange={() => setBlankRuntime(value)} />
              <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-text-secondary">{detail}</span></span>
            </label>)}
        </fieldset>
        {!ddevConnector?.active && (
          <p className="break-words text-[13px] leading-4 text-status-warning">{ddevConnector?.unavailableReason || "The DDEV connector is not available. Configure it in Extensions."}</p>
        )}
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12px] font-medium text-text-primary">Name</span>
          <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className={controlClass()} placeholder="WordPress workspace" />
        </label>
        <p className="text-[12px] leading-5 text-text-secondary">The site stays until you move it to trash. To put it online later, open it and use <strong>Create a live site</strong>.</p>
      </section> : createMode === "hostinger" ? (connections.length
        ? <HostingerWebsiteSetup newSite connections={connections} onCreated={() => void load(true, true)} intro={<p className="text-[12px] leading-5 text-text-secondary">A new, empty WordPress website on a free temporary domain. Hostinger creates it, then Zoer installs and pairs <strong>Zoer Connect</strong> so you can push to it and pull from it. About 5 to 15 minutes; it keeps going if you close this window. To put a local site you already have on a new Hostinger website, open that site and use <strong>Create a live site</strong> (or <strong>Deploy to a new Hostinger website</strong> when it has one) under Local and live.</p>} />
        : <section className="space-y-3 rounded-lg border border-border-default p-4 text-sm"><p>Connect a Hostinger account first. Zoer then creates websites on its hosting plan with a free temporary domain and Zoer Connect installed.</p><Btn onClick={() => { setCreateOpen(false); setProvidersOpen(true); }}>Open Provider accounts</Btn></section>)
      : <WordPressUpdraftImport ddevAvailable={!!ddevConnector?.active} kubernetesAvailable={runtimeConnectors.some(c => c.id === "wordpress-kubernetes" && c.active)} ddevUnavailableReason={ddevConnector?.unavailableReason} onRunningChange={setRestoreRunning} />}

      </Modal>}

      {/* Fills the remaining height: the site list and the site panel scroll independently (SidebarLayout shape). */}
      <div className="flex min-h-0 flex-1">
        <aside aria-label="WordPress sites" className="hidden w-[280px] shrink-0 flex-col border-r border-border-default p-3 lg:flex">
          <div className="flex gap-2"><SearchInput className="min-w-0 flex-1" value={siteQuery} onChange={setSiteQuery} placeholder="Search sites" />{scopeSelect("w-28 shrink-0")}</div>
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {visibleGroups.map((group) => group.kind === "pair"
              ? <SitePairCard key={`pair:${group.id}`} onAddCopy={() => setLinkRequest({ mode: "copy", source: group.source, copies: group.copies })} source={group.source} name={groupNames.get(identity.canonicalId(group.id)) ?? null} onRename={() => void renameCard(identity.canonicalId(group.id), groupNames.get(identity.canonicalId(group.id)) ?? group.source.name, group.source.name)} lives={group.lives} copies={group.copies} selectedId={selected?.id ?? null} onSelect={selectSite} onSeparate={() => setPairSeparated(group.id, true)} onOpen={site => void openSiteLink(site)} onPull={(local, live) => setPullInto({ local, live })} onPush={(local, live) => pushFromTo(local, live ? identity.connector(live).id : null)} onCompare={(live, local) => setCompare({ live, local })} paused={pairWriting([group.source, ...group.lives, ...group.copies])} />
              : <SiteCard key={group.site.id} site={group.site} selected={selected?.id === group.site.id} onSelect={selectSite} mergeInto={(() => {
                  // A separated copy, or a live site with separated copies, offers to merge again.
                  const source = wordPressSiteSource(sites, group.site, separatedConnections);
                  if (source) return identity.aliases(source.id).some(alias => separatedPairs.has(alias.id)) ? source : null;
                  return identity.aliases(group.site.id).some(alias => separatedPairs.has(alias.id)) && wordPressSiteCopies(sites, group.site, separatedConnections).length ? group.site : null;
                })()} onMerge={(source) => setPairSeparated(source.id, false)} />)}
            {!visibleGroups.length && <EmptyState icon={<Globe2 />} title={siteQuery ? "No matches" : scope === "local" ? "No local sites" : scope !== "all" ? "No sites on this account" : "No sites yet"} description={siteQuery ? undefined : "Create a local site or connect one."} />}
          </div>
        </aside>

        {/* Phones and tablets scroll this whole column (the header scrolls away, the section picker
            stays); desktops keep the header fixed and scroll only the section. */}
        <div ref={pageScroll} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
          {/* Phones: the site list is a picker, grouped like the desktop list, with the scope filter beside it. */}
          <div className="flex items-center gap-2 px-3 pt-3 lg:hidden">
            <label className="min-w-0 flex-1"><span className="sr-only">Site</span><Select searchable aria-label="Select WordPress site" optionDetails={siteOptions(pickerOrder, identity.aliases, pickerCopyOf, accountName)} value={selectedSummary?.id || ""} onChange={e => { setExtensionPlan(null); setDevelopingPlugin(null); setSelectedId(e.target.value); setTab("overview"); }} className={selectClass("compact")}><option value="" disabled>Select a site</option>{pickerOrder.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</Select></label>
            {scopeSelect("w-[5.5rem] shrink-0", true)}
          </div>
          <div className="shrink-0 px-3 py-3 sm:px-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <h2 className="truncate text-[15px] font-semibold text-text-heading">{selected?.name || "No site selected"}</h2>
                  {selected && isLocalWordPress(selected) && <button type="button" aria-label={`Rename ${selected.name}`} title="Rename" onClick={() => { setEditSite(selected); setEditName(selected.name); setEditError(null); }} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-focus sm:h-7 sm:w-7"><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                </div>
                {selected ? <>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-secondary">
                    <span className="inline-flex items-center gap-1.5">{providerIcon(selected.provider)}{connectionsCombined ? "Live · Hostinger + Zoer Connect" : siteLocation(selected)}</span>
                    {accountName(selected) && <span className="inline-flex items-center gap-1 text-[12px]"><Cloud className="h-3.5 w-3.5" aria-hidden="true" />Account: {accountName(selected)}</span>}
                    <span role="status" className="inline-flex items-center gap-2">
                      {(() => { const problem = updating ? null : problemOf(selected); return <StatusBadge tone={updating ? "info" : problem ? (problem.kind === "unreachable" ? "error" : "warning") : statusTone(selected.status)} icon={updating ? <Loader2 className="animate-spin" /> : undefined}>{updating ? "Updating" : problem ? problemLabel(problem) : statusLabel(selected.status)}</StatusBadge>; })()}
                      {lifecycle === "start" && !updating && <span className="text-[12px] text-text-muted">Start to inspect.</span>}
                    </span>
                    <a className="inline-flex min-h-8 min-w-0 max-w-full items-center truncate text-[12px] underline underline-offset-2 hover:text-text-primary sm:min-h-0" href={wordpressPreviewUrl(selected) || undefined} target="_blank" rel="noreferrer" onClick={event => { if (lifecycle !== "start") return; event.preventDefault(); void openSiteLink(selected); }}>{siteDomain(selected)}</a>
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
            {pendingAccounts.map(account => <PendingHostingerAccount key={account.id} account={account} busy={busy} onLoad={async () => { setBusy(`adopt:${account.id}`); setError(null); try { await api.adoptHostingerOAuthConnection(account.id); setNotice("Hostinger websites loaded."); await load(true, true); void connectionsQuery.refetch(); void hostAccounts.refetch(); } finally { setBusy(null); } }} onDismiss={() => setDismissedAccounts(current => { const next = new Set(current).add(account.id); writeDismissedAccounts(next); return next; })} />)}
            {hostingConnections.filter(connection => !connectionHealth(connection).ok).map(connection => <div key={connection.id} role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning"><span className="min-w-0 break-words">Hostinger account “{connection.name}” needs reconnecting. Zoer cannot clear its cache or manage this site until then.{connection.lastError ? ` Last error: ${connection.lastError}` : ""}</span><HostingerReconnect connection={connection} onDone={message => { setNotice(message); void connectionsQuery.refetch(); }} /></div>)}
            {detailError && (isTransferFence(detailError)
              ? <div role="status" className="mb-3 text-sm text-status-warning">{TRANSFER_FENCE_NOTICE} <Btn size="sm" onClick={() => selected && void loadDetails(selected.id)}>Retry section</Btn></div>
              : <div role="alert" className="mb-3 text-sm text-status-error">{detailError} <Btn size="sm" onClick={() => selected && void loadDetails(selected.id)}>Retry section</Btn></div>)}
            {section === "development" ? <div className="min-w-0 space-y-6">{selected && ["hostinger", "zoer-connect"].includes(selected.provider) ? <LiveSiteDevelopment site={selected} copies={selectedCopies} onSelect={copy => { selectSite(copy); setTab("development"); }} onMakeCopy={() => setPullInto({ local: null, live: selected })} /> : <WordPressRepositoryDevelopment />}{selected && <SiteStackPanel site={selected} />}</div>
            : section === "history" ? (selected ? <SiteActivity key={selected.id} site={selected} transferSiteIds={transferSiteIds} siteIds={selected ? [selected.id, ...connectionMembers.map(member => member.id)] : []} sites={sites} canonicalId={identity.canonicalId} deployments={siteDeployments} loading={deploymentsQuery.isFetching} error={deploymentsQuery.error?.message || deploymentRecords.error?.message} onRefresh={() => { void deploymentsQuery.refetch(); void deploymentRecords.refetch(); }} busy={busy} onVerify={confirmDeployment} /> : <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Select a WordPress site" />)
            : detailLoading && section !== "overview" ? <div className="flex min-h-52 items-center justify-center text-[12px] text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Inspecting site…</div> : (
              <>
                {section === "overview" && <OverviewTab onStart={selected && lifecycle === "start" ? () => void changeLifecycle(selected) : undefined} problem={selected && problemOf(selected) ? <ConnectionProblemCard key={`problem:${connectSite?.id}`} site={selected} connectorId={connectSite!.id} hostingerId={identity.aliases(selected.id).find(alias => alias.provider === "hostinger")?.id ?? null} problem={problemOf(selected)!} copies={selectedCopies} checking={health.checking} onRecheck={() => void health.recheck()} onMoveCopies={() => setLinkRequest({ mode: "move", from: selected, copies: selectedCopies })} onReplaceKey={() => setReplaceKeyFor(selected)} onRemoved={() => { const gone = new Set(identity.aliases(selected.id).map(alias => alias.id)); setSelectedId(identity.aliases(selected.id).find(alias => alias.provider === "hostinger")?.id ?? scopedSites.find(site => !gone.has(site.id))?.id ?? null); setTab("overview"); void load(true, true); void health.recheck(); }} /> : null} site={selected} connectSite={connectSite} details={selectedDetails} loading={detailLoading} onSetup={()=>selected && void openSite(selected,true)} onRestore={openBackupImport} onReconnect={() => setProvidersOpen(true)} publicEndpoint={siteEndpoints.data?.endpoints.find(endpoint => endpoint.id === (connectSite?.id ?? selected?.id)) ?? null} onCaching={selected && siteSections.some(item => item.id === "caching") ? () => setTab("caching") : undefined}
                  sync={syncCard} />}
                {connectionMembers.length > 1 && section === "overview" && <section aria-label="Website connections" className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border-muted pt-3 text-[13px]"><p className="text-text-secondary">{connectionsCombined ? "This page combines the site's Hostinger hosting and its Zoer Connect transfers." : "Hostinger and Zoer Connect have the same website address."}</p><Btn size="sm" variant="ghost" onClick={toggleConnections}>{connectionsCombined ? "Show them separately" : "Combine them"}</Btn></section>}
                {section === "plugins" && selected?.provider === "hostinger" && <RecoveryPointStatus until={recoveryPointValidUntil(recoveryPointsFor([...(selectedDetails?.recoveryPoints ?? []), ...recoveryPoints], selected))} onBackups={() => setTab("backups")} />}
                {section === "plugins" && recoveryGate && recoveryGate.input.siteId === selected?.id && <div className="mb-3"><RecoveryPointPanel gate={recoveryGate.gate} action={`${wordpressExtensionActionLabel(recoveryGate.input.operation)} ${recoveryGate.input.slugs.length > 1 ? `${recoveryGate.input.slugs.length} ${recoveryGate.input.kind}s` : (() => { const slug = recoveryGate.input.slugs[0] ?? ""; const row = [...(selectedDetails?.plugins ?? []), ...(selectedDetails?.themes ?? [])].find(entry => entry.slug === slug); return row ? extensionDisplayName(row.name, row.slug) : slug; })()}`} busy={busy === "recovery"} error={recoveryGate.error} onRecord={label => void recordAndRetry(label)} onDismiss={() => setRecoveryGate(null)} /></div>}
                {section === "plugins" && <ExtensionsTab key={tab === "themes" ? "theme" : "plugin"} developingPlugin={developingPlugin} onDevelop={tab === "themes" ? undefined : setDevelopingPlugin} kind={tab === "themes" ? "theme" : "plugin"} onKind={kind => setTab(kind === "theme" ? "themes" : "plugins")} onSecurity={selected?.provider === "ddev" ? () => setTab("security") : undefined} paused={transferWriting} site={selected} connectSiteId={connectSite?.id} connectConnected={connectSite?.provider === "zoer-connect" && connectSite.status === "connected"} rows={(tab === "themes" ? selectedDetails?.themes : selectedDetails?.plugins) || []} query={extensionQuery} setQuery={setExtensionQuery} slug={extensionSlug} setSlug={setExtensionSlug} directoryResults={directoryResults} busy={busy} error={error} onSearch={searchDirectory} onPlan={planExtension} />}
                {section === "caching" && <CachingTab site={selected} hostinger={selected ? identity.aliases(selected.id).find(alias => alias.provider === "hostinger") ?? (selected.provider === "hostinger" ? selected : null) : null} publicEndpoint={siteEndpoints.data?.endpoints.find(endpoint => endpoint.id === (connectSite?.id ?? selected?.id)) ?? null} onReconnect={() => setProvidersOpen(true)} />}
                {section === "security" && selected && <WordPressSecurity key={selected.id} site={selected} onStart={() => void changeLifecycle(selected)} />}
                {section === "backups" && connectSite?.provider === "zoer-connect" && <div className="mb-5"><PluginPulls key={connectSite.id} siteId={connectSite.id} siteName={selected?.name ?? connectSite.name} /></div>}
                {section === "backups" && <BackupsTab site={selected} details={selectedDetails} recoveryPoints={selected ? recoveryPointsFor([...(selectedDetails?.recoveryPoints ?? []), ...recoveryPoints], selected) : []} busy={busy} paused={transferWriting} retainPortableBackup={retainPortableBackup} onRetainPortableBackup={setRetainPortableBackup} onCreatePortableBackup={createPortableBackup} onRecordRecovery={recordRecovery} onImportBackup={openBackupImport} />}
                {section === "deployments" && selected && !["ddev", "kubernetes"].includes(selected.provider) && <LiveTransferTab site={selected} connectSite={connectSite?.provider === "zoer-connect" ? connectSite : null} sync={syncCard} hostingerPublish={selected.provider === "hostinger" || connectionsCombined ? <DeploymentsTab sites={sites} fixedSource={null} connections={connections} source={publishSource} setSource={setPublishSource} connection={publishConnection} setConnection={setPublishConnection} domain={publishDomain} setDomain={setPublishDomain} mode={publishMode} setMode={setPublishMode} busy={busy} onPlan={planPublish} onImport={() => setTab("backups")} compact /> : null} onActivity={() => setTab("history")} />}
                {section === "deployments" && selected && ["ddev", "kubernetes"].includes(selected.provider) && <DeploymentsTab sync={syncCard} paused={transferWriting} sites={sites} fixedSource={selected.capabilities.deploySource ? selected : null} connections={connections} source={publishSource} setSource={setPublishSource} connection={publishConnection} setConnection={setPublishConnection} domain={publishDomain} setDomain={setPublishDomain} mode={publishMode} setMode={setPublishMode} busy={busy} onPlan={planPublish} onImport={() => setTab("backups")} onActivity={() => setTab("history")} />}
                {section === "deployments" && selected?.provider === "ddev" && <StaticWebsiteExport key={selected.id} site={selected} paused={transferWriting} />}
              </>
            )}
          </PageTabPanel>
          </div>
        </div>
      </div>

      {pushFrom && <PushToLiveDialog key={`${pushFrom.id}:${pushTo ?? ""}`} destinationId={pushTo} stack={pushStack(pushFrom)} accountOf={destinationAccount} source={sites.find(site => site.id === pushFrom.id) ?? pushFrom} onStartSource={() => void changeLifecycle(sites.find(site => site.id === pushFrom.id) ?? pushFrom)} sites={sites} onClose={() => setPushFrom(null)} onHosting={pushFrom.capabilities.deploySource && connections.length ? () => { openPublish(pushFrom); setPushFrom(null); } : undefined} />}
      {goLiveFor && <GoLiveDialog key={goLiveFor.id} source={sites.find(site => site.id === goLiveFor.id) ?? goLiveFor} live={wordPressSiteSource(sites, sites.find(site => site.id === goLiveFor.id) ?? goLiveFor, separatedConnections)} connections={connections} onClose={() => setGoLiveFor(null)} onStartSource={() => void changeLifecycle(sites.find(site => site.id === goLiveFor.id) ?? goLiveFor)} />}
      {compare && <SiteCompareDialog key={`${compare.live.id}:${compare.local.id}`} live={sites.find(site => site.id === compare.live.id) ?? compare.live} local={sites.find(site => site.id === compare.local.id) ?? compare.local} onClose={() => setCompare(null)} onStartSite={site => void changeLifecycle(site)} onReviewFiles={local => { setCompare(null); setPushFrom(local); }} />}
      {pullInto && (() => {
        const live = identity.connector(pullInto.live) ?? pullInto.live;
        const endpoint = siteEndpoints.data?.endpoints.find(item => item.id === live.id);
        // copy.local needs the live site's Zoer Connect endpoint (a DDEV test source can have one too).
        // Without one, the Zoer Connect setup dialog explains how to connect or restore a backup instead.
        if (!["zoer-connect", "ddev", "kubernetes"].includes(live.provider) && !endpoint) return <WordPressConnect key={`setup:${live.id}`} autoOpen localCopy siteId={live.id} siteName={pullInto.live.name} hostinger={pullInto.live.provider === "hostinger"} onConnected={() => void load(true, true)} onSetup={pullInto.live.provider === "hostinger" ? () => void openSite(pullInto.live, true) : undefined} onRestore={openBackupImport} onDismiss={() => setPullInto(null)} />;
        return <Modal mobileSheet title={`Pull from ${pullInto.live.name}`} onClose={() => setPullInto(null)}>
          <PluginLocalCopy key={`${live.id}:${pullInto.local?.id ?? "new"}`} siteId={live.id} siteName={pullInto.live.name} sourceUrl={endpoint?.origin ?? live.url} refreshSiteId={pullInto.local?.id ?? null} heading={false} />
        </Modal>;
      })()}
      {deleteTarget && <DeleteSiteDialog site={deleteTarget} onClose={() => setDeleteTarget(null)} onTrash={() => trashDdevSite(deleteTarget)} onErased={result => void siteErased(deleteTarget, result)} />}
      {providersOpen && <Modal title="Provider accounts" onClose={() => setProvidersOpen(false)}><ConnectionsTab onNewWebsite={() => { setProvidersOpen(false); setCreateMode("hostinger"); setCreateOpen(true); }} onConnected={() => void load(true, true)} connections={connections} name={connectionName} setName={setConnectionName} token={connectionToken} setToken={setConnectionToken} busy={busy} onAdd={addConnection} onTest={testConnection} onRemove={removeConnection} onRename={renameConnection} renameUnavailable={renameUnavailable} /></Modal>}
      {extensionPlan && <ReviewPanel title={`${wordpressExtensionActionLabel(extensionPlan.plan.operation)} ${extensionPlan.plan.kind}${extensionPlan.plan.slugs.length > 1 ? "s" : ""}`} plan={extensionPlan.plan} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy === "apply-extension"} onApply={applyExtension} onCancel={() => { setExtensionPlan(null); setConfirmation(""); }} />}
      {publishPlan && <ReviewPanel title={`${publishPlan.mode === "replace" ? "Replace" : "Publish"} ${publishPlan.domain}`} plan={publishPlan} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy === "execute-publish"} onApply={executePublish} onCancel={() => { setPublishPlan(null); setConfirmation(""); }} />}
      {linkRequest && <LinkSiteDialog request={linkRequest} sites={identity.sites} sourceOf={site => wordPressSiteSource(sites, site, separatedConnections)} onClose={() => setLinkRequest(null)} />}
      {replaceKeyFor && <WordPressConnect key={`replace:${replaceKeyFor.id}`} autoOpen siteId={identity.connector(replaceKeyFor).id} siteName={replaceKeyFor.name} onDismiss={() => { setReplaceKeyFor(null); void health.recheck(); }} />}
    </section>
    </PluginPage>
    </AccountContext.Provider></ProblemContext.Provider>
  );
}

function SiteBadges({ site }: { site: WordPressManagedSite }) {
  if (!site.updates && !site.vulnerabilities) return null;
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{site.updates ? <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[12px] text-status-warning">{site.updates} {site.updates === 1 ? "update" : "updates"}</span> : null}{site.vulnerabilities ? <span className="rounded bg-status-error/10 px-1.5 py-0.5 text-[12px] text-status-error">{site.vulnerabilities} {site.vulnerabilities === 1 ? "risk" : "risks"}</span> : null}</div>;
}

/** Healthy sites get a quiet dot; any other state keeps its label so it stands out. */
function SiteStatus({ status, site }: { status: string; site?: WordPressManagedSite }) {
  const lookup = useContext(ProblemContext);
  const problem = site ? lookup(site) : null;
  if (site && problem) return <StatusBadge tone={problem.kind === "unreachable" ? "error" : "warning"}>{problemLabel(problem)}</StatusBadge>;
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
        <SiteStatus status={site.status} site={site} />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary"><SiteAccount site={site} /><span className="truncate">{siteLocation(site)} · {siteHost(site)}</span></div>
      <SiteBadges site={site} />
    </button>
    {mergeInto && <div className="flex justify-end border-t border-border-muted/60 px-1.5 py-1">
      <button type="button" title={mergeInto.id === site.id ? "Show this site and its local copies as one card" : `Show this local copy on the ${mergeInto.name} card`} onClick={() => onMerge(mergeInto)} className={pairControlClass}><Link2 className="h-3 w-3" aria-hidden="true" />{mergeInto.id === site.id ? "Merge with local copies" : "Merge with live site"}</button>
    </div>}
  </div>;
}

/** One card for a live site and the local copies made from it; each environment is its own row. */
function SitePairCard({ source, name = null, onRename, lives = [], copies, selectedId, onSelect, onSeparate, onAddCopy, onOpen, onPull, onPush, onCompare, paused = false }: {
  source: WordPressManagedSite; /** The card's own name, when renamed. */ name?: string | null; /** Rename card. */ onRename?: () => void; /** Other live sites the copies were deployed to. */ lives?: WordPressManagedSite[]; copies: WordPressManagedSite[]; selectedId: string | null; onSelect: (site: WordPressManagedSite) => void; onSeparate: () => void; /** Adds an existing local site to this card. */ onAddCopy: () => void;
  onOpen: (site: WordPressManagedSite) => void; onPull: (local: WordPressManagedSite, live: WordPressManagedSite) => void; /** Push to live from `local`, to `live` when not the main live site. */ onPush: (local: WordPressManagedSite, live?: WordPressManagedSite) => void;
  onCompare: (live: WordPressManagedSite, local: WordPressManagedSite) => void; /** A transfer is writing to the selected site. */ paused?: boolean;
}) {
  const members = [source, ...lives, ...copies];
  const active = members.some((site) => site.id === selectedId);
  // With several copies each copy's actions name it; with one, "local site" is enough.
  const named = (copy: WordPressManagedSite, single: string, many: string) => copies.length === 1 ? single : `${many} ${copy.name}`;
  const menu = [
    ...(source.capabilities.preview && wordpressPreviewUrl(source) ? [{ label: "Open live site", icon: <ExternalLink className="h-4 w-4" />, onClick: () => onOpen(source) }] : []),
    ...copies.filter(copy => copy.capabilities.preview && wordpressPreviewUrl(copy)).map(copy => ({ label: named(copy, "Open local site", "Open"), icon: <ExternalLink className="h-4 w-4" />, onClick: () => onOpen(copy) })),
    ...copies.map(copy => ({ label: named(copy, "Compare sites", "Compare with"), icon: <ArrowLeftRight className="h-4 w-4" />, onClick: () => onCompare(source, copy) })),
    ...copies.map(copy => ({ label: named(copy, "Pull from live", "Pull from live into"), icon: <HardDriveDownload className="h-4 w-4" />, disabled: paused, onClick: () => onPull(copy, source) })),
    ...copies.map(copy => ({ label: named(copy, "Push to live", "Push to live from"), icon: <Rocket className="h-4 w-4" />, disabled: paused, onClick: () => onPush(copy) })),
    ...lives.filter(live => live.capabilities.preview && wordpressPreviewUrl(live)).map(live => ({ label: `Open ${siteHost(live)}`, icon: <ExternalLink className="h-4 w-4" />, onClick: () => onOpen(live) })),
    ...(copies.length === 1 ? lives.map(live => ({ label: `Push to ${siteHost(live)}`, icon: <Rocket className="h-4 w-4" />, disabled: paused, onClick: () => onPush(copies[0]!, live) })) : []),
    ...(onRename ? [{ label: "Rename card", icon: <Pencil className="h-4 w-4" />, onClick: onRename }] : []),
    { label: "Add a local site to this card", icon: <Link2 className="h-4 w-4" />, onClick: onAddCopy },
    { label: "Show as separate cards", icon: <Unlink2 className="h-4 w-4" />, onClick: onSeparate },
  ];
  return <div className={`rounded-lg border p-1.5 shadow-sm transition ${active ? "border-accent/60 bg-accent-subtle/30" : "border-border-default bg-surface-secondary/50"}`}>
    <div className="flex items-center justify-between gap-2 pl-1">
      <div className="min-w-0 break-words text-[13px] font-semibold text-text-heading" title={name ? `Renamed card · main site ${source.name}` : undefined}>{name ?? source.name}</div>
      <ActionMenu label={`Actions for ${name ?? source.name}`} items={menu} size="sm" />
    </div>
    <div className="mt-1 divide-y divide-border-muted overflow-hidden rounded-md border border-border-muted bg-surface-primary">
      {members.map((site) => {
        const selected = site.id === selectedId;
        return <button key={site.id} type="button" aria-pressed={selected} onClick={() => onSelect(site)} className={`block w-full p-2 text-left transition ${selected ? "bg-accent-subtle shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-hover"}`}>
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">{providerIcon(site.provider)}<span className="truncate">{siteLocation(site)}{lives.length > 0 && site.id === source.id ? " · main" : ""}</span></span>
            <SiteStatus status={site.status} site={site} />
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary"><SiteAccount site={site} /><span className="truncate">{siteHost(site)}</span></div>
          <SiteBadges site={site} />
        </button>;
      })}
    </div>
  </div>;
}

function OverviewTab({ site, connectSite, details, loading, onSetup, onRestore, sync, publicEndpoint, problem, onStart, onCaching }: { /** Opens the live site's Caching section. */ onCaching?: () => void; /** A saved connection that stopped working. */ problem?: React.ReactNode; /** Starts a stopped local site. */ onStart?: () => void; site: WordPressManagedSite | null; connectSite: WordPressManagedSite | null; details: WordPressSiteDetails | null; loading: boolean; onSetup: () => void; onRestore: () => void; /** The local ⇄ live card. */ sync?: React.ReactNode; onReconnect?: () => void; /** The site's Zoer Connect endpoint, whose public pages can be checked. */ publicEndpoint?: { id: string; origin: string } | null }) {
  if (!site) return <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Select a WordPress site" />;
  const health = details?.health || [];
  // A stopped local site cannot report updates or Site Health; one line says so instead of two empty cards.
  const stopped = site.provider === "ddev" && site.status !== "running";
  return <div className="space-y-4">
    {problem}
    <SiteSummary site={site} stopped={stopped} publicEndpointId={publicEndpoint && !problem ? publicEndpoint.id : null} onCaching={onCaching} />
    {sync}
    {stopped && <section aria-label="Site status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-default p-4"><p className="text-sm text-text-secondary">This site is stopped. Start it to check WordPress updates and Site Health.</p>{onStart && <Btn size="sm" icon={<Play className="h-4 w-4" />} onClick={onStart}>Start site</Btn>}</section>}
    {!sync && (site.provider === "hostinger" || site.provider === "zoer-connect") && <section className="rounded-lg border border-border-default p-4"><h4 className="text-sm font-medium text-text-heading">Local development copy</h4><p className="my-3 text-sm text-text-secondary">Download this website into a separate local WordPress site for testing and development.</p><WordPressConnect key={connectSite?.id ?? site.id} siteId={connectSite?.id ?? site.id} siteName={site.name} label="Make a local copy" localCopy onSetup={site.provider === "hostinger" ? onSetup : undefined} onRestore={onRestore} /></section>}
    {site.limitation && !(site.provider === "zoer-connect" && site.status === "connected") && (site.status === "error" || site.status === "unavailable"
      ? <div className="rounded-md border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-[12px] leading-5 text-status-warning"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />{site.limitation}</div>
      : <p className="text-[12px] leading-5 text-text-secondary">{site.limitation}</p>)}
    {stopped ? null : loading ? <p role="status" className="text-sm text-text-secondary">Checking Site Health…</p> : <SiteHealth items={health} local={site.provider === "ddev"} />}
    {site.provider === "ddev" && <details className="rounded-lg border border-border-default px-4"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text-secondary">Resources</summary><div className="pb-4">
      <WordPressResources key={`resources:${site.id}`} siteId={site.id} running={site.status === "running"} />
    </div></details>}
  </div>;
}

/** Site Health as one summary line, with only the checks that need attention listed (their advice folded). */
function SiteHealth({ items, local }: { items: WordPressSiteDetails["health"]; local: boolean }) {
  const attention = items.filter(item => item.status !== "good");
  const counts = (["critical", "recommended", "good"] as const).map(status => [status, items.filter(item => item.status === status).length] as const).filter(([, n]) => n);
  return <section aria-label="Site Health" className="rounded-lg border border-border-default p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-semibold text-text-heading">Site Health</h4>
      {items.length > 0 && <p className="text-xs text-text-secondary">{counts.map(([status, n]) => `${n} ${status}`).join(" · ")}</p>}</div>
    {!items.length ? <p className="mt-2 text-[13px] text-text-secondary">{local ? "No Site Health checks were returned." : "This provider doesn't report Site Health."}</p>
      : !attention.length ? <p className="mt-2 flex items-center gap-1.5 text-[13px] text-status-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />All {items.length} checks passed.</p>
      : <ul className="mt-2 divide-y divide-border-muted">{attention.map((item, index) => <li key={`${item.test}-${index}`} className="py-1.5">
        {item.description ? <details><summary data-zoer-disclosure="" className="flex min-h-9 cursor-pointer items-center justify-between gap-2 text-[13px]"><span className="min-w-0 break-words text-text-primary">{item.label || item.test}</span><Status status={item.status || "unknown"} /></summary><p className="pb-1 text-[12px] leading-5 text-text-secondary">{item.description}</p></details>
          : <div className="flex min-h-9 items-center justify-between gap-2 text-[13px]"><span className="min-w-0 break-words">{item.label || item.test}</span><Status status={item.status || "unknown"} /></div>}
      </li>)}</ul>}
  </section>;
}

/** One labelled value of the site summary. */
function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</dt><dd className="mt-0.5 min-w-0 text-[13px] text-text-primary">{children}</dd></div>;
}

/**
 * The site at a glance, at the top of Overview: WordPress (with its update check on local sites),
 * PHP, where it runs, plugin and theme updates, and for a live site what visitors receive.
 */
function SiteSummary({ site, stopped, publicEndpointId, onCaching }: { site: WordPressManagedSite; stopped: boolean; publicEndpointId: string | null; onCaching?: () => void }) {
  const updates = site.updates === null ? "Not checked" : site.updates === 0 ? "None" : `${site.updates} available`;
  return <section aria-label="Site details" className="rounded-lg border border-border-default px-4 py-3">
    <dl className="grid min-w-0 gap-x-6 gap-y-3 grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-5">
      <SummaryItem label="WordPress">{site.provider === "ddev" && !stopped ? <WordPressCoreUpdates key={site.id} site={site} compact /> : <span className="font-medium">{site.wordpressVersion || (isLocalWordPress(site) ? "Start to check" : "Provider-managed")}</span>}</SummaryItem>
      <SummaryItem label="PHP"><span className="font-medium">{site.phpVersion || "Not reported"}</span></SummaryItem>
      <SummaryItem label="Runs on"><span className="font-medium">{siteLocation(site)}</span></SummaryItem>
      <SummaryItem label="Plugin & theme updates"><span className={site.updates ? "font-medium text-status-warning" : "font-medium"}>{updates}</span></SummaryItem>
      {publicEndpointId && onCaching && <SummaryItem label="Public website"><PublicWebsiteSummary siteId={publicEndpointId} onOpen={onCaching} /></SummaryItem>}
    </dl>
  </section>;
}

function ExtensionsTab({ developingPlugin=null, onDevelop, kind, onKind, onSecurity, paused = false, site, connectSiteId, connectConnected = false, rows, query, setQuery, slug, setSlug, directoryResults, busy, error, onSearch, onPlan }: { developingPlugin?:string|null; onDevelop?:(slug:string|null)=>void; kind: WordPressExtensionKind; /** Switches between the Plugins and Themes halves. */ onKind: (kind: WordPressExtensionKind) => void; /** Opens the local scanner (local DDEV sites). */ onSecurity?: () => void; /** A transfer is changing this site; changes wait. */ paused?: boolean; site: WordPressManagedSite | null; connectSiteId?: string; /** Zoer Connect is already connected (no pairing box). */ connectConnected?: boolean; rows: WordPressInstalledExtension[]; query: string; setQuery: (value: string) => void; slug: string; setSlug: (value: string) => void; directoryResults: Array<{ slug: string; name: string; description: string; imageUrl: string | null }>; busy: string | null; error: string | null; onSearch: (kind: WordPressExtensionKind) => void; onPlan: (kind: WordPressExtensionKind, operation: WordPressExtensionOperation, slugs: string[]) => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const sources=useQuery({queryKey:[getApiBase(),"site-repository-development",site?.id],queryFn:()=>json<{repositories:SiteRepositorySource[]}>(`/wordpress-manager/sites/${encodeURIComponent(site!.id)}/repository-development`),enabled:kind==='plugin'&&(site?.provider==='ddev'||site?.provider==='kubernetes')&&!isDemoMode(),refetchInterval:30000});
  const sourceFor=(slug:string)=>sources.data?.repositories.find(source=>(source.links??(source.link?[source.link]:[])).some(link=>link.siteId===site?.id&&link.slug===slug&&link.kind!=="theme"));
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
  // One source and check time for every row (the usual case) is said once above the list.
  const checkedMinute = (row: WordPressInstalledExtension) => row.securityCheckedAt ? row.securityCheckedAt.slice(0, 16) : "";
  const sharedCheck = rows.length > 0 && rows[0]!.securityCheckedAt && rows.every(row => row.securitySource === rows[0]!.securitySource && checkedMinute(row) === checkedMinute(rows[0]!)) ? rows[0]! : null;
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
    {sharedCheck && <p className="text-xs text-text-secondary">Known vulnerabilities checked{sharedCheck.securitySource ? ` by ${sharedCheck.securitySource}` : ""} on {new Date(sharedCheck.securityCheckedAt!).toLocaleString()}.</p>}
    {allUnchecked && onSecurity && <p className="text-xs text-text-secondary">Known vulnerabilities haven't been checked for these {kind}s. <button type="button" className="min-h-8 text-accent underline underline-offset-2 sm:min-h-0" onClick={onSecurity}>Run a security scan</button></p>}
    {addOpen && <Modal title={`Add ${kind}`} onClose={() => setAddOpen(false)}>
      <form onSubmit={e => { e.preventDefault(); if (slug.trim().length >= 3) { setSearched(true); onSearch(kind); } }} className="flex gap-2"><input autoFocus aria-label={`Search ${kind} directory`} className={controlClass()} value={slug} onChange={e => setSlug(e.target.value)} placeholder={`Search WordPress.org ${kind}s…`} /><Btn type="submit" disabled={slug.trim().length < 3 || busy !== null} loading={busy === `search:${kind}`}>Search</Btn></form>
      <p className="mt-2 text-xs text-text-secondary">Choose a result to review installation.</p>
      {error && <p role="alert" className="mt-3 text-sm text-status-error">{error}</p>}
      {searched && busy !== `search:${kind}` && <div className="mt-4 space-y-3">{directoryResults.map(result => <article key={result.slug} className="rounded-lg border border-border-default p-3"><h3 className="text-sm font-medium">{decode(result.name)}</h3><p className="mt-1 text-xs text-text-muted">{result.slug}</p><p className="my-2 text-sm text-text-secondary">{decode(result.description)}</p><Btn disabled={locked} onClick={() => plan("install", [result.slug])}>Review installation</Btn></article>)}{!directoryResults.length && !error && <p className="text-sm text-text-secondary">No results. Try another name.</p>}</div>}
      <details className="mt-5 border-t border-border-default pt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-sm text-text-secondary">Advanced: install by exact slug</summary><p className="my-2 text-xs text-text-secondary">Use a WordPress.org slug such as contact-form-7 in the search field above.</p><Btn disabled={!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) || locked} onClick={() => plan("install", [slug.trim()])}>Review slug installation</Btn></details>
    </Modal>}
    <ul className="space-y-2 @2xl:hidden">{filtered.map(row => <li key={row.slug} className="flex items-center justify-between gap-2 rounded-lg border border-border-default p-3"><div className="flex min-w-0 flex-1 items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words text-sm font-medium">{title(row)}</h4><p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary"><Status status={row.status} /><span>{version(row)}{row.updateAvailable ? ` → ${row.updateVersion || "latest"}` : ""}</span><span>Auto-update {wordpressExtensionAutoUpdateLabel(row.autoUpdate).toLowerCase()}</span>{!allUnchecked && <span>{security(row)}</span>}</p>{sourceFor(row.slug)&&<p className="mt-1 break-words text-xs text-accent">Repository: {sourceFor(row.slug)!.name}</p>}</div></div><div className="shrink-0">{actions(row)}</div></li>)}</ul>
    <div className="hidden overflow-x-auto rounded-lg border border-border-default @2xl:block"><table className="w-full text-left text-sm"><thead className="bg-surface-primary text-xs text-text-secondary"><tr><th className="p-3">{kind === "plugin" ? "Plugin" : "Theme"}</th><th className="p-3">Status</th><th className="p-3">Version</th><th className="p-3">Auto-update</th>{!allUnchecked && <th className="p-3">Security</th>}<th className="p-3 text-right"><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map(row => <tr key={row.slug} className="border-t border-border-muted"><td className="p-3"><div className="font-medium">{title(row)}</div><div className="text-xs text-text-secondary">{row.slug}</div>{sourceFor(row.slug)&&<p className="mt-1 text-xs text-accent">Repository: {sourceFor(row.slug)!.name}</p>}</td><td className="p-3"><Status status={row.status} /></td><td className="p-3 text-xs">{version(row)}{row.updateAvailable && <div className="text-status-warning">→ {row.updateVersion || "latest"}</div>}</td><td className="p-3 text-xs text-text-secondary">{wordpressExtensionAutoUpdateLabel(row.autoUpdate)}</td>{!allUnchecked && <td className="p-3 text-xs text-text-secondary">{security(row)}{!sharedCheck && row.securitySource && <div className="mt-1">{row.securitySource}{row.securityCheckedAt ? ` · ${new Date(row.securityCheckedAt).toLocaleString()}` : ""}</div>}</td>}<td className="p-3">{actions(row)}</td></tr>)}</tbody></table></div>
    {!filtered.length && <p className="py-6 text-center text-sm text-text-secondary">{query ? `No ${kind}s match “${query}”.` : `No installed ${kind}s reported.`}</p>}
    <p className="text-xs text-text-muted">Auto-update shows what the site reports. Change it in WordPress or your hosting dashboard.</p>
  </div>;
}

/** Whether live plugin and theme changes can go ahead without a new hPanel backup. */
function RecoveryPointStatus({ until, onBackups }: { until: Date | null; onBackups: () => void }) {
  return <p role="status" className={`mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${until ? "text-text-secondary" : "text-status-warning"}`}>
    <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    {until ? `Recovery point valid until ${until.toLocaleString()}.` : "No hPanel backup recorded in the last 24 hours. Updates and removals will ask for one."}
    <button type="button" className="min-h-8 text-accent underline underline-offset-2 sm:min-h-0" onClick={onBackups}>Backups</button>
  </p>;
}

function BackupsTab({ site, details, recoveryPoints, busy, paused = false, retainPortableBackup, onRetainPortableBackup, onCreatePortableBackup, onRecordRecovery, onImportBackup }: { site: WordPressManagedSite | null; details: WordPressSiteDetails | null; recoveryPoints: RecoveryPointRecord[]; busy: string | null; /** A transfer is changing this site. */ paused?: boolean; retainPortableBackup: boolean; onRetainPortableBackup: (value: boolean) => void; onCreatePortableBackup: () => void; onRecordRecovery: () => void; onImportBackup: () => void }) {
  return <div className="space-y-5">
    {site?.provider === "hostinger" && <section className="rounded-md border border-status-warning/25 bg-status-warning/5 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-[13px] font-semibold text-status-warning">Remote recovery points</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Create and verify a backup in hPanel, then record it here. Required within 24 hours of production changes.</p></div><Btn size="sm" loading={busy === "recovery"} icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={onRecordRecovery}>Record verified backup</Btn></div><div className="mt-3 space-y-2">{recoveryPoints.map((point) => <div key={point.id} className="rounded border border-border-muted bg-surface-primary/40 px-3 py-2 text-[13px]"><span className="font-medium text-text-primary">{point.label}</span><span className="ml-2 text-text-secondary">{new Date(point.verifiedAt).toLocaleString()}</span></div>)}{!recoveryPoints.length && <p className="text-[13px] text-text-secondary">No verified recovery point recorded.</p>}</div></section>}
    {site?.provider === "ddev" && <><section className="rounded-md border border-border-default p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-[13px] font-semibold text-text-heading">Download a full backup</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Files and database in one archive. The site is in maintenance mode for a moment while it is made.</p><label className="mt-3 flex items-start gap-2 text-[13px] text-text-secondary"><input type="checkbox" checked={retainPortableBackup} onChange={(event) => onRetainPortableBackup(event.target.checked)} className="ui-checkbox mt-0.5 h-4 w-4 shrink-0" /><span>Also keep a copy in Files</span></label></div><Btn className="w-full shrink-0 sm:w-auto" size="sm" variant="primary" icon={<HardDriveDownload className="h-3.5 w-3.5" />} loading={busy === "portable-backup"} disabled={site.status !== "running" || busy !== null || paused} onClick={onCreatePortableBackup}>Download backup</Btn></div>{site.status !== "running" && <p className="mt-2 text-[13px] text-status-warning">Start this DDEV site before creating a portable backup.</p>}{paused && <p className="mt-2 text-[13px] text-status-warning">Wait for the running transfer to finish before backing up.</p>}</section><section><h4 className="text-[13px] font-semibold text-text-heading">Automatic recovery points</h4><p className="mt-1 text-xs text-text-secondary">Saved automatically before each managed change (a plugin update, a refresh from live), for rolling that change back. They stay on the server and can't be downloaded.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{details?.backups.map((backup) => <div key={backup.id} className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="truncate text-[12px] font-medium text-text-primary" title={backup.name || backup.id}>{recoveryPointLabel(backup.name || backup.id)}</div><div className="mt-1 text-[12px] text-text-secondary">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : ""}</div><div className="mt-2 text-[12px] text-text-secondary">Database {humanBytes(backup.database?.bytes)} · Files {humanBytes(backup.content?.bytes)}</div></div>)}{!details?.backups.length && <p className="text-[13px] text-text-secondary">No recovery points yet.</p>}</div></section></>}
    <section className="rounded-md border border-border-default p-3"><h4 className="text-[13px] font-semibold text-text-heading">Restore a backup</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Upload an UpdraftPlus or Hostinger backup to start a new local site from it. This site is not changed.</p><Btn className="mt-3" size="sm" icon={<HardDriveDownload className="h-4 w-4" />} onClick={onImportBackup}>Restore into a new local site</Btn></section>
  </div>;
}

/**
 * Push & pull for a live website: Local and live (its local copies, pushing from them), the
 * site's own Zoer Connect tools (each opens Transfers on that tool), and publishing through a
 * Hostinger account folded away.
 */
function LiveTransferTab({ site, connectSite, sync, hostingerPublish, onActivity }: {
  site: WordPressManagedSite; connectSite: WordPressManagedSite | null; /** The Local and live card. */ sync: React.ReactNode; hostingerPublish: React.ReactNode;
  /** Opens Activity, where transfers and receipts are listed. */ onActivity: () => void;
}) {
  const tools = [["pull", "Download to Zoer"], ["replace", "Find & replace"], ["backup", "Back up database"], ["export", "Export to this device"]] as const;
  return <div className="min-w-0 space-y-4">
    {sync}
    <section aria-label="Site tools" className="space-y-3 rounded-lg border border-border-default p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-text-heading"><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Tools on {site.name}</h4>
      {connectSite ? <div className="flex flex-wrap gap-2">
        {tools.map(([action, label]) => <WordPressConnect key={action} siteId={connectSite.id} siteName={site.name} label={label} initialAction={action} />)}
      </div> : <>
        <p className="text-[13px] text-text-secondary">Install Zoer Connect on this website to pull, push and back it up from Zoer.</p>
        <WordPressConnect key={`tab:${site.id}`} siteId={site.id} siteName={site.name} label="Set up Zoer Connect" />
      </>}
    </section>
    {hostingerPublish && <details className="min-w-0 rounded-lg border border-border-default p-4"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm font-medium sm:min-h-0">Publish through a Hostinger account instead</summary><div className="mt-3">{hostingerPublish}</div></details>}
    <ActivityPointer onActivity={onActivity} />
  </div>;
}

function ActivityPointer({ onActivity }: { onActivity: () => void }) {
  return <p className="text-[13px] text-text-secondary">Running and past transfers, and publishing receipts, are in <button type="button" className="min-h-8 text-accent underline underline-offset-2 sm:min-h-0" onClick={onActivity}>Activity</button>.</p>;
}

function DeploymentsTab({ compact = false, sync, paused = false, sites, fixedSource, connections, source, setSource, connection, setConnection, domain, setDomain, mode, setMode, busy, onPlan, onImport, onActivity }: { compact?: boolean; /** The Local and live card (a local site's own page). */ sync?: React.ReactNode; /** A transfer is changing this site. */ paused?: boolean; sites: WordPressManagedSite[]; fixedSource: WordPressManagedSite | null; connections: HostingerConnectionPublic[]; source: string; setSource: (value: string) => void; connection: string; setConnection: (value: string) => void; domain: string; setDomain: (value: string) => void; mode: "new" | "replace"; setMode: (value: "new" | "replace") => void; busy: string | null; onPlan: (event: React.FormEvent) => void; onImport: () => void; /** Opens Activity (full pages only). */ onActivity?: () => void }) {
  const destinations = useQuery({queryKey:["wordpress","hostinger-setup",connection],queryFn:()=>api.getHostingerSetupInventory(connection),enabled:!!connection,staleTime:0});
  const publishForm = <form onSubmit={onPlan} className="rounded-lg border border-border-default bg-surface-primary p-4">
      <h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><Rocket className="h-4 w-4 shrink-0" />{sync ? "Publish through a Hostinger account" : "Publish local changes"}</h4>
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
    {sync}
    {compact ? publishForm : <details className="min-w-0 rounded-lg border border-border-default p-4"><summary data-zoer-disclosure="" className="flex min-h-11 cursor-pointer items-center text-sm font-medium sm:min-h-0">Other ways to publish: Hostinger account, new Hostinger website, Hostinger backup</summary><div className="mt-3 space-y-4">
      {publishForm}
      <HostingerWebsiteSetup connections={connections} onCreated={()=>void destinations.refetch()} />
      <section className="rounded-lg border border-border-default p-4"><h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><HardDriveDownload className="h-4 w-4 shrink-0" />Hostinger → local</h4><p className="my-3 text-sm text-text-secondary">Restore an UpdraftPlus or Hostinger backup of the live site into a new local site.</p><Btn onClick={onImport}>Open backup import</Btn></section>
    </div></details>}
    {!compact && onActivity && <ActivityPointer onActivity={onActivity} />}
  </div>;
}

function ConnectionsTab({ onNewWebsite, onConnected, connections, name, setName, token, setToken, busy, onAdd, onTest, onRemove, onRename, renameUnavailable }: { /** Opens New site → Hostinger website, where websites are created, retried and deleted. */ onNewWebsite: () => void; onConnected: () => void; connections: HostingerConnectionPublic[]; name: string; setName: (value: string) => void; token: string; setToken: (value: string) => void; busy: string | null; onAdd: (event: React.FormEvent) => void; onTest: (connection: HostingerConnectionPublic) => void; onRemove: (connection: HostingerConnectionPublic) => void; onRename: (connection: HostingerConnectionPublic, name: string) => Promise<void>; renameUnavailable: boolean }) {
  return <div className="space-y-5">
    <section><h4 className="flex items-center gap-2 text-[13px] font-semibold text-text-heading"><Cloud className="h-4 w-4" /> Hostinger connections</h4><p className="mt-1 text-[13px] leading-4 text-text-secondary">Connect your account to discover and manage its WordPress sites.</p><HostingerBrowserLogin name={name} setName={setName} onConnected={onConnected} connections={connections} /><details className="mt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-[13px] text-text-secondary">Advanced setup · API token</summary><form onSubmit={onAdd} className="mt-3 grid gap-2 rounded-md border border-border-muted bg-surface-primary/40 p-3 md:grid-cols-[1fr_2fr_auto]"><input aria-label="Connection name" className={controlClass("compact")} value={name} onChange={(event) => setName(event.target.value)} placeholder="My Hostinger account" /><input aria-label="Hostinger API token" type="password" autoComplete="new-password" className={controlClass("compact")} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Hostinger API token" /><Btn size="sm" type="submit" variant="primary" loading={busy === "add-connection"} disabled={!name || !token}>Connect</Btn></form></details><div className="mt-3 space-y-2">{connections.map((connection) => <HostingerAccountRow key={connection.id} connection={connection} busy={busy} renameUnavailable={renameUnavailable} onTest={onTest} onRemove={onRemove} onRename={onRename} onReconnected={onConnected} />)}{!connections.length && <p className="text-[13px] text-text-secondary">No Hostinger connection configured.</p>}</div></section>
    {connections.length > 0 && <p className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">New Hostinger websites, and the ones Zoer created, are in <Btn size="sm" onClick={onNewWebsite}>New site → Hostinger website</Btn></p>}
  </div>;
}

function ReviewPanel({ title, plan, confirmation, setConfirmation, busy, onApply, onCancel }: { title: string; plan: WordPressExtensionPlan | WordPressPublishPlan; confirmation: string; setConfirmation: (value: string) => void; busy: boolean; onApply: (acknowledgeCoreUpdate?: boolean) => void; onCancel: () => void }) {
  const phrase = plan.confirmationPhrase;
  const [coreAcknowledged, setCoreAcknowledged] = useState(false);
  const core = "coreCheck" in plan ? plan.coreCheck : null;
  return <Modal mobileSheet title={`Review ${title}`} onClose={() => { if (!busy) onCancel(); }} footer={<><Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn><Btn variant="danger" loading={busy} disabled={Boolean(phrase && confirmation !== phrase) || (core?.status === "available" && !coreAcknowledged)} onClick={()=>onApply(coreAcknowledged)}>Apply reviewed plan</Btn></>}><div className="min-w-0 break-words"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-accent" /><div><h3 className="text-[15px] font-semibold text-text-heading">Review: {title}</h3><p className="mt-1 text-[13px] text-text-secondary">Exact plan fingerprint <span className="font-mono">sha256:{plan.fingerprintSha256}</span></p></div></div>{core && <section aria-label="WordPress publication check" className="mt-4 space-y-2 text-sm"><p>WordPress {core.installed} · Latest stable {core.latest}</p><p className="text-text-secondary">Checked {new Date(core.checkedAt).toLocaleString()}</p>{core.status === "available" && <label className="flex items-start gap-2"><input type="checkbox" className="ui-checkbox" checked={coreAcknowledged} onChange={e=>setCoreAcknowledged(e.target.checked)} /><span>Publish WordPress {core.installed} for now. I have reviewed the available update.</span></label>}</section>}{plan.warnings.length > 0 && <div className="mt-4 rounded-md border border-status-warning/25 bg-status-warning/5 p-3"><div className="text-[13px] font-semibold text-status-warning">Warnings</div><ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-4 text-status-warning">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}<div className="mt-4"><div className="text-[13px] font-semibold text-text-secondary">Planned steps</div><ol className="mt-2 space-y-2">{plan.steps.map((step, index) => <li key={`${index}-${step}`} className="flex gap-2 text-[12px] text-text-secondary"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[12px] text-accent">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol></div>{phrase && <div className="mt-4"><label className="mb-1 block text-[13px] text-text-secondary">Type <strong className="font-mono text-text-primary">{phrase}</strong> to confirm</label><input autoFocus className={controlClass()} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>}</div></Modal>;
}
