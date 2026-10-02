#!/usr/bin/env bun
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const input = lines[Symbol.asyncIterator]();
const first = await input.next();
if (first.done) throw new Error("Zoer runner request was missing.");
const request = JSON.parse(first.value);
const grant = request.grants.runtimes?.find((entry) => entry.alias === "wordpress_site");
if (!grant?.ticket) throw new Error("WordPress runtime access was not granted.");
const operation = ({
  "site.start": "runtime.start.v1", "site.stop": "runtime.stop.v1", "snapshot.list": "snapshot.list.v1",
  "snapshot.create": "snapshot.create.v1", "snapshot.restore": "snapshot.restore.v1", "wpcli.read": "wordpress.wp-cli.read.v1",
  "backup.create": "backup.create.v1", "backup.restore": "backup.restore.v1",
})[request.action.id];
if (!operation) throw new Error("Unsupported WordPress action.");
const requestId = "wordpress-runtime-action";
const args = request.action.id === "wpcli.read" ? { args: request.input.args }
  : request.action.id === "backup.create" ? { name: request.input.name }
  : request.action.id === "backup.restore" ? { backupId: request.input.backupId, expectedManifestSha256: request.input.expectedManifestSha256 }
  : request.action.id.startsWith("snapshot.") ? { name: request.input.name }
  : undefined;
process.stdout.write(`${JSON.stringify({ protocolVersion: "1", kind: "host-call", requestId, method: "runtime.invoke", input: { alias: grant.alias, ticket: grant.ticket, operation, resourceId: request.input.siteId, ...(args ? { args } : {}) } })}\n`);
const replyLine = await input.next();
if (replyLine.done) throw new Error("Zoer host response was missing.");
const reply = JSON.parse(replyLine.value);
if (reply.kind !== "host-response" || reply.requestId !== requestId || !reply.ok) throw new Error(reply.error?.message || "Runtime call failed.");
const raw = reply.result?.output ?? reply.result?.stdout ?? reply.result?.resourceId ?? reply.result?.ok ?? reply.result;
const summary = typeof raw === "string" ? raw.slice(0, 12000) : JSON.stringify(raw).slice(0, 12000);
process.stdout.write(JSON.stringify({ protocolVersion: "1", runId: request.run.id, ok: true, output: { ok: true, summary: summary || `${request.action.id} completed.` } }), () => process.exit(0));
