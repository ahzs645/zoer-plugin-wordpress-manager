// Zoer Connect requests through the host's S7b endpoint auth (`network.fetch` with
// `auth: { type: "endpoint", endpointId, generation }`): the host injects the key, pins the
// address and enforces the manifest's route table. Status mapping mirrors the legacy host engine
// (`connectorSend` in Zoer `backend/src/wordpress-connect.ts`) so both engines report the same
// messages and retry the same conditions.
import { TransferError } from "./slices.js";

export const ZOER_CONNECT_PREFIX = "/wp-json/zoer-connect/v1";

/** Plugin-provided text is shown only when short, single-line and free of filesystem paths. */
const ABSOLUTE_PATH = /(?<![\w:/.])(?:[A-Za-z]:)?(?:[\\/][\w.@~-]+){2,}[\\/]?/g;
export function safeRemoteMessage(value) {
  // eslint-disable-next-line no-control-regex -- rejects control characters in untrusted input
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) return undefined;
  return value.replace(ABSOLUTE_PATH, "[path]").trim();
}

function retryAfterMs(result) {
  if (Number.isFinite(result?.retryAfterMs)) return Math.min(300_000, Math.max(0, result.retryAfterMs));
  const header = Object.entries(result?.headers ?? {}).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
  if (typeof header !== "string") return undefined;
  if (/^\d{1,6}$/.test(header.trim())) return Math.min(300_000, Number(header.trim()) * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.min(300_000, Math.max(0, at - Date.now()));
}

const decode = (result) => Buffer.from(result?.bodyBase64 || "", "base64").toString("utf8");
function json(text) { try { return JSON.parse(text); } catch { return undefined; } }

/** Maps one `network.fetch` result for `route` the way the host engine maps HTTP responses. */
export function mapConnectResponse(route, method, result) {
  const status = result.status;
  const later = retryAfterMs(result);
  const details = later === undefined ? {} : { retryAfterMs: later };
  const imports = route.startsWith("/imports");
  if (status === 409 && !imports) {
    const error = json(decode(result).slice(0, 4096));
    let message = "WordPress could not prepare the export. Check its storage and selected resources.";
    if (error?.code === "zoer_export_blocked" && typeof error.message === "string" && error.message.length <= 250 && !/[\r\n]/.test(error.message)) message = error.message;
    throw new TransferError(message, { status, transient: /\bbusy\b|still draining/i.test(message), ...details });
  }
  if (imports && [400, 409, 413, 422, 429].includes(status)) {
    const error = json(decode(result).slice(0, 4096)) ?? {};
    if (status === 413) {
      const max = Number(error.limits?.maxBatchBytes);
      throw new TransferError("The upload request was larger than WordPress accepts.", { status, code: "zoer_import_body_limit", details: { maxBatchBytes: Number.isSafeInteger(max) && max > 0 ? max : undefined } });
    }
    const text = typeof error.code === "string" && /^zoer_import_[a-z_]{1,40}$/.test(error.code) ? safeRemoteMessage(error.message) : undefined;
    const phase = typeof error.phase === "string" && /^[a-z_]{1,40}$/.test(error.phase) ? error.phase : undefined;
    const busy = (status === 409 && /\bbusy\b/i.test(String(error.message ?? ""))) || error.code === "zoer_import_busy";
    throw new TransferError(busy ? "The destination is busy with another request. Retrying shortly." : status === 429 ? "WordPress is rate limiting requests. Retry shortly." : text ?? "WordPress could not complete this import operation. Retry or roll back using the same connection.",
      { status, transient: busy || status === 429, ...details, details: { code: typeof error.code === "string" ? error.code : undefined, phase } });
  }
  if (status < 200 || status >= 300) {
    if (status === 404 && route === "/diagnostics") throw new TransferError("Diagnostics need Zoer Connect 0.4.0 on this site. Update the plugin and test the connection.", { status });
    if (status === 404 && route === "/imports" && method === "GET") throw new TransferError("Update Zoer Connect on the destination to 0.4.0 to list imports.", { status });
    if (status === 404 && /\/(?:pause|resume|approve|cleanup)$/.test(route)) throw new TransferError("Update Zoer Connect on the destination to 0.4.0 to use this import action.", { status });
    const message = status === 401 || status === 403 ? "WordPress rejected this key. Check its version, key and permissions."
      : status === 404 || status === 410 ? (route === "/status" ? "Zoer Connect was not found. Check the website address and activate the plugin in WordPress." : "The remote export is missing or expired. Start a new pull.")
        : "WordPress could not complete this connector operation. Check its status and retry.";
    throw new TransferError(message, { status, transient: status >= 500 || status === 429, ...details });
  }
  const body = json(decode(result));
  if (body === undefined) throw new TransferError("WordPress returned an invalid connector response.");
  return body;
}

/** Host refusals of the request itself (not HTTP answers). */
function mapHostError(error) {
  if (!error || error.name !== "HostCallError") return error;
  if (["ZOER_PAUSED", "endpoint_changed"].includes(error.code)) return error;
  if (error.code === "endpoint_unbound") return new TransferError("This site's connection was removed. Add the site again in WordPress Manager.", { code: "endpoint_unbound" });
  if (error.code === "network_limit") return new TransferError("This step used its request budget. Continuing in the next step.", { code: "network_limit", transient: true, retryAfterMs: 0 });
  // Network failures (DNS, TLS, timeouts) are transient like the host engine's transport errors.
  if (!["capability_denied", "network_denied", "endpoint_route_denied", "secret_exfiltration", "invalid_request", "resource_unbound"].includes(error.code)) {
    return new TransferError("Could not reach the site. Check HTTPS, the certificate and network access; retrying.", { code: error.code, transient: true });
  }
  return new TransferError(error.message, { code: error.code });
}

/** The endpoint grant of `siteId` (alias `site`), or null when it was removed. */
export function siteEndpoint(request, siteId) {
  return (request.grants?.network?.endpoints ?? []).flatMap((entry) => entry.alias === "site" ? entry.endpoints : []).find((entry) => entry.id === siteId) ?? null;
}

export const trimSlash = (value) => String(value).replace(/\/+$/, "");

/**
 * A client bound to one endpoint and generation (the generation recorded when the job started:
 * a rotated key refuses with `endpoint_changed`, which the slice runner turns into needs-user).
 */
export function connectClient(host, endpoint, generation = endpoint.generation, counter = { requests: 0 }) {
  return {
    endpoint, generation, counter,
    /** Peer description for S3 transfers (`path` relative to the endpoint path prefix). */
    peer: (path) => ({ endpoint: { alias: "site", endpointId: endpoint.id, generation }, path: path.replace(/^\//, "") }),
    async request(route, method = "GET", payload) {
      const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
      counter.requests++;
      let result;
      try {
        result = await host.call("network.fetch", {
          url: `${trimSlash(endpoint.origin)}${ZOER_CONNECT_PREFIX}${route}`, method,
          headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
          ...(body ? { bodyBase64: body.toString("base64") } : {}),
          auth: { type: "endpoint", endpointId: endpoint.id, generation },
        });
      } catch (error) { throw mapHostError(error); }
      return mapConnectResponse(route, method, result);
    },
  };
}

/** The checks Zoer applied to a pasted connection (target, version, connection key) and the saved status shape. */
export function parseStatus(origin, body) {
  if (typeof body?.target !== "string" || trimSlash(body.target) !== trimSlash(origin) || typeof body.version !== "string" || !/^\d+\.\d+\.\d+$/.test(body.version) || body.capabilities?.connectionKey !== true) {
    throw new TransferError("The response does not match this site or Zoer Connect 0.2+.");
  }
  return body;
}
