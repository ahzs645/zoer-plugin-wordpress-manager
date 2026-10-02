// Shared wire types for the diagnostics snapshot, consumed by both backend and frontend.

export type RuntimeEventType =
  | "session.started"
  | "session.state.changed"
  | "session.exited"
  | "turn.started"
  | "turn.completed"
  | "content.delta"
  | "item.started"
  | "item.updated"
  | "item.completed"
  | "request.opened"
  | "request.resolved"
  | "checkpoint.created"
  | "checkpoint.diff.created"
  | "receipt.emitted"
  | "runtime.error";

export interface RuntimeEvent {
  id: string;
  type: RuntimeEventType;
  createdAt: string;
  computerId?: string;
  conversationId?: string;
  turnId?: string;
  providerInstanceId?: string | null;
  payload: Record<string, unknown>;
}

export interface TraceRecord {
  id: string;
  name: string;
  category: "http" | "runtime" | "queue" | "provider" | "system";
  createdAt: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  durationMs?: number | null;
  status?: "ok" | "error" | "pending";
  computerId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  providerInstanceId?: string | null;
  attributes?: Record<string, unknown>;
}

export type CliSessionLaunchKind =
  | "codex-exec"
  | "claude-print"
  | "opencode-run"
  | "grok-run"
  | "hermes-chat"
  | "openclaw-agent"
  | "provider-command";

export interface CliSessionLaunchRecord {
  kind: CliSessionLaunchKind;
  commandHash: string;
  redactedCommand: string;
}

export interface CliSessionRecord {
  id: string;
  computerId: string;
  conversationId: string | null;
  provider: string;
  providerInstanceId: string | null;
  status: "ready" | "running" | "error";
  mode: "recorded-cli-session";
  continuationIdentity: {
    driverKind: string;
    continuationKey: string;
    computerId: string;
    conversationId: string | null;
  };
  turnCount: number;
  /** Compatibility field. Full commands are no longer persisted. */
  lastCommand: null;
  lastLaunch: CliSessionLaunchRecord | null;
  limitations: string[];
  createdAt: string;
  updatedAt: string;
  lastTurnAt: string | null;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  process: {
    pid: number;
    uptimeSeconds: number;
    memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
    cpu: { user: number; system: number };
    node: string;
    bun: string;
    platform: string;
    arch: string;
  };
  runtime: {
    recentEvents: RuntimeEvent[];
    providerCount: number;
    warningProviders: number;
    cliSessions: CliSessionRecord[];
  };
  resources: {
    history: Array<{
      sampledAt: string;
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
      cpuUserMicros: number;
      cpuSystemMicros: number;
    }>;
  };
  traces: {
    path: string;
    recent: TraceRecord[];
  };
}
