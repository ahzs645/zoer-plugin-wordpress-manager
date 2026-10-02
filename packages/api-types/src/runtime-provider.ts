export type WorkspaceProviderId = "opensandbox" | "coder";

export const WORKSPACE_RESOURCE_PROFILES = {
  small: { label: "Small", requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } },
  standard: { label: "Standard", requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "2", memory: "2Gi" } },
  heavy: { label: "Heavy", requests: { cpu: "1", memory: "2Gi" }, limits: { cpu: "4", memory: "8Gi" } },
} as const;
export type WorkspaceResourceProfile = keyof typeof WORKSPACE_RESOURCE_PROFILES;

/** This describes Zoer's integration, not every feature an upstream offers. */
export interface WorkspaceProviderFeatures {
  kind: string;
  isolation: string;
  storage: string;
  terminal: "pty" | "commands";
  installedCli: boolean;
  skills: boolean;
  sharedBrowsers: boolean;
  limitations: string[];
  documentationUrl: string;
}

export interface RuntimeConnectionInput {
  provider: WorkspaceProviderId;
  name: string;
  url: string;
  /** Trusted Zoer origin reachable from computers on this server. */
  zoerOrigin?: string;
  token?: string;
  /** OpenSandbox coding image, or Coder template UUID. */
  image?: string;
  storageClass?: string;
  /** Default for new OpenSandbox computers; existing computers retain their allocation. */
  resourceProfile?: WorkspaceResourceProfile;
  /** Explicit opt-in: zero/absent disables automatic OpenSandbox suspension. */
  idleSuspendMinutes?: number;
  templateId?: string;
  enabled: boolean;
}
export interface PublicRuntimeConnection extends Omit<RuntimeConnectionInput, "token"> {
  id: string;
  hasToken: boolean;
  createdAt: string;
  computerCount: number;
}
