// Zoer worker line protocol (one JSON object per line) and one-use grant tickets.
//
// Every host call consumes the ticket of its grant and every response, including a refusal,
// may carry the next one (docs/plugin-shared-services.md section 3). `createLineHost` keeps the
// current ticket per grant so the transfer libraries only name a method and its input; tests and
// the parity harness pass their own `host` with the same `call(method, input)` shape.
import { createInterface } from "node:readline";

export class HostCallError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "HostCallError";
    this.code = code || "host_error";
    if (details) this.details = details;
  }
}

/** The grant a host method draws its ticket from (`null`: no ticket). */
export function grantOf(method, input) {
  if (method === "network.fetch") return "network";
  if (method === "run.progress") return null;
  if (method.startsWith("fileset.") || method.startsWith("archive.") || method.startsWith("transfer.")) return "filesets";
  if (method.startsWith("catalog.")) return "catalog";
  if (method.startsWith("routes.")) return "routes";
  if (method === "runtime.invoke") return `runtime:${input?.alias ?? ""}`;
  return null;
}

/** Initial tickets from `request.grants`. */
export function ticketsFrom(grants = {}) {
  const tickets = new Map();
  if (grants.network?.ticket) tickets.set("network", grants.network.ticket);
  if (grants.filesets?.ticket) tickets.set("filesets", grants.filesets.ticket);
  if (grants.catalog?.ticket) tickets.set("catalog", grants.catalog.ticket);
  if (grants.routes?.ticket) tickets.set("routes", grants.routes.ticket);
  for (const runtime of grants.runtimes ?? []) if (runtime?.alias && runtime.ticket) tickets.set(`runtime:${runtime.alias}`, runtime.ticket);
  return tickets;
}

/**
 * A host over an exchange function `(message) => Promise<response>`; the line transport below
 * and the scripted transports of tests both use it.
 */
export function createTicketHost(request, exchange) {
  const tickets = ticketsFrom(request.grants);
  let sequence = 0;
  let pause = null;
  return {
    request,
    /** The last pause notice Zoer sent with a host response (user pause, cancel or drain), else null. */
    get pauseRequested() { return pause; },
    async call(method, input = {}) {
      const grant = grantOf(method, input);
      if (grant && !tickets.has(grant)) throw new HostCallError(`This action has no ${grant.replace(/^runtime:/, "runtime ")} grant.`, "capability_denied");
      const requestId = `wpm-${sequence++}`;
      const response = await exchange({ protocolVersion: "1", kind: "host-call", requestId, method, input: grant ? { ...input, ticket: tickets.get(grant) } : input });
      if (grant && response?.nextTicket) tickets.set(grant, response.nextTicket);
      if (!response || response.kind !== "host-response" || response.requestId !== requestId) throw new HostCallError("Invalid Zoer host response.", "protocol_error");
      if (response.pause && typeof response.pause === "object") pause = response.pause;
      if (!response.ok) throw new HostCallError(response.error?.message || `${method} was refused.`, response.error?.code, response.error?.details);
      return response.result;
    },
  };
}

/** Reads the runner request from stdin and returns a host speaking the line protocol. */
export async function openLineHost() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const input = lines[Symbol.asyncIterator]();
  const first = await input.next();
  if (first.done) throw new Error("Zoer runner request was missing.");
  const request = JSON.parse(first.value);
  const host = createTicketHost(request, async (message) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
    const next = await input.next();
    if (next.done) throw new HostCallError("Zoer host response was missing.", "protocol_error");
    return JSON.parse(next.value);
  });
  return { request, host, close: () => lines.close() };
}

/** Writes the final runner response and exits. */
export function finish(request, response) {
  const body = response.ok
    ? { protocolVersion: "1", runId: request.run?.id, ok: true, output: response.output }
    : { protocolVersion: "1", runId: request.run?.id, ok: false, error: response.error };
  process.stdout.write(`${JSON.stringify(body)}\n`, () => process.exit(0));
}
