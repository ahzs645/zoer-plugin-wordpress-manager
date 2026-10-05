#!/usr/bin/env bun
// Shared-service connection checks: `site.test` reads the Zoer Connect status of one endpoint
// added through `endpoints.add` (S7b: the host injects its key), or with `diagnostics: true` its
// `/diagnostics` inventory (tables, post types, themes, plugins) for the transfer panels, which
// Zoer's legacy transfer routes proxied before 0.8.0; `hostinger.check` lists
// one page of websites with one Hostinger account bound through `connections.connect` (S7a bearer auth).
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const input = lines[Symbol.asyncIterator]();
const first = await input.next();
if (first.done) throw new Error("Zoer runner request was missing.");
const request = JSON.parse(first.value);
const network = request.grants.network;
if (!network?.ticket) throw new Error("Network access was not granted.");
let ticket = network.ticket;

async function fetchThroughHost(url, auth) {
  const requestId = "wordpress-connection-check";
  process.stdout.write(`${JSON.stringify({ protocolVersion: "1", kind: "host-call", requestId, method: "network.fetch", input: { ticket, url, method: "GET", headers: { accept: "application/json" }, auth } })}\n`);
  const next = await input.next();
  if (next.done) throw new Error("Zoer host response was missing.");
  const response = JSON.parse(next.value);
  if (response.nextTicket) ticket = response.nextTicket;
  if (response.kind !== "host-response" || response.requestId !== requestId) throw new Error("Invalid Zoer host response.");
  if (!response.ok) return { refused: response.error?.message || "The request was refused." };
  let body = null;
  try { body = JSON.parse(Buffer.from(response.result.bodyBase64 || "", "base64").toString("utf8")); } catch { /* not JSON */ }
  return { status: response.result.status, body };
}
const done = (output) => process.stdout.write(JSON.stringify({ protocolVersion: "1", runId: request.run.id, ok: true, output }), () => process.exit(0));
const trim = (value) => String(value).replace(/\/+$/, "");

/** The checks Zoer applied to a pasted connection (target, version, connection key). */
function checkZoerConnectStatus(origin, answer) {
  if (answer.refused) return { ok: false, summary: answer.refused.slice(0, 500) };
  if (answer.status === 401 || answer.status === 403) return { ok: false, summary: "WordPress rejected this key. Check its version, key and permissions." };
  if (answer.status === 404 || answer.status === 410) return { ok: false, summary: "Zoer Connect was not found. Check the website address and activate the plugin in WordPress." };
  const body = answer.body;
  if (answer.status < 200 || answer.status >= 300 || !body || typeof body !== "object") return { ok: false, summary: "Zoer Connect did not answer with its status." };
  if (typeof body.target !== "string" || trim(body.target) !== trim(origin) || typeof body.version !== "string" || !/^\d+\.\d+\.\d+$/.test(body.version) || body.capabilities?.connectionKey !== true) {
    return { ok: false, summary: "The response does not match this site or Zoer Connect 0.2+." };
  }
  const pull = body.permissions?.pull === true && body.capabilities?.pull === true;
  const push = body.permissions?.push === true;
  return { ok: true, version: body.version, pull, push, stagingReady: body.stagingReady === true, summary: `Zoer Connect ${body.version}${pull ? " · Pull enabled" : ""}${push ? " · Push enabled" : ""}.` };
}

/** The diagnostics sections the transfer panels read; anything else in the answer is dropped. */
const DIAGNOSTICS_KEYS = ["wordpress", "php", "database", "postTypes", "themes", "plugins", "muPlugins", "dropins", "warnings", "pluginUpdate"];

/** Zoer Connect's `/diagnostics` answer, as Zoer's legacy route returned it (plugin A2, Zoer Connect 0.4.0+). */
function diagnosticsResult(answer) {
  if (answer.refused) return { ok: false, summary: answer.refused.slice(0, 500) };
  if (answer.status === 401 || answer.status === 403) return { ok: false, summary: "WordPress rejected this key. Check its version, key and permissions." };
  if (answer.status === 404) return { ok: false, summary: "Diagnostics need Zoer Connect 0.4.0 on this site. Update the plugin in WordPress." };
  const body = answer.body;
  if (answer.status < 200 || answer.status >= 300 || !body || typeof body !== "object" || Array.isArray(body)) return { ok: false, summary: "WordPress returned invalid diagnostics." };
  const diagnostics = Object.fromEntries(DIAGNOSTICS_KEYS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  const tables = Array.isArray(body.database?.tables) ? body.database.tables.length : 0;
  return { ok: true, summary: `Diagnostics read · ${tables} table${tables === 1 ? "" : "s"}.`, diagnostics };
}

if (request.action.id === "site.test") {
  const endpoint = (network.endpoints ?? []).flatMap((entry) => entry.alias === "site" ? entry.endpoints : []).find((entry) => entry.id === request.input.endpointId);
  const auth = endpoint && { type: "endpoint", endpointId: endpoint.id, generation: endpoint.generation };
  if (!endpoint) done({ ok: false, summary: "This site's connection was removed. Add the site again." });
  else if (request.input.diagnostics === true) done(diagnosticsResult(await fetchThroughHost(`${endpoint.origin}/wp-json/zoer-connect/v1/diagnostics`, auth)));
  else done(checkZoerConnectStatus(endpoint.origin, await fetchThroughHost(`${endpoint.origin}/wp-json/zoer-connect/v1/status`, auth)));
} else if (request.action.id === "hostinger.check") {
  const answer = await fetchThroughHost("https://developers.hostinger.com/api/hosting/v1/websites?per_page=100", { type: "bearer", connectionAlias: "hostinger", account: request.input.account });
  if (answer.refused) done({ ok: false, summary: answer.refused.slice(0, 500) });
  else if (answer.status < 200 || answer.status >= 300) done({ ok: false, summary: answer.status === 401 ? "Hostinger did not accept this sign-in. Reconnect the account." : `Hostinger answered HTTP ${answer.status}.` });
  else {
    const websites = Array.isArray(answer.body?.data) ? answer.body.data.length : 0;
    done({ ok: true, websites, summary: `Hostinger account reachable · ${websites} website${websites === 1 ? "" : "s"}.` });
  }
} else {
  throw new Error("Unsupported connection check.");
}
