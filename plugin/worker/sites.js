#!/usr/bin/env bun
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const input = lines[Symbol.asyncIterator]();
const first = await input.next();
if (first.done) throw new Error("Zoer runner request was missing.");
const request = JSON.parse(first.value);
const grant = request.grants.runtimes?.find((entry) => entry.alias === "wordpress_sites");
if (!grant?.ticket) throw new Error("WordPress runtime access was not granted.");
let ticket = grant.ticket;
let sequence = 0;

async function invoke(operation, resourceId, args) {
  const requestId = `wordpress-runtime-${sequence++}`;
  process.stdout.write(`${JSON.stringify({ protocolVersion: "1", kind: "host-call", requestId, method: "runtime.invoke", input: { alias: grant.alias, ticket, operation, ...(resourceId ? { resourceId } : {}), ...(args ? { args } : {}) } })}\n`);
  const next = await input.next();
  if (next.done) throw new Error("Zoer host response was missing.");
  const response = JSON.parse(next.value);
  if (response.kind !== "host-response" || response.requestId !== requestId || !response.ok) throw new Error(response.error?.message || "Runtime call failed.");
  if (response.nextTicket) ticket = response.nextTicket;
  return response.result;
}

const listed = await invoke("runtime.list.v1");
const resources = Array.isArray(listed?.resources) ? listed.resources.slice(0, 100) : [];
const rows = [];
for (const resource of resources) {
  const overview = await invoke("wordpress.overview.v1", resource.id);
  const wp = overview?.wordpress;
  await invoke("database.register-linked.v1", resource.id, {
    name: `${resource.name} WordPress`, engine: "mariadb", database: overview?.database?.name || "db",
    resourceId: "primary",
  });
  const updateCount = (Number(wp?.pluginUpdates) || 0) + (Number(wp?.themeUpdates) || 0) + (wp?.coreUpdateAvailable ? 1 : 0);
  rows.push({
    name: String(resource.name || resource.id), status: String(resource.status || "unknown"),
    wordpress: wp?.version ? String(wp.version) : "unavailable", updates: String(updateCount),
    home: String(wp?.home || overview?.project?.primaryUrl || ""), preview: String(resource.id),
    admin: String(resource.id), database: "MariaDB · linked",
  });
}
process.stdout.write(JSON.stringify({ protocolVersion: "1", runId: request.run.id, ok: true, output: { rows } }), () => process.exit(0));
