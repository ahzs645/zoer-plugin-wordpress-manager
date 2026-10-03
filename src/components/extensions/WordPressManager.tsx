import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wordpressKeys, wordpressQueries, activeWordPressDeployment } from "../../lib/queries/wordpress";
import { resourceQueries } from "../../lib/queries/resources";
import { Select as Select } from "@zoer/plugin-ui/controls";
import HostingerBrowserLogin from "./HostingerBrowserLogin";
import { useResourceSelection } from "@zoer/plugin-ui/workspace";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Cloud,
  ExternalLink,
  Globe2,
  HardDriveDownload,
  History,
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
  type Computer,
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
import { getApiBase } from "../../lib/api/_http";
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
import { wordpressExtensionActions } from "./wordpressExtensionActions";
import WordPressConnect from "./WordPressConnect";
import HostingerWebsiteSetup from "./HostingerWebsiteSetup";
import WordPressCoreUpdates from "./WordPressCoreUpdates";
import HostingerSiteTools from "./HostingerSiteTools";
import WordPressTransferSummary from "./WordPressPullJobs";
import TransferHistory from "./wordpressTransfer/TransferHistory";
import SiteBackups from "./wordpressTransfer/SiteBackups";
import WordPressAddSite from "./WordPressAddSite";
import { isLocalWordPress, wordpressLifecycleAction } from "./wordpressLifecycle";
import { filterWordPressSiteGroups, groupWordPressSites, readSeparatedSitePairs, wordPressSiteCopies, wordPressSiteSource, writeSeparatedSitePairs } from "./wordpressSiteGroups";
import { databaseKeys } from "../../lib/queries/databases";

type ManagerTab = "overview" | "plugins" | "themes" | "backups" | "deployments" | "history" | "connections";

const tabs: Array<{ id: ManagerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "plugins", label: "Plugins" },
  { id: "themes", label: "Themes" },
  { id: "backups", label: "Backups & import" },
  { id: "deployments", label: "Transfer & publish" },
  { id: "history", label: "Transfer history" },

];

function siteLocation(site: WordPressManagedSite) {
  return site.provider === "zoer-connect" ? "External · Zoer Connect" : site.provider === "hostinger" ? "Live · Hostinger" : site.provider === "ddev" ? "Local · DDEV" : "Local · Playground";
}
function siteDomain(site: WordPressManagedSite) {
  return site.managedUrl ? new URL(site.managedUrl).hostname : site.domain || "No public URL";
}
function siteLabel(site: WordPressManagedSite) { return `${site.name} — ${siteLocation(site)}`; }
function siteOptions(sites: WordPressManagedSite[]) {
  return Object.fromEntries(sites.map(site => [site.id, { icon: providerIcon(site.provider), description: `${siteDomain(site)} · ${site.status}` }]));
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
  const [tab, setTab] = useResourceSelection<ManagerTab>("tab", "overview", ["overview", "plugins", "themes", "backups", "deployments", "history", "connections"]);
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
  const [extensionQuery, setExtensionQuery] = useState("");
  const [extensionSlug, setExtensionSlug] = useState("");
  const [directoryResults, setDirectoryResults] = useState<Array<{ slug: string; name: string; description: string; imageUrl: string | null }>>([]);
  const [extensionPlan, setExtensionPlan] = useState<{ input: { siteId: string; kind: WordPressExtensionKind; operation: WordPressExtensionOperation; slugs: string[] }; plan: WordPressExtensionPlan } | null>(null);
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
  const sitesQuery = useQuery(wordpressQueries.sites());
  const connectionsQuery = useQuery({ ...wordpressQueries.connections(), enabled: providersOpen || tab === "deployments" });
  const deploymentsQuery = useQuery({ ...wordpressQueries.deployments(), refetchInterval: query => query.state.data?.some(item => activeWordPressDeployment(item.status)) ? 5_000 : false, refetchIntervalInBackground: false });
  const connectorsQuery = useQuery(wordpressQueries.connectors());
  const selectedSummary = sitesQuery.data?.find(site => site.id === selectedId && (siteScope === "all" || isLocalWordPress(site))) ?? null;
  const inspectSelected = Boolean(selectedSummary && (!isLocalWordPress(selectedSummary) || selectedSummary.status === "running"));
  // Transfer history is cross-site; it reuses the overview details request for the selected site.
  const detailSection = tab === "history" ? "overview" : tab;
  const detailsQuery = useQuery({ ...wordpressQueries.site(selectedId ?? "", detailSection), enabled: inspectSelected });
  const sites = sitesQuery.data ?? [];
  const scopedSites = siteScope === "local" ? sites.filter(isLocalWordPress) : sites;
  const connections = connectionsQuery.data ?? [];
  const deployments = deploymentsQuery.data ?? [];
  const runtimeConnectors = connectorsQuery.data ?? [];
  const details = detailsQuery.data ?? null;
  const loading = sitesQuery.isPending;
  const detailLoading = detailsQuery.isPending && inspectSelected;
  const checkedAt = sitesQuery.dataUpdatedAt ? new Date(sitesQuery.dataUpdatedAt).toLocaleTimeString() : null;
  const detailError = inspectSelected ? detailsQuery.error?.message ?? details?.errors?.join(" ") ?? null : null;
  const readError = sitesQuery.error?.message ?? connectionsQuery.error?.message ?? deploymentsQuery.error?.message ?? connectorsQuery.error?.message;
  const load = async (_quiet = false, fresh = false) => {
    await client.cancelQueries({ queryKey: wordpressKeys.all() });
    if (fresh) {
      try { await client.fetchQuery({ ...wordpressQueries.sites(true), staleTime: 0 }); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to refresh sites."); }
    }
    await Promise.all([
      client.invalidateQueries({ queryKey: wordpressKeys.all(), predicate: query => !fresh || query.queryKey[2] !== "sites" }),
      client.invalidateQueries({ queryKey: resourceQueries.connectors().queryKey }),
    ]);
    return client.getQueryData(wordpressQueries.sites().queryKey) ?? [];
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

  const selectedDetails = inspectSelected && details?.site.id === selectedId ? details : null;
  const selected = selectedSummary ?? selectedDetails?.site ?? null;
  const ddevConnector = runtimeConnectors.find((connector) => connector.id === "ddev");
  const visibleGroups = useMemo(() => filterWordPressSiteGroups(groupWordPressSites(scopedSites, separatedPairs), siteQuery), [scopedSites, separatedPairs, siteQuery]);
  const selectSite = (site: WordPressManagedSite) => {
    if (site.id !== selectedId) setExtensionPlan(null);
    setSelectedId(site.id);
    setTab("overview");
  };
  const setPairSeparated = (sourceId: string, separated: boolean) => {
    setSeparatedPairs((current) => {
      const next = new Set(current);
      if (separated) next.add(sourceId); else next.delete(sourceId);
      writeSeparatedSitePairs(next);
      return next;
    });
  };
  const selectedSource = selected ? wordPressSiteSource(scopedSites, selected) : null;
  const selectedCopies = selected ? wordPressSiteCopies(scopedSites, selected) : [];
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
      const current = client.getQueryData(wordpressQueries.sites().queryKey)?.find(item => item.id === site.id);
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
      ? "This stops the DDEV site and removes it from the WordPress Manager. Its project and database files remain on the DDEV server and the Zoer trash entry can be restored."
      : "This stops the Playground site and moves it to Zoer trash. Its workspace remains recoverable until the trash retention period ends.";
    if (!await dialogs.confirm({ title: `Delete ${site.name}?`, description, confirmLabel: "Move to trash", tone: "danger" })) return;
    setBusy(`delete:${site.id}`);
    setError(null);
    setNotice(null);
    try {
      await write(() => api.destroyComputer(site.id));
      setSelectedId(null);
      setNotice(`${site.name} was moved to trash.`);
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
      const computer = await write(() => api.createComputer(kind === "playground"
        ? { name, runtime: "docker", runtimeProfile: "wordpress-playground", aiMode: "api" }
        : { name, runtime: "connector", runtimeConnectorId: "ddev" }));
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

  const importedBackup = (computer: Computer) => {
    setSelectedId(computer.id);
    setTab("overview");
    setNotice(`${computer.name} was restored and started as a local WordPress site.`);
    void load(true, true);
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
      setError(caught instanceof Error ? caught.message : "Connection test failed.");
    } finally {
      setBusy(null);
    }
  };

  const removeConnection = async (connection: HostingerConnectionPublic) => {
    if (!await dialogs.confirm({ title: `Remove ${connection.name}?`, description: "This removes the provider connection and its Zoer-managed token secret. Hostinger websites are not changed.", confirmLabel: "Remove connection", tone: "danger" })) return;
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
      await write(() => api.recordWordPressRecoveryPoint({ connectionId: connectionId!, domain: domain!, label, confirmed: true }));
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
    { label: "Refresh", iconOnly: true, tooltip: checkedAt ? `Last checked ${checkedAt}` : undefined, icon: <RefreshCw className="h-4 w-4" />, loading: busy === "refresh", disabled: busy !== null, onClick: () => void refreshAll() },
  ];
  const newSiteButton = <Btn variant="primary" aria-label="New local site" icon={<Plus className="h-4 w-4" />} onClick={() => { setCreateMode("blank"); setCreateOpen(true); }}><span className="hidden sm:inline">New local site</span></Btn>;
  if (loading) return <PluginPage title={page} fill actions={headerActions} primary={newSiteButton}><div className="flex min-h-72 items-center justify-center text-[13px] text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sites…</div></PluginPage>;

  const lifecycle = selected ? wordpressLifecycleAction(selected) : null;
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
  const siteMenu = selected ? [
    ...(lifecycle === "stop" ? [{ label: "Stop site", icon: <Square className="h-4 w-4" />, disabled: busy !== null, onClick: () => void changeLifecycle(selected) }] : []),
    ...(isLocalWordPress(selected) && !lifecycle ? [{ label: "Refresh site status", icon: <RefreshCw className="h-4 w-4" />, disabled: busy !== null, onClick: () => void refreshAll() }] : []),
    ...(previewUrl ? [{ label: "Preview", icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(previewUrl, "_blank", "noopener,noreferrer") }] : []),
    ...(selected.capabilities.deploySource || selected.provider === "hostinger" ? [{ label: selected.provider === "ddev" ? "Publish local changes" : "Transfer & publish", icon: <Rocket className="h-4 w-4" />, onClick: () => openPublish(selected) }] : []),
    { label: "Site name & URL", icon: <Pencil className="h-4 w-4" />, onClick: () => { setEditSite(selected); setEditName(selected.name); setEditError(null); } },
    ...(isLocalWordPress(selected) ? [{ label: "Move to trash", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, loading: busy === `delete:${selected.id}`, disabled: busy !== null, onClick: () => void removeSite(selected) }] : []),
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
  const scopeSelect = (className: string) => <label className={className}><span className="sr-only">Show sites</span><Select aria-label="Show WordPress sites" presentation="dropdown" searchable={false} value={siteScope} onChange={event => setSiteScope(event.target.value as "all" | "local")} className={selectClass("compact", "w-full")}><option value="all">All sites</option><option value="local">Local only</option></Select></label>;

  return (
    <PluginPage title={page} badge={scopedSites.length || undefined} fill actions={headerActions} primary={newSiteButton}>
    <section className="flex min-h-0 flex-1 flex-col" aria-label="WordPress Sites manager">
      {/* Phones: the site list is a picker with the scope filter beside it. */}
      <div className="flex items-center gap-2 px-3 pt-3 lg:hidden">
        <label className="min-w-0 flex-1"><span className="sr-only">Site</span><Select searchable aria-label="Select WordPress site" optionDetails={siteOptions(scopedSites)} value={selectedSummary?.id || ""} onChange={e => { setExtensionPlan(null); setSelectedId(e.target.value); setTab("overview"); }} className={selectClass("compact")}><option value="" disabled>Select a site</option>{scopedSites.map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}</Select></label>
        {scopeSelect("w-32 shrink-0")}
      </div>
      <WordPressAddSite open={addSiteOpen} onOpenChange={setAddSiteOpen} onAdded={async id => { await load(true, true); setSelectedId(id); setTab("overview"); setNotice("Website connected."); }} />

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
        <button type="button" aria-pressed={createMode === "backup"} disabled={restoreRunning || busy !== null} onClick={() => setCreateMode("backup")} className={`min-h-16 rounded-lg border p-3 text-left text-sm ${createMode === "backup" ? "border-accent bg-accent-subtle text-text-primary" : "border-border-default text-text-secondary hover:bg-surface-hover"}`}><span className="block font-medium">Restore from backup</span><span className="mt-1 block text-xs">Upload an UpdraftPlus set and start a local site.</span></button>
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
      </section> : <WordPressUpdraftImport ddevAvailable={!!ddevConnector?.active} onRunningChange={setRestoreRunning} onImported={importedBackup} onViewSite={computer => { setSelectedId(computer.id); setTab("overview"); setCreateOpen(false); }} />}

      </Modal>}

      {/* Fills the remaining height: the site list and the site panel scroll independently (SidebarLayout shape). */}
      <div className="flex min-h-0 flex-1">
        <aside aria-label="WordPress sites" className="hidden w-[280px] shrink-0 flex-col border-r border-border-default p-3 lg:flex">
          <div className="flex gap-2"><SearchInput className="min-w-0 flex-1" value={siteQuery} onChange={setSiteQuery} placeholder="Search sites" />{scopeSelect("w-28 shrink-0")}</div>
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {visibleGroups.map((group) => group.kind === "pair"
              ? <SitePairCard key={`pair:${group.id}`} source={group.source} copies={group.copies} selectedId={selectedId} onSelect={selectSite} onSeparate={() => setPairSeparated(group.id, true)} />
              : <SiteCard key={group.site.id} site={group.site} selected={selectedId === group.site.id} onSelect={selectSite} mergeInto={(() => {
                  // A separated copy, or a live site with separated copies, offers to merge again.
                  const source = wordPressSiteSource(sites, group.site);
                  if (source) return separatedPairs.has(source.id) ? source : null;
                  return separatedPairs.has(group.site.id) && wordPressSiteCopies(sites, group.site).length ? group.site : null;
                })()} onMerge={(source) => setPairSeparated(source.id, false)} />)}
            {!visibleGroups.length && <EmptyState icon={<Globe2 />} title={siteQuery ? "No matches" : siteScope === "local" ? "No local sites" : "No sites yet"} description={siteQuery ? undefined : "Create a local site or connect one."} />}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-3 py-3 sm:px-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-text-heading">{selected?.name || "No site selected"}</h2>
                {selected ? <>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-secondary">
                    <span className="inline-flex items-center gap-1.5">{providerIcon(selected.provider)}{siteLocation(selected)}</span>
                    <span role="status" className="inline-flex items-center gap-2">
                      <StatusBadge tone={updating ? "info" : statusTone(selected.status)} icon={updating ? <Loader2 className="animate-spin" /> : undefined}>{updating ? "Updating" : statusLabel(selected.status)}</StatusBadge>
                      {lifecycle === "start" && !updating && <span className="text-[12px] text-text-muted">Start to inspect.</span>}
                    </span>
                    <a className="min-w-0 max-w-full truncate text-[12px] underline underline-offset-2 hover:text-text-primary" href={wordpressPreviewUrl(selected) || undefined} target="_blank" rel="noreferrer">{siteDomain(selected)}</a>
                  </p>
                  {(selectedSource || selectedCopies.length > 0) && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-text-secondary">
                    <span>{selectedSource ? "Local copy of" : selectedCopies.length === 1 ? "Local copy" : "Local copies"}</span>
                    {(selectedSource ? [selectedSource] : selectedCopies).map((counterpart) => <button key={counterpart.id} type="button" onClick={() => selectSite(counterpart)} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-default px-2 py-0.5 font-medium text-text-primary hover:border-border-strong hover:bg-surface-hover"><ArrowLeftRight className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{counterpart.name}</span></button>)}
                  </div>}
                </> : <p className="mt-1 text-[13px] text-text-secondary">Select a site, or create one.</p>}
              </div>
              {selected && <div className="flex shrink-0 items-center gap-1.5">
                <span className="hidden sm:contents">{mainAction}</span>
                <ActionMenu label="Site actions" items={siteMenu} />
              </div>}
            </div>
            {/* Phones put the main button on its own row so the title keeps its width. */}
            {selected && mainAction && <div className="mt-3 flex flex-wrap gap-2 sm:hidden">{mainAction}</div>}
          </div>
          <PageTabs id="wordpress-sections" label="WordPress manager sections" tabs={tabs} value={tab} onChange={setTab} />
          <PageTabPanel id="wordpress-sections" value={tab} className="flex-1 overflow-y-auto p-3 sm:p-4">
            {selected?.provider === "zoer-connect" && tab !== "history" && <WordPressTransferSummary key={selected.id} siteId={selected.id} />}
            {detailError && <div role="alert" className="mb-3 text-sm text-status-error">{detailError} <Btn size="sm" onClick={() => selectedId && void loadDetails(selectedId)}>Retry section</Btn></div>}
            {tab === "history" ? <TransferHistory sites={sites} /> : detailLoading && tab !== "overview" ? <div className="flex min-h-52 items-center justify-center text-[12px] text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Inspecting site…</div> : (
              <>
                {tab === "overview" && <OverviewTab site={selected} details={selectedDetails} loading={detailLoading} onSetup={()=>selected && void openSite(selected,true)} onRestore={openBackupImport} />}
                {tab === "plugins" && <ExtensionsTab kind="plugin" site={selected} rows={selectedDetails?.plugins || []} query={extensionQuery} setQuery={setExtensionQuery} slug={extensionSlug} setSlug={setExtensionSlug} directoryResults={directoryResults} busy={busy} error={error} onSearch={searchDirectory} onPlan={planExtension} />}
                {tab === "themes" && <ExtensionsTab kind="theme" site={selected} rows={selectedDetails?.themes || []} query={extensionQuery} setQuery={setExtensionQuery} slug={extensionSlug} setSlug={setExtensionSlug} directoryResults={directoryResults} busy={busy} error={error} onSearch={searchDirectory} onPlan={planExtension} />}
                {tab === "backups" && selected?.provider === "zoer-connect" && <div className="mb-5"><SiteBackups key={selected.id} siteId={selected.id} siteName={selected.name} /></div>}
                {tab === "backups" && <BackupsTab site={selected} details={selectedDetails} busy={busy} retainPortableBackup={retainPortableBackup} onRetainPortableBackup={setRetainPortableBackup} onCreatePortableBackup={createPortableBackup} onRecordRecovery={recordRecovery} onImportBackup={openBackupImport} />}
                {tab === "deployments" && selected && selectedDetails?.plugins.some(plugin => plugin.slug === "zoer-connect" && plugin.status === "active") && <section className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border-muted pb-3"><h3 className="text-sm font-medium text-text-heading">Zoer Connect is installed</h3><WordPressConnect key={selected.id} siteId={selected.id} siteName={selected.name} /></section>}
                {tab === "deployments" && selected?.provider === "zoer-connect" && <p className="text-sm text-text-secondary">Use {connectLabel} to pull, push, back up or export this site.</p>}
                {tab === "deployments" && selected?.provider !== "zoer-connect" && <DeploymentsTab sites={sites} fixedSource={selected?.capabilities.deploySource ? selected : null} connections={connections} deployments={deployments} source={publishSource} setSource={setPublishSource} connection={publishConnection} setConnection={setPublishConnection} domain={publishDomain} setDomain={setPublishDomain} mode={publishMode} setMode={setPublishMode} busy={busy} onPlan={planPublish} onVerify={confirmDeployment} onImport={() => setTab("backups")} />}

              </>
            )}
          </PageTabPanel>
        </div>
      </div>

      {providersOpen && <Modal title="Provider accounts" onClose={() => setProvidersOpen(false)}><ConnectionsTab onConnected={() => void load(true, true)} connections={connections} name={connectionName} setName={setConnectionName} token={connectionToken} setToken={setConnectionToken} busy={busy} onAdd={addConnection} onTest={testConnection} onRemove={removeConnection} /></Modal>}
      {extensionPlan && <ReviewPanel title={`${extensionPlan.plan.operation} ${extensionPlan.plan.kind}${extensionPlan.plan.slugs.length > 1 ? "s" : ""}`} plan={extensionPlan.plan} confirmation={confirmation} setConfirmation={setConfirmation} busy={busy === "apply-extension"} onApply={applyExtension} onCancel={() => { setExtensionPlan(null); setConfirmation(""); }} />}
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

function OverviewTab({ site, details, loading, onSetup, onRestore }: { site: WordPressManagedSite | null; details: WordPressSiteDetails | null; loading: boolean; onSetup: () => void; onRestore: () => void }) {
  if (!site) return <EmptyState icon={<Globe2 className="h-7 w-7" />} title="Select a WordPress site" />;
  const health = details?.health || [];
  return <div className="space-y-4">
    {site.provider === "ddev" && <WordPressCoreUpdates key={site.id} site={site} />}
    {site.provider === "hostinger" && <HostingerSiteTools key={site.id} site={site} />}
    {(site.provider === "hostinger" || site.provider === "zoer-connect") && <section className="rounded-lg border border-border-default p-4"><h4 className="text-sm font-medium text-text-heading">Local development copy</h4><p className="my-3 text-sm text-text-secondary">Download this website into a separate local WordPress site for testing and development.</p><WordPressConnect key={site.id} siteId={site.id} siteName={site.name} label="Make a local copy" localCopy onSetup={site.provider === "hostinger" ? onSetup : undefined} onRestore={onRestore} /></section>}
    <details><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-sm text-text-secondary">Site details</summary><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Info label="Provider" value={site.provider} /><Info label="Environment" value={site.environment} />
      <Info label="WordPress" value={site.wordpressVersion || "Provider-managed"} />
      <Info label="PHP" value={site.phpVersion || "Not reported"} />
      <Info label="Cached updates" value={site.updates === null ? "Not checked" : String(site.updates)} />
    </div></details>

    {site.limitation && !(site.provider === "zoer-connect" && site.status === "connected") && <div className="rounded-md border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-[12px] leading-5 text-status-warning"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />{site.limitation}</div>}
    {loading ? <p role="status" className="text-sm text-text-secondary">Checking Site Health…</p> : <section><h4 className="text-[13px] font-semibold text-text-heading">Site Health</h4><div className="mt-2 grid gap-2 md:grid-cols-2">{health.map((item, index) => <div key={`${item.test}-${index}`} className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-text-primary">{item.label || item.test}</span><Status status={item.status || "unknown"} /></div>{item.status !== "good" && item.description && <p className="mt-1 line-clamp-3 text-[12px] leading-4 text-text-secondary">{item.description}</p>}</div>)}{!health.length && <p className="text-[12px] text-text-secondary">{site.provider === "ddev" ? "No Site Health checks were returned." : "This provider doesn't report Site Health."}</p>}</div></section>}
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="text-[12px] text-text-secondary">{label}</div><div className="mt-1 truncate text-[13px] font-medium capitalize text-text-primary">{value}</div></div>;
}

function ExtensionsTab({ kind, site, rows, query, setQuery, slug, setSlug, directoryResults, busy, error, onSearch, onPlan }: { kind: WordPressExtensionKind; site: WordPressManagedSite | null; rows: WordPressInstalledExtension[]; query: string; setQuery: (value: string) => void; slug: string; setSlug: (value: string) => void; directoryResults: Array<{ slug: string; name: string; description: string; imageUrl: string | null }>; busy: string | null; error: string | null; onSearch: (kind: WordPressExtensionKind) => void; onPlan: (kind: WordPressExtensionKind, operation: WordPressExtensionOperation, slugs: string[]) => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const decode = (value: string) => { const el = document.createElement("textarea"); el.innerHTML = value; return el.value; };
  const filtered = rows.filter(row => `${row.name} ${row.slug}`.toLowerCase().includes(query.toLowerCase()));
  const updates = rows.filter(row => row.updateAvailable).map(row => row.slug);
  const title = (row: WordPressInstalledExtension) => row.name !== row.slug ? row.name : row.slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  const plan = (operation: WordPressExtensionOperation, slugs: string[]) => { setAddOpen(false); onPlan(kind, operation, slugs); };
  const actions = (row: WordPressInstalledExtension) => <div className="flex flex-wrap justify-end gap-1">{wordpressExtensionActions(kind, row.status, row.updateAvailable).filter(op => op !== "uninstall").map(op => <Btn key={op} size="sm" disabled={busy !== null} onClick={() => plan(op, [row.slug])}>{op.charAt(0).toUpperCase() + op.slice(1)}</Btn>)}{wordpressExtensionActions(kind, row.status, row.updateAvailable).includes("uninstall") && <ActionMenu label={`More actions for ${title(row)}`} size="sm" items={[{ label: "Uninstall", icon: <Trash2 className="h-4 w-4" />, tone: "danger", disabled: busy !== null, onClick: () => plan("uninstall", [row.slug]) }]} />}</div>;
  const allUnchecked = rows.length > 0 && rows.every(row => !row.securityCheckedAt && !row.vulnerabilities.length);
  const security = (row: WordPressInstalledExtension) => row.vulnerabilities.length ? `${row.vulnerabilities.length} known risks` : row.securityCheckedAt ? "No reported risks" : "Security not checked";
  if (!site) return <EmptyState icon={<Package className="h-7 w-7" />} title="Select a site" />;
  if (!site.capabilities.extensions) return <EmptyState icon={<Package className="h-7 w-7" />} title={`${kind === "plugin" ? "Plugin" : "Theme"} management unavailable`} description={site.limitation || undefined} />;
  return <div className="space-y-3">
    {kind === "plugin" && rows.some(row => row.slug === "zoer-connect" && row.status === "active") && <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-default p-3"><div><h4 className="text-sm font-medium">Zoer Connect</h4><p className="text-xs text-text-secondary">Paste the connection info generated in WordPress.</p></div><WordPressConnect key={site.id} siteId={site.id} siteName={site.name} /></section>}
    <div className="flex flex-wrap gap-2"><SearchInput className="min-w-0 flex-1 basis-44" value={query} onChange={setQuery} placeholder={`Filter installed ${kind}s…`} /><Btn variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setAddOpen(true); setSearched(false); setSlug(""); }}>Add {kind}</Btn>{updates.length > 0 && <Btn disabled={busy !== null} onClick={() => plan("update", updates)}>Review {updates.length} updates</Btn>}</div>
    {allUnchecked && <p className="text-xs text-text-secondary">Security: not checked.</p>}
    {addOpen && <Modal title={`Add ${kind}`} onClose={() => setAddOpen(false)}>
      <form onSubmit={e => { e.preventDefault(); if (slug.trim().length >= 3) { setSearched(true); onSearch(kind); } }} className="flex gap-2"><input autoFocus aria-label={`Search ${kind} directory`} className={controlClass()} value={slug} onChange={e => setSlug(e.target.value)} placeholder={`Search WordPress.org ${kind}s…`} /><Btn type="submit" disabled={slug.trim().length < 3 || busy !== null} loading={busy === `search:${kind}`}>Search</Btn></form>
      <p className="mt-2 text-xs text-text-secondary">Choose a result to review installation.</p>
      {error && <p role="alert" className="mt-3 text-sm text-status-error">{error}</p>}
      {searched && busy !== `search:${kind}` && <div className="mt-4 space-y-3">{directoryResults.map(result => <article key={result.slug} className="rounded-lg border border-border-default p-3"><h3 className="text-sm font-medium">{decode(result.name)}</h3><p className="mt-1 text-xs text-text-muted">{result.slug}</p><p className="my-2 text-sm text-text-secondary">{decode(result.description)}</p><Btn disabled={busy !== null} onClick={() => plan("install", [result.slug])}>Review installation</Btn></article>)}{!directoryResults.length && !error && <p className="text-sm text-text-secondary">No results. Try another name.</p>}</div>}
      <details className="mt-5 border-t border-border-default pt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-sm text-text-secondary">Advanced: install by exact slug</summary><p className="my-2 text-xs text-text-secondary">Use a WordPress.org slug such as contact-form-7 in the search field above.</p><Btn disabled={!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) || busy !== null} onClick={() => plan("install", [slug.trim()])}>Review slug installation</Btn></details>
    </Modal>}
    <div className="space-y-2 md:hidden">{filtered.map(row => <article key={row.slug} className="rounded-lg border border-border-default p-3"><div className="flex items-start justify-between gap-2"><h4 className="min-w-0 break-words text-sm font-medium">{title(row)}</h4><Status status={row.status} /></div><p className="mt-1 text-xs text-text-secondary">Version {row.version}{row.updateAvailable ? ` → ${row.updateVersion || "latest"}` : ""}{!allUnchecked && ` · ${security(row)}`}</p><div className="mt-3">{actions(row)}</div></article>)}</div>
    <div className="hidden overflow-x-auto rounded-lg border border-border-default md:block"><table className="w-full text-left text-sm"><thead className="bg-surface-primary text-xs text-text-secondary"><tr><th className="p-3">{kind === "plugin" ? "Plugin" : "Theme"}</th><th className="p-3">Status</th><th className="p-3">Version</th>{!allUnchecked && <th className="p-3">Security</th>}<th className="p-3">Actions</th></tr></thead><tbody>{filtered.map(row => <tr key={row.slug} className="border-t border-border-muted"><td className="p-3"><div className="font-medium">{title(row)}</div><div className="text-xs text-text-secondary">{row.slug}</div></td><td className="p-3"><Status status={row.status} /></td><td className="p-3 text-xs">{row.version}{row.updateAvailable && <div className="text-status-warning">→ {row.updateVersion || "latest"}</div>}</td>{!allUnchecked && <td className="p-3 text-xs text-text-secondary">{security(row)}</td>}<td className="p-3">{actions(row)}</td></tr>)}</tbody></table></div>
    {!filtered.length && <p className="py-6 text-center text-sm text-text-secondary">{query ? `No ${kind}s match “${query}”.` : `No installed ${kind}s reported.`}</p>}
  </div>;
}

function BackupsTab({ site, details, busy, retainPortableBackup, onRetainPortableBackup, onCreatePortableBackup, onRecordRecovery, onImportBackup }: { site: WordPressManagedSite | null; details: WordPressSiteDetails | null; busy: string | null; retainPortableBackup: boolean; onRetainPortableBackup: (value: boolean) => void; onCreatePortableBackup: () => void; onRecordRecovery: () => void; onImportBackup: () => void }) {
  return <div className="space-y-5">
    {site?.provider === "hostinger" && <section className="rounded-md border border-status-warning/25 bg-status-warning/5 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-[13px] font-semibold text-status-warning">Remote recovery points</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Create and verify a backup in hPanel, then record it here. Required within 24 hours of production changes.</p></div><Btn size="sm" loading={busy === "recovery"} icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={onRecordRecovery}>Record verified backup</Btn></div><div className="mt-3 space-y-2">{details?.recoveryPoints.map((point) => <div key={point.id} className="rounded border border-border-muted bg-surface-primary/40 px-3 py-2 text-[13px]"><span className="font-medium text-text-primary">{point.label}</span><span className="ml-2 text-text-secondary">{new Date(point.verifiedAt).toLocaleString()}</span></div>)}{!details?.recoveryPoints.length && <p className="text-[13px] text-text-secondary">No verified recovery point recorded.</p>}</div></section>}
    {site?.provider === "ddev" && <><section className="rounded-md border border-border-default p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-[13px] font-semibold text-text-heading">Full-site backup</h4><p className="mt-1 max-w-2xl text-[13px] leading-4 text-text-secondary">Files + database. Brief maintenance mode.</p><label className="mt-3 flex items-start gap-2 text-[13px] text-text-secondary"><input type="checkbox" checked={retainPortableBackup} onChange={(event) => onRetainPortableBackup(event.target.checked)} className="ui-checkbox mt-0.5 h-4 w-4 shrink-0" /><span>Keep a copy in Files</span></label></div><Btn className="w-full shrink-0 sm:w-auto" size="sm" variant="primary" icon={<HardDriveDownload className="h-3.5 w-3.5" />} loading={busy === "portable-backup"} disabled={site.status !== "running" || busy !== null} onClick={onCreatePortableBackup}>Download backup</Btn></div>{site.status !== "running" && <p className="mt-2 text-[13px] text-status-warning">Start this DDEV site before creating a portable backup.</p>}</section><section><h4 className="text-[13px] font-semibold text-text-heading">Automatic recovery points</h4><p className="mt-1 text-xs text-text-secondary">Saved before each managed change so it can be rolled back. Not downloadable.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{details?.backups.map((backup) => <div key={backup.id} className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="truncate text-[12px] font-medium text-text-primary" title={backup.name || backup.id}>{/* The date is shown below; drop the ISO stamp the backend appends to names. */}{(backup.name || backup.id || "").replace(/\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/, "")}</div><div className="mt-1 text-[12px] text-text-secondary">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : ""}</div><div className="mt-2 text-[12px] text-text-secondary">DB {humanBytes(backup.database?.bytes)} · Content {humanBytes(backup.content?.bytes)}</div></div>)}{!details?.backups.length && <p className="text-[13px] text-text-secondary">No recovery points yet.</p>}</div></section></>}
    <Btn icon={<HardDriveDownload className="h-4 w-4" />} onClick={onImportBackup}>Restore backup into a new local site</Btn>
  </div>;
}

function DeploymentsTab({ sites, fixedSource, connections, deployments, source, setSource, connection, setConnection, domain, setDomain, mode, setMode, busy, onPlan, onVerify, onImport }: { sites: WordPressManagedSite[]; fixedSource: WordPressManagedSite | null; connections: HostingerConnectionPublic[]; deployments: WordPressDeployment[]; source: string; setSource: (value: string) => void; connection: string; setConnection: (value: string) => void; domain: string; setDomain: (value: string) => void; mode: "new" | "replace"; setMode: (value: "new" | "replace") => void; busy: string | null; onPlan: (event: React.FormEvent) => void; onVerify: (deployment: WordPressDeployment) => void; onImport: () => void }) {
  const destinations = useQuery({queryKey:["wordpress","hostinger-setup",connection],queryFn:()=>api.getHostingerSetupInventory(connection),enabled:!!connection,staleTime:0});
  const localSource = fixedSource ?? sites.find(site=>site.id===source && site.provider==="ddev");
  return <div className="space-y-5">
    {localSource && <WordPressCoreUpdates key={localSource.id} site={localSource} />}
    <form onSubmit={onPlan} className="rounded-lg border border-border-default bg-surface-primary p-4">
      <h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><Rocket className="h-4 w-4 shrink-0" />Publish local changes</h4>
      <p className="mt-1 text-[13px] text-text-secondary">{fixedSource ? `From ${fixedSource.name}. ` : ""}Replaces the live site; live edits are not merged.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* On a local site's own page it is already the source; only other pages ask. */}
        {fixedSource ? null : <label className="min-w-0 space-y-1 text-sm">From: local site<Select searchable aria-label="Deployment source site" optionDetails={siteOptions(sites)} className={selectClass("compact")} value={source} onChange={event => setSource(event.target.value)}><option value="">Choose local site</option>{sites.filter(site => site.capabilities.deploySource).map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}</Select></label>}
        <label className="min-w-0 space-y-1 text-sm">Hostinger account<Select searchable aria-label="Hostinger connection" className={selectClass("compact")} value={connection} onChange={event => { setConnection(event.target.value); setDomain(""); }}><option value="">Choose account</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="min-w-0 space-y-1 text-sm">Destination type<Select aria-label="Deployment mode" className={selectClass("compact")} value={mode} onChange={event => { setMode(event.target.value as "new" | "replace"); setDomain(""); }}><option value="replace">Update an existing live site</option><option value="new">Publish to a new / empty site</option></Select></label>
        {mode === "replace" ? <label className="min-w-0 space-y-1 text-sm">To: live site<Select searchable aria-label="Target live site" optionDetails={Object.fromEntries(sites.filter(site => site.provider === "hostinger").map(site => [site.domain, { icon: providerIcon(site.provider), description: siteDomain(site) }]))} className={selectClass("compact")} value={domain} onChange={event => setDomain(event.target.value)}><option value="">Choose live destination</option>{sites.filter(site => site.provider === "hostinger" && site.connectionId === connection).map(site => <option key={site.id} value={site.domain || ""}>{siteLabel(site)}</option>)}</Select></label>
          : <label className="min-w-0 space-y-1 text-sm">To: empty Hostinger website<Select searchable aria-label="Target empty Hostinger website" value={domain} onChange={e=>setDomain(e.target.value)}><option value="">Choose created destination</option>{destinations.data?.websites.filter(w=>!w.hasWordPress).map(w=><option key={w.domain} value={w.domain}>{w.domain}</option>)}</Select><Btn type="button" size="sm" loading={destinations.isFetching} onClick={()=>void destinations.refetch()}>Refresh destinations</Btn>{destinations.error && <p role="alert" className="text-status-warning">{destinations.error instanceof Error?destinations.error.message:"Destinations unavailable."}</p>}</label>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">{mode === "replace" && <p className="mr-auto text-sm text-text-secondary">Back up the live site first.</p>}<Btn type="submit" variant="primary" loading={busy === "plan-publish"} disabled={!source || !connection || !domain}>Review publication</Btn></div>
    </form>
    <HostingerWebsiteSetup connections={connections} onCreated={()=>void destinations.refetch()} />
    <section className="rounded-lg border border-border-default p-4"><h4 className="flex items-center gap-2 text-base font-semibold text-text-heading"><HardDriveDownload className="h-4 w-4 shrink-0" />Hostinger → local</h4><p className="my-3 text-sm leading-6 text-text-secondary">Restore an UpdraftPlus backup of the live site into a new local site.</p><Btn onClick={onImport}>Open backup import</Btn></section>
    <section><h4 className="flex items-center gap-2 text-[13px] font-semibold text-text-heading"><History className="h-4 w-4" /> Deployment history</h4><div className="mt-3 space-y-2">{deployments.slice(0, 50).map((item) => <div key={item.id} className="rounded-md border border-border-muted bg-surface-primary/50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[12px] font-medium text-text-primary">{item.domain || item.type}<span className="ml-2 text-[12px] font-normal text-text-secondary">{item.type.replace("-", " ")}</span></div><div className="flex items-center gap-2">{item.status === "verification_required" && <Btn size="sm" variant="ghost" loading={busy === `verify:${item.id}`} onClick={() => onVerify(item)}>Mark verified</Btn>}<Status status={item.status} /></div></div><div className="mt-1 text-[13px] text-text-secondary">{item.step}</div>{item.error && <div className="mt-2 text-[12px] text-status-error">{item.error}</div>}<div className="mt-2 text-[12px] text-text-secondary">{new Date(item.updatedAt).toLocaleString()} · {item.id}</div></div>)}{!deployments.length && <p className="text-[13px] text-text-secondary">No deployment receipts yet.</p>}</div></section>
  </div>;
}

function ConnectionsTab({ onConnected, connections, name, setName, token, setToken, busy, onAdd, onTest, onRemove }: { onConnected: () => void; connections: HostingerConnectionPublic[]; name: string; setName: (value: string) => void; token: string; setToken: (value: string) => void; busy: string | null; onAdd: (event: React.FormEvent) => void; onTest: (connection: HostingerConnectionPublic) => void; onRemove: (connection: HostingerConnectionPublic) => void }) {
  return <div className="space-y-5">
    <section><h4 className="flex items-center gap-2 text-[13px] font-semibold text-text-heading"><Cloud className="h-4 w-4" /> Hostinger connections</h4><p className="mt-1 text-[13px] leading-4 text-text-secondary">Connect your account to discover and manage its WordPress sites.</p><HostingerBrowserLogin name={name} setName={setName} onConnected={onConnected} /><details className="mt-3"><summary data-zoer-disclosure="" className="cursor-pointer py-2 text-[13px] text-text-secondary">Advanced setup · API token</summary><form onSubmit={onAdd} className="mt-3 grid gap-2 rounded-md border border-border-muted bg-surface-primary/40 p-3 md:grid-cols-[1fr_2fr_auto]"><input aria-label="Connection name" className={controlClass("compact")} value={name} onChange={(event) => setName(event.target.value)} placeholder="My Hostinger account" /><input aria-label="Hostinger API token" type="password" autoComplete="new-password" className={controlClass("compact")} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Hostinger API token" /><Btn size="sm" type="submit" variant="primary" loading={busy === "add-connection"} disabled={!name || !token}>Connect</Btn></form></details><div className="mt-3 space-y-2">{connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-muted bg-surface-primary/50 p-3"><div><div className="flex items-center gap-2 text-[12px] font-medium text-text-primary">{connection.name}<Status status={connection.status} /></div><div className="mt-1 text-[12px] text-text-secondary">{connection.authMethod === "browser-login" ? "Browser sign-in" : "API token"} · Last tested {connection.lastTestedAt ? new Date(connection.lastTestedAt).toLocaleString() : "never"}</div>{connection.lastError && <div className="mt-1 text-[12px] text-status-error">{connection.lastError}</div>}</div><div className="flex gap-1"><Btn size="sm" variant="ghost" loading={busy === `test:${connection.id}`} onClick={() => onTest(connection)}>Test</Btn><Btn size="sm" variant="ghost" loading={busy === `remove:${connection.id}`} icon={<Trash2 className="h-3 w-3" />} onClick={() => onRemove(connection)}>Remove</Btn></div></div>)}{!connections.length && <p className="text-[13px] text-text-secondary">No Hostinger connection configured.</p>}</div></section>
    <HostingerWebsiteSetup connections={connections} onCreated={onConnected} />
  </div>;
}

function ReviewPanel({ title, plan, confirmation, setConfirmation, busy, onApply, onCancel }: { title: string; plan: WordPressExtensionPlan | WordPressPublishPlan; confirmation: string; setConfirmation: (value: string) => void; busy: boolean; onApply: (acknowledgeCoreUpdate?: boolean) => void; onCancel: () => void }) {
  const phrase = plan.confirmationPhrase;
  const [coreAcknowledged, setCoreAcknowledged] = useState(false);
  const core = "coreCheck" in plan ? plan.coreCheck : null;
  return <Modal mobileSheet title={`Review ${title}`} onClose={() => { if (!busy) onCancel(); }} footer={<><Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn><Btn variant="danger" loading={busy} disabled={Boolean(phrase && confirmation !== phrase) || (core?.status === "available" && !coreAcknowledged)} onClick={()=>onApply(coreAcknowledged)}>Apply reviewed plan</Btn></>}><div className="min-w-0 break-words"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-accent" /><div><h3 className="text-[15px] font-semibold text-text-heading">Review: {title}</h3><p className="mt-1 text-[13px] text-text-secondary">Exact plan fingerprint <span className="font-mono">sha256:{plan.fingerprintSha256}</span></p></div></div>{core && <section aria-label="WordPress publication check" className="mt-4 space-y-2 text-sm"><p>WordPress {core.installed} · Latest stable {core.latest}</p><p className="text-text-secondary">Checked {new Date(core.checkedAt).toLocaleString()}</p>{core.status === "available" && <label className="flex items-start gap-2"><input type="checkbox" className="ui-checkbox" checked={coreAcknowledged} onChange={e=>setCoreAcknowledged(e.target.checked)} /><span>Publish WordPress {core.installed} for now. I have reviewed the available update.</span></label>}</section>}{plan.warnings.length > 0 && <div className="mt-4 rounded-md border border-status-warning/25 bg-status-warning/5 p-3"><div className="text-[13px] font-semibold text-status-warning">Warnings</div><ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-4 text-status-warning">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}<div className="mt-4"><div className="text-[13px] font-semibold text-text-secondary">Planned steps</div><ol className="mt-2 space-y-2">{plan.steps.map((step, index) => <li key={`${index}-${step}`} className="flex gap-2 text-[12px] text-text-secondary"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[12px] text-accent">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol></div>{phrase && <div className="mt-4"><label className="mb-1 block text-[13px] text-text-secondary">Type <strong className="font-mono text-text-primary">{phrase}</strong> to confirm</label><input autoFocus className={controlClass()} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>}</div></Modal>;
}
