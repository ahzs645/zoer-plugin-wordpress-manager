import type { BrowserProvider } from "./browser-providers";
import type { CentralFileRecord } from "./central-files";

export type WordPressProvider = "ddev" | "playground" | "hostinger" | "zoer-connect";
export type WordPressExtensionKind = "plugin" | "theme";
export type WordPressExtensionOperation = "install" | "activate" | "deactivate" | "update" | "uninstall";

export interface WordPressManagedSite {
  id: string;
  provider: WordPressProvider;
  environment: "local" | "playground" | "production";
  name: string;
  /** For a local copy, the external site it was created from. */
  sourceSiteId?: string | null;
  domain: string | null;
  url: string | null;
  subdomain: string | null;
  managedUrl: string | null;
  status: string;
  wordpressVersion: string | null;
  phpVersion: string | null;
  updates: number | null;
  vulnerabilities: number | null;
  connectionId: string | null;
  username: string | null;
  softwareId: string | null;
  capabilities: {
    preview: boolean;
    admin: boolean;
    extensions: boolean;
    backups: boolean;
    deploySource: boolean;
    deployTarget: boolean;
    siteHealth: boolean;
    rollback: boolean;
  };
  limitation: string | null;
}

export interface WordPressInstalledExtension {
  securityCheckedAt?: string | null;
  securitySource?: string | null;
  kind: WordPressExtensionKind;
  slug: string;
  name: string;
  status: string;
  version: string;
  updateVersion: string;
  updateAvailable: boolean;
  autoUpdate: string;
  vulnerabilities: Array<{ title?: string; description?: string; affected_in?: string; fixed_in?: string; direct_url?: string }>;
}

export interface WordPressRecoveryPoint {
  id: string;
  connectionId: string;
  domain: string;
  label: string;
  method: "hostinger-hpanel";
  verifiedAt: string;
  createdAt: string;
}

export interface WordPressDeployment {
  id: string;
  type: "full-site" | "site-create" | "extension-change";
  sourceSiteId: string | null;
  targetSiteId: string | null;
  connectionId: string | null;
  domain: string | null;
  status: "queued" | "preparing" | "uploading" | "importing" | "verifying" | "verification_required" | "succeeded" | "failed" | "outcome_unknown";
  step: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  details: Record<string, unknown>;
}

export interface HostingerConnectionPublic {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
  status: "connected" | "error";
  lastError: string | null;
  apiVersion: string;
  /** Browser sign-ins are reported as `browser-login`; since P1.4 they are host OAuth connections. */
  authMethod?: "api-token" | "browser-login";
  /** The host OAuth connection (provider `hostinger`) behind a browser sign-in, when it is one. */
  oauthConnectionId?: string | null;
  /** Hosting usernames that identify the Hostinger account. */
  accountUsernames?: string[];
}

export interface HostingerLoginStatus {
  id: string;
  status: "starting" | "pending" | "connecting" | "connected" | "failed" | "cancelled" | "expired";
  message: string;
  expiresAt: string;
  computerId?: string;
  sessionId?: string;
  viewerUrl?: string;
  webSocketUrl?: string;
  browserProvider?: BrowserProvider;
  connectionId?: string;
}

export interface WordPressSiteDetails {
  errors?: string[];
  site: WordPressManagedSite;
  plugins: WordPressInstalledExtension[];
  themes: WordPressInstalledExtension[];
  health: Array<{ test?: string; label?: string; status?: string; badge?: string; description?: string }>;
  backups: Array<{ id?: string; name?: string; createdAt?: string; manifestSha256?: string; database?: { bytes?: number }; content?: { bytes?: number } }>;
  recoveryPoints: WordPressRecoveryPoint[];
  deployments: WordPressDeployment[];
}

export interface WordPressPortableBackup {
  id: string;
  fileName: string;
  createdAt: string;
  bytes: number;
  sha256: string;
  retention: "retained" | "not_requested" | "too_large";
  file: CentralFileRecord | null;
}

export interface WordPressExtensionPlan {
  siteId: string;
  siteName: string;
  provider: WordPressProvider;
  kind: WordPressExtensionKind;
  operation: WordPressExtensionOperation;
  slugs: string[];
  batches: string[][];
  steps: string[];
  warnings: string[];
  rollback: "automatic" | "manual-recovery-point" | "unavailable";
  recoveryPointId: string | null;
  confirmationPhrase: string | null;
  fingerprintSha256: string;
}

export interface WordPressPublishPlan {
  sourceSiteId: string;
  sourceName: string;
  connectionId: string;
  domain: string;
  username: string;
  mode: "new" | "replace";
  existingInstallationId: string | null;
  recoveryPointId: string | null;
  steps: string[];
  warnings: string[];
  confirmationPhrase: string;
  fingerprintSha256: string;
  coreCheck: Pick<WordPressCoreCheck, "installed" | "latest" | "checkedAt" | "status" | "compatible" | "supported">;
}

export interface WordPressCoreCheck {
  installed: string; latest: string; locale: string; checkedAt: string;
  status: "current" | "available" | "ahead"; compatible: boolean; requirement: string; supported: boolean;
}
export interface WordPressCoreUpdateState {
  check: WordPressCoreCheck | null;
  operation: null | { status: "running" | "succeeded" | "failed" | "interrupted"; step: string; startedAt: string; completedAt: string | null; error: string | null; backup: { manifest: { id: string }; bundle: { sha256: string; bytes: number } } | null };
}

export interface WordPressBackupRestore {
  id: string; name: string; state: "uploading" | "prepared";
  metadata: null | { wordpressVersion: string; sourceUrl: string; prefix: string; activePlugins: string | null; tables: number };
  warnings: string[]; fileCount: number;
  copy: null | { id: string; phase: "creating" | "uploading" | "importing" | "complete"; targetId?: string; targetUrl?: string; name: string; error?: string; running: boolean; index: number; totalFiles: number };
}
export interface HostingerSetupInventory {
  orders: { id: number; name: string; status: string }[];
  domains: { domain: string; status: string; assigned: boolean }[];
  websites: { domain: string; orderId: number; hasWordPress: boolean; enabled: boolean }[];
  temporaryDomainUrl: string;
}

export type WordPressUpdraftComponent = "database" | "plugins" | "themes" | "uploads" | "others";

export interface WordPressUpdraftImportManifest {
  importId: string;
  sessionName: string;
  components: Array<{
    component: WordPressUpdraftComponent;
    originalName: string;
    size: number;
    sha256: string;
    chunks: number;
  }>;
}

export interface WordPressUpdraftImportStatus {
  state: "preparing" | "prepared" | "restarting" | "applying" | "completed" | "failed";
  importId: string;
  computerId: string;
  computerStatus?: string;
  sessionName?: string;
  sourceUrl?: string;
  wordpressVersion?: string;
  warnings?: string[];
  error?: string;
}
