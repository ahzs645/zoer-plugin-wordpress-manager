export interface AgentPackage {
  id: string; version: string; name: string; description: string; publisher: string;
  protocol: "zoer-agent-stdio-v1"; image: string;
}
export interface AgentRunner {
  id: string; name: string; packageKey: string; model: string; enabled: boolean;
  computerIds: string[]; createdAt: string;
}
export interface AgentRun {
  cliModel?: string; cliEffort?: string;
  id: string; runnerId: string; owner: string; sessionId?: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  startedAt: string; finishedAt?: string; output?: string; error?: string;
}
export interface PublicAgentRunner extends AgentRunner {
  hasCredential: boolean; status: "running" | "stopped" | "starting" | "unavailable";
}
