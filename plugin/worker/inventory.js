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

async function invoke(operation, resourceId) {
  const requestId = `wordpress-inventory-${sequence++}`;
  process.stdout.write(`${JSON.stringify({ protocolVersion: "1", kind: "host-call", requestId, method: "runtime.invoke", input: { alias: grant.alias, ticket, operation, ...(resourceId ? { resourceId } : {}) } })}\n`);
  const next = await input.next();
  if (next.done) throw new Error("Zoer host response was missing.");
  const response = JSON.parse(next.value);
  if (response.kind !== "host-response" || response.requestId !== requestId || !response.ok) throw new Error(response.error?.message || "Runtime call failed.");
  if (response.nextTicket) ticket = response.nextTicket;
  return response.result;
}

const operation = ({
  "plugins.refresh": "wordpress.plugins.v1",
  "themes.refresh": "wordpress.themes.v1",
  "users.refresh": "wordpress.users.v1",
  "health.refresh": "wordpress.site-health.v1",
  "backup.list": "backup.list.v1",
})[request.action.id];
if (!operation) throw new Error("Unsupported WordPress inventory action.");

const listed = await invoke("runtime.list.v1");
const resources = Array.isArray(listed?.resources) ? listed.resources.filter((entry) => entry.status === "running").slice(0, 8) : [];
const rows = [];
for (const resource of resources) {
  const result = await invoke(operation, resource.id);
  if (result?.error) {
    if (request.action.id === "health.refresh") rows.push({ site: String(resource.name || resource.id), test: "unavailable", label: "Site Health unavailable", status: "recommended", badge: "Zoer", description: String(result.error).slice(0, 500) });
    else if (request.action.id === "plugins.refresh" || request.action.id === "themes.refresh") rows.push({ site: String(resource.name || resource.id), name: "Unavailable", status: "error", version: "", update: "", update_version: "", auto_update: "" });
    else if (request.action.id === "users.refresh") rows.push({ site: String(resource.name || resource.id), id: "", login: "Unavailable", display_name: "", roles: "", registered: "" });
    else rows.push({ site: String(resource.name || resource.id), backup_id: "", name: `Unavailable: ${String(result.error).slice(0, 200)}`, created_at: "", database_bytes: 0, content_bytes: 0, manifest_sha256: "" });
    continue;
  }
  const source = request.action.id === "backup.list" ? result?.backups : result?.rows;
  for (const raw of Array.isArray(source) ? source.slice(0, 200) : []) {
    if (rows.length >= 200) break;
    if (request.action.id === "plugins.refresh" || request.action.id === "themes.refresh") rows.push({
      site: String(resource.name || resource.id), name: String(raw.name || ""), status: String(raw.status || "unknown"),
      version: String(raw.version || ""), update: String(raw.update || "none"), update_version: String(raw.update_version || ""), auto_update: String(raw.auto_update || "off"),
    });
    else if (request.action.id === "users.refresh") rows.push({
      site: String(resource.name || resource.id), id: String(raw.ID || ""), login: String(raw.user_login || ""),
      display_name: String(raw.display_name || ""), roles: Array.isArray(raw.roles) ? raw.roles.join(", ") : String(raw.roles || ""), registered: String(raw.user_registered || ""),
    });
    else if (request.action.id === "health.refresh") rows.push({
      site: String(resource.name || resource.id), test: String(raw.test || ""), label: String(raw.label || ""),
      status: String(raw.status || "recommended"), badge: String(raw.badge || ""), description: String(raw.description || "").slice(0, 1000),
    });
    else rows.push({
      site: String(resource.name || resource.id), backup_id: String(raw.id || ""), name: String(raw.name || ""),
      created_at: String(raw.createdAt || ""), database_bytes: Number(raw.database?.bytes || 0), content_bytes: Number(raw.content?.bytes || 0),
      manifest_sha256: String(raw.manifestSha256 || ""),
    });
  }
}
process.stdout.write(JSON.stringify({ protocolVersion: "1", runId: request.run.id, ok: true, output: { rows } }), () => process.exit(0));
