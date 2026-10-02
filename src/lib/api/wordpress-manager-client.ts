import { type BrowserProvider } from "@zoer/api-types";
import { blob, json } from "./_http";
import type {
  HostingerConnectionPublic,
  HostingerLoginStatus,
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
  WordPressBackupRestore,
  HostingerSetupInventory,
} from "./types";

export interface ExtensionChangeInput {
  siteId: string;
  kind: WordPressExtensionKind;
  operation: WordPressExtensionOperation;
  slugs: string[];
}

export const wordpressManagerClient = {
  runHostingerSiteTool: (id: string, action: "clear-cache" | "enable-cacheless" | "disable-cacheless" | "detect-installations") => json<{state:"accepted";action:string;siteId:string;requestedAt:string}>(`/wordpress-manager/sites/${encodeURIComponent(id)}/hostinger-tools`, {method:"POST",body:JSON.stringify({action})}),
  getHostingerSetupInventory: (id: string) => json<HostingerSetupInventory>(`/wordpress-manager/connections/${encodeURIComponent(id)}/setup-inventory`),
  generateHostingerTemporaryDomain: (id: string) => json<{domain:string}>(`/wordpress-manager/connections/${encodeURIComponent(id)}/temporary-domain`, {method:"POST",body:"{}"}),
  registerWordPressBackupRestore: (manifest: import("./computers-client").WordPressUpdraftImportManifest) => json<{id: string}>("/wordpress-manager/backup-restores", {method:"POST",body:JSON.stringify(manifest)}),
  uploadWordPressBackupPart: (id: string, component: string, index: number, bytes: Blob) => json<{bytes:number}>(`/wordpress-manager/backup-restores/${encodeURIComponent(id)}/parts/${component}/${index}`, {method:"PUT",headers:{"content-type":"application/octet-stream"},body:bytes}),
  prepareWordPressBackupRestore: (id: string) => json<WordPressBackupRestore>(`/wordpress-manager/backup-restores/${encodeURIComponent(id)}/prepare`, {method:"POST",body:"{}"}),
  getWordPressBackupRestore: (id: string) => json<WordPressBackupRestore>(`/wordpress-manager/backup-restores/${encodeURIComponent(id)}`),
  restoreWordPressBackupToDdev: (id: string) => json<WordPressBackupRestore>(`/wordpress-manager/backup-restores/${encodeURIComponent(id)}/restore`, {method:"POST",body:"{}"}),
  getWordPressCoreUpdates: (siteId: string) => json<WordPressCoreUpdateState>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/core-updates`),
  checkWordPressCoreUpdates: (siteId: string) => json<WordPressCoreUpdateState>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/core-updates/check`, { method: "POST", body: "{}" }),
  applyWordPressCoreUpdate: (siteId: string, check: WordPressCoreCheck) => json<WordPressCoreUpdateState>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/core-updates/update`, { method: "POST", body: JSON.stringify({ installed: check.installed, latest: check.latest, checkedAt: check.checkedAt }) }),
  startHostingerLogin: (name: string, viewport?: { width: number; height: number }, browserProvider: BrowserProvider = "steel") => json<{ login: HostingerLoginStatus }>("/wordpress-manager/hostinger/login", { method: "POST", body: JSON.stringify({ name, viewport, browserProvider }) }),
  getHostingerLogin: (id: string) => json<{ login: HostingerLoginStatus }>(`/wordpress-manager/hostinger/login/${encodeURIComponent(id)}`),
  cancelHostingerLogin: (id: string) => json<{ ok: boolean }>(`/wordpress-manager/hostinger/login/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listWordPressManagedSites: (fresh = false) => json<{ sites: WordPressManagedSite[] }>(`/wordpress-manager/sites${fresh ? "?fresh=1" : ""}`),
  renameLocalWordPressSite: (id: string, name: string) => json<{ name: string; managedUrl: string }>(`/wordpress-manager/sites/${encodeURIComponent(id)}/display-name`, { method: "PATCH", body: JSON.stringify({ name }) }),
  getWordPressManagedSite: (id: string, section = "all") => json<WordPressSiteDetails>(`/wordpress-manager/sites/${encodeURIComponent(id)}?section=${encodeURIComponent(section)}`),
  createWordPressPortableBackup: (siteId: string, retainInFiles: boolean) => json<{ backup: WordPressPortableBackup }>(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/portable-backups`, { method: "POST", body: JSON.stringify({ retainInFiles }) }),
  downloadWordPressPortableBackup: (siteId: string, exportId: string, sha256: string) => blob(`/wordpress-manager/sites/${encodeURIComponent(siteId)}/portable-backups/${encodeURIComponent(exportId)}/download?sha256=${encodeURIComponent(sha256)}`),
  searchWordPressExtensions: (siteId: string, kind: WordPressExtensionKind, query: string) => json<{ provider: string; results: Array<{ slug: string; name: string; description: string; imageUrl: string | null }> }>(`/wordpress-manager/extension-search?siteId=${encodeURIComponent(siteId)}&kind=${kind}&query=${encodeURIComponent(query)}`),
  listWordPressManagerConnections: () => json<{ connections: HostingerConnectionPublic[] }>("/wordpress-manager/connections"),
  createWordPressManagerConnection: (input: { name: string; token: string }) => json<{ connection: HostingerConnectionPublic }>("/wordpress-manager/connections", { method: "POST", body: JSON.stringify(input) }),
  testWordPressManagerConnection: (id: string) => json<{ ok: boolean; testedAt: string; websites: number; installations: number }>(`/wordpress-manager/connections/${encodeURIComponent(id)}/test`, { method: "POST" }),
  deleteWordPressManagerConnection: (id: string) => json<{ ok: boolean }>(`/wordpress-manager/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createWordPressAdminLink: (siteId: string) => json<{ url: string }>("/wordpress-manager/admin-link", { method: "POST", body: JSON.stringify({ siteId }) }),
  recordWordPressRecoveryPoint: (input: { connectionId: string; domain: string; label: string; confirmed: true }) => json<{ recoveryPoint: WordPressRecoveryPoint }>("/wordpress-manager/recovery-points", { method: "POST", body: JSON.stringify(input) }),
  planWordPressExtensionChange: (input: ExtensionChangeInput) => json<{ plan: WordPressExtensionPlan }>("/wordpress-manager/extension-actions/plan", { method: "POST", body: JSON.stringify(input) }),
  applyWordPressExtensionChange: (input: ExtensionChangeInput & { fingerprintSha256: string; confirmation?: string }) => json<{ plan: WordPressExtensionPlan; result: Record<string, unknown>; deployment: WordPressDeployment }>("/wordpress-manager/extension-actions/apply", { method: "POST", body: JSON.stringify(input) }),
  createHostingerWebsite: (input: { connectionId: string; domain: string; orderId: number; datacenterCode?: string; confirmation: string }) => json<{ ok: boolean; deployment: WordPressDeployment }>("/wordpress-manager/hostinger/websites", { method: "POST", body: JSON.stringify(input) }),
  listWordPressDeployments: () => json<{ deployments: WordPressDeployment[] }>("/wordpress-manager/deployments"),
  planWordPressPublish: (input: { sourceSiteId: string; connectionId: string; domain: string; mode: "new" | "replace" }) => json<{ plan: WordPressPublishPlan }>("/wordpress-manager/deployments/plan", { method: "POST", body: JSON.stringify(input) }),
  executeWordPressPublish: (input: { sourceSiteId: string; connectionId: string; domain: string; mode: "new" | "replace"; fingerprintSha256: string; confirmation: string; acknowledgeCoreUpdate?: boolean }) => json<{ plan: WordPressPublishPlan; deployment: WordPressDeployment }>("/wordpress-manager/deployments", { method: "POST", body: JSON.stringify(input) }),
  confirmWordPressDeployment: (id: string) => json<{ deployment: WordPressDeployment }>(`/wordpress-manager/deployments/${encodeURIComponent(id)}/verify`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
};
