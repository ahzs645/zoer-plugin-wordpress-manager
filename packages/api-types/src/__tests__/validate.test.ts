import { describe, expect, test } from "bun:test";
import {
  vArray,
  vBoolean,
  vLiteral,
  vNullable,
  vNumber,
  vObject,
  vOptional,
  vString,
  vUnion,
  vUnknown,
  validateComputer,
  validateComputerArray,
  validateComputerCliStatus,
  validateDiagnosticsSnapshot,
  validateErrorEnvelope,
  type ValidationResult,
} from "../validate";
import { parseApiErrorEnvelope } from "../errors";
import type { Computer, ComputerCliStatus, DiagnosticsSnapshot } from "../index";

function expectFailure(result: ValidationResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  return result;
}

describe("combinators", () => {
  test("primitives accept matching values", () => {
    expect(vString("hi").ok).toBe(true);
    expect(vNumber(3.5).ok).toBe(true);
    expect(vBoolean(false).ok).toBe(true);
    expect(vUnknown(Symbol("anything")).ok).toBe(true);
  });

  test("primitives reject with path/expected/got", () => {
    const result = expectFailure(vString(42, "$.name"));
    expect(result.path).toBe("$.name");
    expect(result.expected).toBe("string");
    expect(result.got).toBe("number");
  });

  test("null and arrays are labeled distinctly from object", () => {
    expect(expectFailure(vString(null)).got).toBe("null");
    expect(expectFailure(vString([])).got).toBe("array");
    expect(expectFailure(vString({})).got).toBe("object");
    expect(expectFailure(vString(undefined)).got).toBe("undefined");
  });

  test("vLiteral matches exact values", () => {
    const v = vLiteral("a", "b", null);
    expect(v("a").ok).toBe(true);
    expect(v(null).ok).toBe(true);
    expect(v("c").ok).toBe(false);
  });

  test("vOptional passes undefined, defers otherwise", () => {
    const v = vOptional(vString);
    expect(v(undefined).ok).toBe(true);
    expect(v("x").ok).toBe(true);
    expect(v(1).ok).toBe(false);
    expect(v(null).ok).toBe(false);
  });

  test("vNullable passes null, defers otherwise", () => {
    const v = vNullable(vString);
    expect(v(null).ok).toBe(true);
    expect(v("x").ok).toBe(true);
    expect(v(undefined).ok).toBe(false);
  });

  test("vArray validates items and reports the failing index", () => {
    const v = vArray(vNumber);
    expect(v([1, 2, 3]).ok).toBe(true);
    expect(v([]).ok).toBe(true);
    const result = expectFailure(v([1, "two"], "$.list"));
    expect(result.path).toBe("$.list[1]");
    expect(result.expected).toBe("number");
    expect(result.got).toBe("string");
    expect(expectFailure(v({})).expected).toBe("array");
  });

  test("vObject validates declared fields and reports nested paths", () => {
    const v = vObject({ id: vString, count: vNumber });
    expect(v({ id: "a", count: 1 }).ok).toBe(true);
    const missing = expectFailure(v({ id: "a" }));
    expect(missing.path).toBe("$.count");
    expect(missing.got).toBe("undefined");
    expect(expectFailure(v(null)).expected).toBe("object");
    expect(expectFailure(v([])).expected).toBe("object");
  });

  test("vObject is TOLERANT of extra/unknown fields", () => {
    const v = vObject({ id: vString });
    expect(v({ id: "a", brandNewField: { deeply: [1] }, another: 5 }).ok).toBe(true);
  });

  test("vUnion passes when any option matches", () => {
    const v = vUnion(vString, vNumber);
    expect(v("x").ok).toBe(true);
    expect(v(1).ok).toBe(true);
    const result = expectFailure(v(true));
    expect(result.expected).toContain("string");
    expect(result.expected).toContain("number");
  });
});

// Realistic fixture mirroring what backend routes serialize for a docker
// desktop computer (capabilities per getDockerRuntimeCapabilities("desktop")).
const computerFixture: Computer = {
  id: "zoer-3f2b1c",
  name: "dev-box",
  status: "running",
  desktopPort: 42731,
  desktopAuthUsername: "zoer",
  desktopAuthPassword: "s3cret",
  created: "2026-08-30T18:22:11.000Z",
  orchestrator: "docker",
  runtime: "docker",
  runtimeProfile: "desktop",
  runtimeConnectorId: null,
  agentOsAgent: null,
  capabilities: {
    files: true,
    terminal: true,
    search: true,
    notebooks: false,
    snapshots: true,
    desktop: true,
    browserPanel: true,
    browserAutomation: true,
    security: false,
    liveStats: true,
  },
  aiMode: "cli",
  hostedProfileId: null,
  cliProvider: "claude",
  cliInstallState: "installed",
  cliInstallError: null,
  workspaceMode: "shared",
  sharedWorkspaceId: "workspace-123",
  sharedWorkspaceName: "team-repo",
};

describe("validateComputer", () => {
  test("accepts a realistic computer", () => {
    expect(validateComputer(computerFixture).ok).toBe(true);
  });

  test("accepts new/unknown string values in eroded unions", () => {
    const drifted = {
      ...computerFixture,
      status: "hibernating",
      runtimeProfile: "some-brand-new-profile",
      cliProvider: "future-cli",
      cliInstallState: "queued",
    };
    expect(validateComputer(drifted).ok).toBe(true);
  });

  test("tolerates extra fields the backend adds later", () => {
    const extended = { ...computerFixture, gpu: { model: "H100" }, region: "us-east" };
    expect(validateComputer(extended).ok).toBe(true);
  });

  test("rejects missing required field with a useful path", () => {
    const { name: _name, ...rest } = computerFixture;
    const result = expectFailure(validateComputer(rest));
    expect(result.path).toBe("$.name");
    expect(result.expected).toBe("string");
    expect(result.got).toBe("undefined");
  });

  test("rejects wrong primitive type inside capabilities", () => {
    const broken = {
      ...computerFixture,
      capabilities: { ...computerFixture.capabilities, terminal: "yes" },
    };
    const result = expectFailure(validateComputer(broken));
    expect(result.path).toBe("$.capabilities.terminal");
    expect(result.expected).toBe("boolean");
  });

  test("validateComputerArray validates each element", () => {
    expect(validateComputerArray([computerFixture, computerFixture]).ok).toBe(true);
    expect(validateComputerArray([]).ok).toBe(true);
    const result = expectFailure(validateComputerArray([computerFixture, { id: 1 }]));
    expect(result.path).toBe("$[1].id");
    expect(expectFailure(validateComputerArray(computerFixture)).expected).toBe("array");
  });
});

const cliStatusFixture: ComputerCliStatus = {
  provider: "claude",
  installState: "installed",
  installed: true,
  authenticated: true,
  authLabel: "API key",
  version: "1.2.3",
  status: "ready",
  message: "claude CLI is installed and authenticated.",
  checkedAt: "2026-08-31T09:00:00.000Z",
};

describe("validateComputerCliStatus", () => {
  test("accepts a realistic cli status", () => {
    expect(validateComputerCliStatus(cliStatusFixture).ok).toBe(true);
  });

  test("accepts the not-configured shape with nulls", () => {
    const notConfigured: ComputerCliStatus = {
      provider: null,
      installState: "not-requested",
      installed: false,
      authenticated: null,
      authLabel: null,
      version: null,
      status: "not-configured",
      message: "No CLI provider configured.",
      checkedAt: "2026-08-31T09:00:00.000Z",
    };
    expect(validateComputerCliStatus(notConfigured).ok).toBe(true);
  });

  test("rejects wrong type for installed", () => {
    const result = expectFailure(
      validateComputerCliStatus({ ...cliStatusFixture, installed: "true" })
    );
    expect(result.path).toBe("$.installed");
    expect(result.expected).toBe("boolean");
  });
});

const diagnosticsFixture: DiagnosticsSnapshot = {
  generatedAt: "2026-08-31T09:05:00.000Z",
  process: {
    pid: 4242,
    uptimeSeconds: 3600.5,
    memory: { rss: 120_000_000, heapUsed: 60_000_000, heapTotal: 90_000_000, external: 2_000_000 },
    cpu: { user: 1_500_000, system: 400_000 },
    node: "v24.3.0",
    bun: "1.3.14",
    platform: "darwin",
    arch: "arm64",
  },
  runtime: {
    recentEvents: [
      {
        id: "evt-1",
        type: "turn.completed",
        createdAt: "2026-08-31T09:04:59.000Z",
        computerId: "zoer-3f2b1c",
        conversationId: "conv-9",
        payload: { durationMs: 1234 },
      },
    ],
    providerCount: 2,
    warningProviders: 0,
    cliSessions: [
      {
        id: "cli-1",
        computerId: "zoer-3f2b1c",
        conversationId: "conv-9",
        provider: "claude",
        providerInstanceId: null,
        status: "ready",
        mode: "recorded-cli-session",
        continuationIdentity: {
          driverKind: "claude-print",
          continuationKey: "abc",
          computerId: "zoer-3f2b1c",
          conversationId: "conv-9",
        },
        turnCount: 3,
        lastCommand: null,
        lastLaunch: { kind: "claude-print", commandHash: "deadbeef", redactedCommand: "claude -p [redacted]" },
        limitations: [],
        createdAt: "2026-08-31T08:00:00.000Z",
        updatedAt: "2026-08-31T09:00:00.000Z",
        lastTurnAt: "2026-08-31T09:00:00.000Z",
      },
    ],
  },
  resources: {
    history: [
      {
        sampledAt: "2026-08-31T09:04:00.000Z",
        rss: 118_000_000,
        heapUsed: 58_000_000,
        heapTotal: 90_000_000,
        external: 2_000_000,
        cpuUserMicros: 1_400_000,
        cpuSystemMicros: 380_000,
      },
    ],
  },
  traces: {
    path: "/var/zoer/traces.jsonl",
    recent: [
      {
        id: "trace-rec-1",
        name: "GET /api/computers",
        category: "http",
        createdAt: "2026-08-31T09:04:58.000Z",
        traceId: "t-1",
        spanId: "s-1",
        durationMs: 12,
        status: "ok",
      },
    ],
  },
};

describe("validateDiagnosticsSnapshot", () => {
  test("accepts a realistic snapshot", () => {
    expect(validateDiagnosticsSnapshot(diagnosticsFixture).ok).toBe(true);
  });

  test("accepts unknown event types and extra sections", () => {
    const drifted = {
      ...diagnosticsFixture,
      runtime: {
        ...diagnosticsFixture.runtime,
        recentEvents: [
          { id: "evt-2", type: "some.future.event", createdAt: "2026-08-31T09:05:01.000Z", payload: {} },
        ],
      },
      queues: { depth: 0 },
    };
    expect(validateDiagnosticsSnapshot(drifted).ok).toBe(true);
  });

  test("rejects a snapshot missing process info", () => {
    const { process: _process, ...rest } = diagnosticsFixture;
    const result = expectFailure(validateDiagnosticsSnapshot(rest));
    expect(result.path).toBe("$.process");
    expect(result.expected).toBe("object");
  });
});

describe("error envelopes", () => {
  const structured = {
    error: {
      code: "not_found",
      message: "Computer zoer-404 not found",
      details: { computerId: "zoer-404" },
      requestId: "req-abc123",
    },
  };
  const legacy = { error: "Authentication required" };

  test("validateErrorEnvelope accepts both shapes", () => {
    expect(validateErrorEnvelope(structured).ok).toBe(true);
    expect(validateErrorEnvelope(legacy).ok).toBe(true);
    expect(validateErrorEnvelope({ error: { message: "no code" } }).ok).toBe(false);
    expect(validateErrorEnvelope({ ok: false }).ok).toBe(false);
    expect(validateErrorEnvelope("plain text").ok).toBe(false);
    expect(validateErrorEnvelope(null).ok).toBe(false);
  });

  test("validateErrorEnvelope tolerates extra fields and unknown codes", () => {
    const drifted = {
      error: {
        code: "brand_new_code",
        message: "msg",
        remediationHint: "try again",
      },
      meta: { version: 2 },
    };
    expect(validateErrorEnvelope(drifted).ok).toBe(true);
  });

  test("parseApiErrorEnvelope normalizes the structured shape", () => {
    const parsed = parseApiErrorEnvelope(structured);
    expect(parsed).not.toBeNull();
    expect(parsed!.message).toBe("Computer zoer-404 not found");
    expect(parsed!.code).toBe("not_found");
    expect(parsed!.details).toEqual({ computerId: "zoer-404" });
    expect(parsed!.requestId).toBe("req-abc123");
    expect(parsed!.remediation).toBeUndefined();
    expect(parsed!.envelope).toBe(structured);
  });

  test("parseApiErrorEnvelope surfaces details.remediation when present", () => {
    const parsed = parseApiErrorEnvelope({
      error: {
        code: "docker_unavailable",
        message: "Docker daemon is not reachable",
        details: { remediation: "Start Docker Desktop and retry." },
      },
    });
    expect(parsed!.remediation).toBe("Start Docker Desktop and retry.");
  });

  test("parseApiErrorEnvelope normalizes the legacy shape", () => {
    const parsed = parseApiErrorEnvelope(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.message).toBe("Authentication required");
    expect(parsed!.code).toBeUndefined();
    expect(parsed!.envelope).toBe(legacy);
  });

  test("parseApiErrorEnvelope returns null for non-envelopes", () => {
    expect(parseApiErrorEnvelope("500 oops")).toBeNull();
    expect(parseApiErrorEnvelope({ message: "nope" })).toBeNull();
    expect(parseApiErrorEnvelope(undefined)).toBeNull();
  });
});
