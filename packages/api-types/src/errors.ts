// Wire types for API error envelopes.
//
// Mirrors backend/src/errors.ts, which emits the structured shape:
//
//     { error: { code, message, details?, requestId? } }
//
// A handful of older routes (and some middleware) still emit the legacy
// shape:
//
//     { error: "human readable string" }
//
// Frontends should switch on `error.code` (stable) rather than parsing
// `error.message` (human-friendly, may change).

import { validateErrorEnvelope } from "./validate";

/** Well-known error codes emitted by the backend (backend/src/errors.ts). */
export const API_ERROR_CODES = {
  // Auth / access
  UNAUTHENTICATED: "unauthenticated",
  INVALID_SESSION: "invalid_session",
  FORBIDDEN: "forbidden",
  ACCESS_DISABLED: "access_disabled",

  // Input
  VALIDATION_FAILED: "validation_failed",
  INVALID_JSON: "invalid_json",
  MISSING_FIELD: "missing_field",
  INVALID_FIELD: "invalid_field",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",

  // Resources
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  ALREADY_EXISTS: "already_exists",

  // Rate limiting
  RATE_LIMITED: "rate_limited",

  // Dependencies
  DOCKER_UNAVAILABLE: "docker_unavailable",
  K8S_UNAVAILABLE: "k8s_unavailable",
  CONVEX_UNAVAILABLE: "convex_unavailable",
  AI_PROVIDER_ERROR: "ai_provider_error",
  UPSTREAM_ERROR: "upstream_error",
  CIRCUIT_OPEN: "circuit_open",

  // Generic
  INTERNAL_ERROR: "internal_error",
  NOT_IMPLEMENTED: "not_implemented",
} as const;

export type KnownApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * The backend adds codes over time; clients must tolerate unknown ones.
 * `(string & {})` keeps autocomplete for the known codes while accepting
 * any string.
 */
export type ApiErrorCode = KnownApiErrorCode | (string & {});

/** The `error` object inside a structured envelope. */
export interface StructuredApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

/** Structured envelope: `{ error: { code, message, details?, requestId? } }` */
export interface StructuredApiErrorEnvelope {
  error: StructuredApiErrorBody;
}

/** Legacy envelope still emitted by some routes: `{ error: "message" }` */
export interface LegacyApiErrorEnvelope {
  error: string;
}

export type ApiErrorEnvelope = StructuredApiErrorEnvelope | LegacyApiErrorEnvelope;

/** Normalized view over both envelope shapes. */
export interface ParsedApiError {
  /** Human-readable message (legacy `error` string, or structured `error.message`). */
  message: string;
  /** Stable machine code; absent for legacy envelopes. */
  code?: ApiErrorCode;
  details?: Record<string, unknown>;
  requestId?: string;
  /** Convenience: `details.remediation` when the backend included one. */
  remediation?: string;
  /** The original envelope as received. */
  envelope: ApiErrorEnvelope;
}

/**
 * Parse an unknown response payload into a normalized error, or return
 * `null` when the payload is not a recognizable error envelope.
 */
export function parseApiErrorEnvelope(payload: unknown): ParsedApiError | null {
  if (!validateErrorEnvelope(payload).ok) return null;
  const envelope = payload as ApiErrorEnvelope;
  if (typeof envelope.error === "string") {
    return { message: envelope.error, envelope };
  }
  const { code, message, details, requestId } = envelope.error;
  const remediation =
    details && typeof details["remediation"] === "string"
      ? (details["remediation"] as string)
      : undefined;
  return { message, code, details, requestId, remediation, envelope };
}
