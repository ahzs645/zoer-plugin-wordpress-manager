#!/usr/bin/env bun
// S9 managed resources (runtime:manage) for DDEV WordPress sites: create, list the trash, move to
// the trash, restore, plan the removal and remove from Zoer. Every host response, including a
// refusal, may carry the next one-use runtime ticket.
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const input = lines[Symbol.asyncIterator]();
const first = await input.next();
if (first.done) throw new Error("Zoer runner request was missing.");
const request = JSON.parse(first.value);
const grant = request.grants.runtimes?.find((entry) => entry.alias === "wordpress_site");
if (!grant?.ticket) throw new Error("WordPress runtime access was not granted.");
let ticket = grant.ticket;
let sequence = 0;

class HostCallError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function invoke(operation, resourceId, args) {
  const requestId = `wordpress-lifecycle-${sequence++}`;
  process.stdout.write(`${JSON.stringify({ protocolVersion: "1", kind: "host-call", requestId, method: "runtime.invoke", input: { alias: grant.alias, ticket, operation, ...(resourceId ? { resourceId } : {}), ...(args ? { args } : {}) } })}\n`);
  const next = await input.next();
  if (next.done) throw new Error("Zoer host response was missing.");
  const response = JSON.parse(next.value);
  if (response.nextTicket) ticket = response.nextTicket;
  if (response.kind !== "host-response" || response.requestId !== requestId) throw new Error("Invalid Zoer host response.");
  if (!response.ok) throw new HostCallError(response.error?.message || "Runtime call failed.", response.error?.code);
  return response.result;
}

const text = (value, max = 500) => String(value ?? "").slice(0, max);
const strings = (value, max) => (Array.isArray(value) ? value : []).slice(0, max).map((entry) => text(entry, 500));
function done(output) {
  process.stdout.write(JSON.stringify({ protocolVersion: "1", runId: request.run.id, ok: true, output }), () => process.exit(0));
}

const siteId = request.input?.siteId;
switch (request.action.id) {
  case "site.create": {
    const created = await invoke("runtime.create.v1", undefined, { name: request.input.name, profile: "wordpress-ddev" });
    const resource = created?.resource ?? {};
    done({ ok: true, siteId: text(resource.id, 200), summary: `${text(resource.name || request.input.name, 200)} is being prepared. It appears in the site list when DDEV reports it.` });
    break;
  }
  case "sites.trash": {
    const listed = await invoke("runtime.list.v1", undefined, { includeArchived: true });
    const sites = (Array.isArray(listed?.resources) ? listed.resources : [])
      .filter((resource) => resource?.state === "archived")
      .slice(0, 200)
      .map((resource) => ({
        id: text(resource.id, 200), name: text(resource.name || resource.id, 200), status: text(resource.status || "unknown", 40),
        archivedAt: text(resource.archivedAt, 40), scheduledPurgeAt: text(resource.scheduledPurgeAt, 40), owned: Boolean(resource.ownerPluginId),
      }));
    done({ sites });
    break;
  }
  case "site.archive": {
    const archived = await invoke("runtime.archive.v1", siteId, {});
    done({ ok: true, siteId, scheduledPurgeAt: text(archived?.scheduledPurgeAt, 40), summary: `Moved to the Zoer trash. Restore it before ${text(archived?.scheduledPurgeAt, 40) || "its scheduled purge"}.` });
    break;
  }
  case "site.restore": {
    const restored = await invoke("runtime.restore.v1", siteId, { start: request.input.start !== false });
    done({ ok: true, siteId, summary: restored?.alreadyActive ? "The site was already active." : restored?.reconciledAfterPartialSuccess ? "Restored (Zoer reconciled an interrupted restore)." : "Restored from the Zoer trash." });
    break;
  }
  case "site.removal-plan": {
    const { plan } = await invoke("runtime.removal-plan.v1", siteId, {});
    done({
      ok: true, summary: `Type ${text(plan.confirmationPhrase, 200)} to remove ${text(plan.name, 200)} from Zoer.`,
      plan: {
        resourceId: text(plan.resourceId, 200), name: text(plan.name, 200), connectorId: text(plan.connectorId, 100), operation: text(plan.operation, 100),
        confirmationPhrase: text(plan.confirmationPhrase, 200), steps: strings(plan.steps, 32), warnings: strings(plan.warnings, 32),
        retainedResources: strings(plan.retainedResources, 64), fingerprintSha256: text(plan.fingerprintSha256, 64),
      },
    });
    break;
  }
  case "site.remove": {
    const removed = await invoke("runtime.remove.v1", siteId, { fingerprintSha256: request.input.fingerprintSha256, confirmation: request.input.confirmation });
    const retained = strings(removed?.receipt?.retainedResources, 64);
    done({ ok: true, siteId, summary: `Removed from Zoer.${retained.length ? ` Retained: ${retained.join("; ")}.` : ""}`.slice(0, 2000) });
    break;
  }
  default:
    throw new Error("Unsupported WordPress lifecycle action.");
}
