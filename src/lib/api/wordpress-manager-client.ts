import { blob, json } from "./_http";
import type {
  HostingerConnectionPublic,
  WordPressDeployment,
  WordPressExtensionKind,
  WordPressExtensionOperation,
  WordPressExtensionPlan,
  WordPressManagedSite,
  WordPressPublishPlan,
  WordPressPortableBackup,
  WordPressRecoveryPoint,
  WordPressSiteDetails,
  WordPressCoreCheck,
  WordPressCoreUpdateState,
  HostingerSetupInventory,
  WordPressStaticExportOptions,
  WordPressStaticExportPreflight,
  WordPressStaticExportJob,
} from "./types";

export interface WordPressSiteDeletePreview {
  trash: { purgeAfterDays: number; purgeAt?: string; kept: string[]; removedAtPurge: string[] };
  erase: { available: boolean; reason?: string; removes: string[] };
}

export interface ExtensionChangeInput {
  siteId: string;
  kind: WordPressExtensionKind;
  operation: WordPressExtensionOperation;
  slugs: string[];
  /** Pinned wordpress.org version (install, local sites, one extension; needs the matching Zoer host). */
  version?: string;
  /** ZIP from a stack file: HTTPS GitHub/wordpress.org link and its SHA-256 (install, local sites, one extension). */
  package?: { url: string; sha256: string };
}

export const wordpressManagerClient = {
  listWordPressStaticExports: (siteId: string) => json<{ exports: WordPressStaticExportJob[] }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports`),
  inspectWordPressStaticExport: (siteId: string, options: WordPressStaticExportOptions) => json<{ preflight: WordPressStaticExportPreflight }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports/inspect`, { method: "POST", body: JSON.stringify(options) }),
  startWordPressStaticExport: (siteId: string, options: WordPressStaticExportOptions) => json<{ export: WordPressStaticExportJob }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports`, { method: "POST", body: JSON.stringify(options) }),
  getWordPressStaticExport: (siteId: string, exportId: string) => json<{ export: WordPressStaticExportJob }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports/${encodeURIComponent(exportId)}`),
  cancelWordPressStaticExport: (siteId: string, exportId: string) => json<{ export: WordPressStaticExportJob }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports/${encodeURIComponent(exportId)}/cancel`, { method: "POST", body: "{}" }),
  deleteWordPressStaticExport: (siteId: string, exportId: string) => json<{ deleted: true }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports/${encodeURIComponent(exportId)}`, { method: "DELETE" }),
  downloadWordPressStaticExport: (siteId: string, exportId: string, sha256: string) => blob(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/static-exports/${encodeURIComponent(exportId)}/download?sha256=${encodeURIComponent(sha256)}`),
  runHostingerSiteTool: (id: string, action: "clear-cache" | "enable-cacheless" | "disable-cacheless" | "detect-installations") => json<{state:"accepted";action:string;siteId:string;requestedAt:string}>(`/wordpress-manager/sites/${encodeURIComponent(id)}/hostinger-tools`, {method:"POST",body:JSON.stringify({action})}),
  getHostingerSetupInventory: (id: string) => json<HostingerSetupInventory>(`/wordpress-manager/connections/${encodeURIComponent(id)}/setup-inventory`),
  /** Whether Zoer Connect is installed and active on Hostinger websites (checked without a key; cached for 10 minutes). */
  checkHostingerZoerConnect: (siteIds: string[], fresh = false) => json<{checks:Array<{siteId:string;domain:string;installed:boolean;checkedAt:string}>}>(`/wordpress-manager/hostinger/zoer-connect-check`, {method:"POST",body:JSON.stringify({siteIds,fresh})}),
  /** Connects a Hostinger website that has Zoer Connect: Hostinger's admin login, a new key (and Pull when asked), saved as its endpoint. */
  connectHostingerZoerConnect: (id: string, allowPull: boolean) => json<{endpointId:string;domain:string;warning:string|null}>(`/wordpress-manager/sites/${encodeURIComponent(id)}/connect-zoer-connect`, {method:"POST",body:JSON.stringify({allowPull})}),
  generateHostingerTemporaryDomain: (id: string) => json<{domain:string}>(`/wordpress-manager/connections/${encodeURIComponent(id)}/temporary-domain`, {method:"POST",body:"{}"}),
  getWordPressCoreUpdates: (siteId: string) => json<WordPressCoreUpdateState>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/core-updates`),
  checkWordPressCoreUpdates: (siteId: string) => json<WordPressCoreUpdateState>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/core-updates/check`, { method: "POST", body: "{}" }),
  applyWordPressCoreUpdate: (siteId: string, check: WordPressCoreCheck) => json<WordPressCoreUpdateState>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/core-updates/update`, { method: "POST", body: JSON.stringify({ installed: check.installed, latest: check.latest, checkedAt: check.checkedAt }) }),
  listWordPressManagedSites: (fresh = false) => json<{ sites: WordPressManagedSite[] }>(`/wordpress-manager/sites${fresh ? "?fresh=1" : ""}`),
  renameLocalWordPressSite: (id: string, name: string) => json<{ name: string; managedUrl: string | null; /** Newer hosts return the updated site, so the list needn't be rebuilt. */ site?: WordPressManagedSite }>(`/wordpress-manager/sites/${encodeURIComponent(id)}/display-name`, { method: "PATCH", body: JSON.stringify({ name }) }),
  getWordPressManagedSite: (id: string, section = "all") => json<WordPressSiteDetails>(`/wordpress-manager/sites/${encodeURIComponent(id)}?section=${encodeURIComponent(section)}`),
  createWordPressPortableBackup: (siteId: string, retainInFiles: boolean) => json<{ backup: WordPressPortableBackup }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/portable-backups`, { method: "POST", body: JSON.stringify({ retainInFiles }) }),
  downloadWordPressPortableBackup: (siteId: string, exportId: string, sha256: string) => blob(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/portable-backups/${encodeURIComponent(exportId)}/download?sha256=${encodeURIComponent(sha256)}`),
  searchWordPressExtensions: (siteId: string, kind: WordPressExtensionKind, query: string) => json<{ provider: string; results: Array<{ slug: string; name: string; description: string; imageUrl: string | null }> }>(`/wordpress-manager/extension-search?siteId=${encodeURIComponent(siteId)}&kind=${kind}&query=${encodeURIComponent(query)}`),
  listWordPressManagerConnections: () => json<{ connections: HostingerConnectionPublic[] }>("/wordpress-manager/connections"),
  createWordPressManagerConnection: (input: { name: string; token: string }) => json<{ connection: HostingerConnectionPublic }>("/wordpress-manager/connections", { method: "POST", body: JSON.stringify(input) }),
  /** 0.6.0: load the websites of a Hostinger account connected through Zoer (S7a). */
  adoptHostingerOAuthConnection: (connectionId: string, name?: string) => json<{ connection: HostingerConnectionPublic }>("/wordpress-manager/connections/oauth", { method: "POST", body: JSON.stringify({ connectionId, ...(name ? { name } : {}) }) }),
  testWordPressManagerConnection: (id: string) => json<{ ok: boolean; testedAt: string; websites: number; installations: number }>(`/wordpress-manager/connections/${encodeURIComponent(id)}/test`, { method: "POST" }),
  /** Replaces an expired sign-in or revoked token in place (same account; sites and recovery points stay). */
  reconnectWordPressManagerConnection: (id: string, input: { oauthConnectionId: string } | { token: string }) => json<{ connection: HostingerConnectionPublic }>(`/wordpress-manager/connections/${encodeURIComponent(id)}/reconnect`, { method: "POST", body: JSON.stringify(input) }),
  deleteWordPressManagerConnection: (id: string) => json<{ ok: boolean }>(`/wordpress-manager/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Renames an account in WordPress Manager (needs a Zoer host with PATCH /connections/:id). */
  renameWordPressManagerConnection: (id: string, name: string) => json<{ connection: HostingerConnectionPublic }>(`/wordpress-manager/connections/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  /** What moving a local site to the trash keeps, and what deleting it everything removes. */
  getWordPressSiteDeletePreview: (siteId: string) => json<WordPressSiteDeletePreview>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/delete-preview`),
  /** Removes a local DDEV site and everything it left behind, now. The typed name must match. */
  eraseWordPressSite: (siteId: string, confirmName: string) => json<{ erased: string[]; warnings: string[] }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/erase`, { method: "POST", body: JSON.stringify({ confirmName }) }),
  createWordPressAdminLink: (siteId: string) => json<{ url: string }>("/wordpress-manager/admin-link", { method: "POST", body: JSON.stringify({ siteId }) }),
  recordWordPressRecoveryPoint: (input: { connectionId: string; domain: string; label: string; confirmed: true }) => json<{ recoveryPoint: WordPressRecoveryPoint }>("/wordpress-manager/recovery-points", { method: "POST", body: JSON.stringify(input) }),
  planWordPressExtensionChange: (input: ExtensionChangeInput) => json<{ plan: WordPressExtensionPlan }>("/wordpress-manager/extension-actions/plan", { method: "POST", body: JSON.stringify(input) }),
  applyWordPressExtensionChange: (input: ExtensionChangeInput & { fingerprintSha256: string; confirmation?: string }) => json<{ plan: WordPressExtensionPlan; result: Record<string, unknown>; deployment: WordPressDeployment }>("/wordpress-manager/extension-actions/apply", { method: "POST", body: JSON.stringify(input) }),
  /** A WordPress website with Zoer Connect paired, ready for Push to live; one Hostinger account (connection) per call. */
  startHostingerTestSite: (connectionId: string, input: { domain: string; orderId: number; adminEmail?: string; datacenterCode?: string; confirmation: string }) => json<{ deployment: WordPressDeployment }>(`/wordpress-manager/connections/${encodeURIComponent(connectionId)}/test-sites`, { method: "POST", body: JSON.stringify(input) }),
  retryHostingerTestSite: (connectionId: string, deploymentId: string) => json<{ deployment: WordPressDeployment }>(`/wordpress-manager/connections/${encodeURIComponent(connectionId)}/test-sites/${encodeURIComponent(deploymentId)}/retry`, { method: "POST", body: "{}" }),
  deleteHostingerTestSite: (connectionId: string, deploymentId: string, confirmation: string) => json<{ deployment: WordPressDeployment }>(`/wordpress-manager/connections/${encodeURIComponent(connectionId)}/test-sites/${encodeURIComponent(deploymentId)}/delete`, { method: "POST", body: JSON.stringify({ confirmation }) }),
  createHostingerWebsite: (input: { connectionId: string; domain: string; orderId: number; datacenterCode?: string; confirmation: string }) => json<{ ok: boolean; deployment: WordPressDeployment }>("/wordpress-manager/hostinger/websites", { method: "POST", body: JSON.stringify(input) }),
  listWordPressDeployments: () => json<{ deployments: WordPressDeployment[] }>("/wordpress-manager/deployments"),
  planWordPressPublish: (input: { sourceSiteId: string; connectionId: string; domain: string; mode: "new" | "replace" }) => json<{ plan: WordPressPublishPlan }>("/wordpress-manager/deployments/plan", { method: "POST", body: JSON.stringify(input) }),
  executeWordPressPublish: (input: { sourceSiteId: string; connectionId: string; domain: string; mode: "new" | "replace"; fingerprintSha256: string; confirmation: string; acknowledgeCoreUpdate?: boolean }) => json<{ plan: WordPressPublishPlan; deployment: WordPressDeployment }>("/wordpress-manager/deployments", { method: "POST", body: JSON.stringify(input) }),
  confirmWordPressDeployment: (id: string) => json<{ deployment: WordPressDeployment }>(`/wordpress-manager/deployments/${encodeURIComponent(id)}/verify`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
};
