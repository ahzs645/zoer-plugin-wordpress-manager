// Shared wire types for computers, consumed by both backend and frontend.

export type ComputerRuntime = "docker" | "agent-os" | "connector";
export const COMPUTER_ORCHESTRATORS = ["docker", "k8s"] as const;
export type ComputerOrchestrator = (typeof COMPUTER_ORCHESTRATORS)[number];
export type DockerRuntimeProfile = "desktop" | "headless-browser" | "wordpress-playground";
export type ComputerAiMode = "api" | "cli";
export const COMPUTER_CLI_PROVIDERS = [
  "codex",
  "claude",
  "gemini",
  "cursor",
  "taskmaster",
  "junie",
  "opencode",
  "grok",
  "hermes",
  "openclaw",
] as const;

export type ComputerCliProvider = (typeof COMPUTER_CLI_PROVIDERS)[number];

export type ComputerCliInstallState = "not-requested" | "pending" | "installing" | "installed" | "failed";
export type ComputerWorkspaceMode = "private" | "shared";

export interface ComputerCapabilities {
  files: boolean;
  terminal: boolean;
  search: boolean;
  notebooks: boolean;
  snapshots: boolean;
  desktop: boolean;
  browserPanel: boolean;
  browserAutomation: boolean;
  security: boolean;
  liveStats: boolean;
  experimental?: boolean;
  skills?: boolean;
  installedCli?: boolean;
}

export interface Computer {
  id: string;
  name: string;
  /** Project development stays in Projects; legacy Jobs ownership does not hide a computer. */
  workflowOwner?: { kind: "jobs" } | { kind: "project"; projectId: string; name: string } | null;
  status: string;
  /** Current runtime failure reason; absent on providers without diagnostics. */
  statusReason?: string | null;
  desktopPort: number;
  desktopAuthUsername: string | null;
  desktopAuthPassword: string | null;
  created: string;
  orchestrator: ComputerOrchestrator | null;
  runtime: ComputerRuntime;
  runtimeProfile: DockerRuntimeProfile | "agent-os" | string;
  runtimeConnectorId: string | null;
  agentOsAgent: string | null;
  capabilities: ComputerCapabilities;
  aiMode: ComputerAiMode;
  hostedProfileId: string | null;
  cliProvider: ComputerCliProvider | null;
  cliInstallState: ComputerCliInstallState;
  cliInstallError: string | null;
  workspaceMode: ComputerWorkspaceMode;
  sharedWorkspaceId: string | null;
  sharedWorkspaceName: string | null;
  /**
   * ISO timestamp set when the computer was archived (moved to the
   * recoverable trash). Absent/null for live computers. Archived computers
   * are excluded from the main listing and purged permanently once the
   * trash grace period elapses.
   */
  archivedAt?: string | null;
}

export interface ComputerCliStatus {
  provider: ComputerCliProvider | null;
  installState: ComputerCliInstallState;
  installed: boolean;
  authenticated: boolean | null;
  authLabel: string | null;
  version: string | null;
  status: "not-configured" | "installing" | "missing" | "needs-auth" | "ready" | "error";
  message: string;
  checkedAt: string;
}
export interface ComputerSelection {
  computerId: string | null;
}
