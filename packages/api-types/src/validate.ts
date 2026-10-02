// Tiny dependency-free runtime validators for core wire shapes.
//
// Design goals:
// - TOLERANT: extra/unknown object fields never fail (the backend adds
//   fields over time), and string-union fields are checked as plain
//   strings (a new runtimeProfile / status value must not fail).
// - Cheap: presence + primitive-type checks of required fields only.
// - Structured failures: `{ ok: false, path, expected, got }` so callers
//   can log actionable drift warnings.

export interface ValidationFailure {
  ok: false;
  /** JSONPath-ish location of the failing value, e.g. `$.capabilities.files`. */
  path: string;
  /** What the validator expected, e.g. `string`. */
  expected: string;
  /** What was actually there, e.g. `undefined` or `number`. */
  got: string;
}

export type ValidationResult = { ok: true } | ValidationFailure;

export type Validator = (value: unknown, path?: string) => ValidationResult;

const OK: ValidationResult = { ok: true };

function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function failure(path: string, expected: string, value: unknown): ValidationFailure {
  return { ok: false, path, expected, got: typeLabel(value) };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

export const vString: Validator = (value, path = "$") =>
  typeof value === "string" ? OK : failure(path, "string", value);

export const vNumber: Validator = (value, path = "$") =>
  typeof value === "number" ? OK : failure(path, "number", value);

export const vBoolean: Validator = (value, path = "$") =>
  typeof value === "boolean" ? OK : failure(path, "boolean", value);

export const vNull: Validator = (value, path = "$") =>
  value === null ? OK : failure(path, "null", value);

/** Accepts anything. Useful for payload blobs the frontend treats opaquely. */
export const vUnknown: Validator = () => OK;

export function vLiteral(...literals: Array<string | number | boolean | null>): Validator {
  const expected = literals.map((l) => JSON.stringify(l)).join(" | ");
  return (value, path = "$") =>
    literals.some((l) => l === value) ? OK : failure(path, expected, value);
}

/** Passes when the value is `undefined` (i.e. field absent), else defers. */
export function vOptional(inner: Validator): Validator {
  return (value, path = "$") => (value === undefined ? OK : inner(value, path));
}

/** Passes when the value is `null`, else defers. */
export function vNullable(inner: Validator): Validator {
  return (value, path = "$") => (value === null ? OK : inner(value, path));
}

export function vArray(item: Validator): Validator {
  return (value, path = "$") => {
    if (!Array.isArray(value)) return failure(path, "array", value);
    for (let i = 0; i < value.length; i++) {
      const result = item(value[i], `${path}[${i}]`);
      if (!result.ok) return result;
    }
    return OK;
  };
}

/**
 * Checks the declared fields of an object. Extra/unknown fields are
 * intentionally ignored — the backend adds fields over time.
 */
export function vObject(fields: Record<string, Validator>): Validator {
  return (value, path = "$") => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return failure(path, "object", value);
    }
    for (const key of Object.keys(fields)) {
      const result = fields[key]((value as Record<string, unknown>)[key], `${path}.${key}`);
      if (!result.ok) return result;
    }
    return OK;
  };
}

/** Passes when any option passes; reports a combined failure otherwise. */
export function vUnion(...options: Validator[]): Validator {
  return (value, path = "$") => {
    const failures: ValidationFailure[] = [];
    for (const option of options) {
      const result = option(value, path);
      if (result.ok) return OK;
      failures.push(result);
    }
    return {
      ok: false,
      path,
      expected: `one of: ${failures.map((f) => `${f.expected} (at ${f.path})`).join("; ")}`,
      got: typeLabel(value),
    };
  };
}

// ---------------------------------------------------------------------------
// Core wire-shape validators
// ---------------------------------------------------------------------------

const vComputerCapabilities = vObject({
  files: vBoolean,
  terminal: vBoolean,
  search: vBoolean,
  notebooks: vBoolean,
  snapshots: vBoolean,
  desktop: vBoolean,
  browserPanel: vBoolean,
  browserAutomation: vBoolean,
  security: vBoolean,
  liveStats: vBoolean,
  experimental: vOptional(vBoolean),
});

/**
 * Validates the `Computer` wire shape. String-union fields (status,
 * runtimeProfile, aiMode, cliProvider, ...) are checked as plain strings so
 * new backend values never fail validation.
 */
export const validateComputer: Validator = vObject({
  id: vString,
  name: vString,
  status: vString,
  desktopPort: vNumber,
  desktopAuthUsername: vNullable(vString),
  desktopAuthPassword: vNullable(vString),
  created: vString,
  orchestrator: vNullable(vString),
  runtime: vString,
  runtimeProfile: vString,
  runtimeConnectorId: vNullable(vString),
  agentOsAgent: vNullable(vString),
  capabilities: vComputerCapabilities,
  aiMode: vString,
  hostedProfileId: vNullable(vString),
  cliProvider: vNullable(vString),
  cliInstallState: vString,
  cliInstallError: vNullable(vString),
  workspaceMode: vString,
  sharedWorkspaceId: vNullable(vString),
  sharedWorkspaceName: vNullable(vString),
});

export const validateComputerArray: Validator = vArray(validateComputer);

export const validateComputerCliStatus: Validator = vObject({
  provider: vNullable(vString),
  installState: vString,
  installed: vBoolean,
  authenticated: vNullable(vBoolean),
  authLabel: vNullable(vString),
  version: vNullable(vString),
  status: vString,
  message: vString,
  checkedAt: vString,
});

const vRuntimeEvent = vObject({
  id: vString,
  type: vString,
  createdAt: vString,
  payload: vObject({}),
});

const vTraceRecord = vObject({
  id: vString,
  name: vString,
  category: vString,
  createdAt: vString,
  traceId: vString,
  spanId: vString,
});

const vCliSessionRecord = vObject({
  id: vString,
  computerId: vString,
  provider: vString,
  status: vString,
  turnCount: vNumber,
  createdAt: vString,
  updatedAt: vString,
});

const vResourceSample = vObject({
  sampledAt: vString,
  rss: vNumber,
  heapUsed: vNumber,
  heapTotal: vNumber,
  external: vNumber,
  cpuUserMicros: vNumber,
  cpuSystemMicros: vNumber,
});

export const validateDiagnosticsSnapshot: Validator = vObject({
  generatedAt: vString,
  process: vObject({
    pid: vNumber,
    uptimeSeconds: vNumber,
    memory: vObject({
      rss: vNumber,
      heapUsed: vNumber,
      heapTotal: vNumber,
      external: vNumber,
    }),
    cpu: vObject({ user: vNumber, system: vNumber }),
    node: vString,
    bun: vString,
    platform: vString,
    arch: vString,
  }),
  runtime: vObject({
    recentEvents: vArray(vRuntimeEvent),
    providerCount: vNumber,
    warningProviders: vNumber,
    cliSessions: vArray(vCliSessionRecord),
  }),
  resources: vObject({
    history: vArray(vResourceSample),
  }),
  traces: vObject({
    path: vString,
    recent: vArray(vTraceRecord),
  }),
});

/** Structured envelope: `{ error: { code, message, ... } }` */
export const validateStructuredErrorEnvelope: Validator = vObject({
  error: vObject({
    code: vString,
    message: vString,
    details: vOptional(vObject({})),
    requestId: vOptional(vString),
  }),
});

/** Legacy envelope: `{ error: "message" }` */
export const validateLegacyErrorEnvelope: Validator = vObject({
  error: vString,
});

/** Accepts either the structured or the legacy error envelope. */
export const validateErrorEnvelope: Validator = vUnion(
  validateStructuredErrorEnvelope,
  validateLegacyErrorEnvelope
);
