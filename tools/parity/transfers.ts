#!/usr/bin/env bun
/**
 * Parity harness: the plugin transfer engine (0.7.0 workers) against the legacy Zoer host engine,
 * entirely in this process (docs/plugin-shared-services.md 16.5 P3.3). No servers, no network:
 *
 *   bun tools/parity/transfers.ts --zoer ~/github/zoer-wt/p3-host [--json report.json] [--only pull]
 *
 * Both engines talk to the same in-process fake Zoer Connect sites (tests/fakes/zoer-connect.ts)
 * with identical content. The legacy side runs Zoer's own `WordPressPullStore` /
 * `WordPressPushStore`; the plugin side runs the workers' slice logic over Zoer's REAL host
 * services: the S2 `DiskFileSetStore` with the plugin's declared file rules, the S3 transfer
 * service (download and adaptive `zbt1-v1` upload engines) and the fileset host calls. Compared:
 *   pull      file sets byte for byte (path, bytes, sha256, block-digest source), skipped list,
 *             remote calls in order
 *   push      import manifest, remote calls in order, destination files and database digests
 *   preview   classification per path; selective push manifest
 *   updraft   the PHP preparation bundle vs the legacy Python preparation on the same fixtures
 *             (prepared SQL bytes, files, metadata, warnings, refusal messages); needs php + python3
 *   scripts   the copy bundle's import scripts are byte-identical to the host's
 *   manifest  host validation, runtime permissions under enforcement, endpoint routes used
 * Differences must be zero or listed in ALLOWED with a reason. Exit code 0 only then.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import manifest from "../../plugin/manifest.json";
import { FakeHostError, FakeWorld } from "../../tests/fakes/host";
import { FakeZoerConnect, sampleSite, sha } from "../../tests/fakes/zoer-connect";
import { writeZip } from "../../tests/fakes/zip";

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }
const ZOER = resolve(arg("zoer") ?? process.env.ZOER_CHECKOUT ?? "");
if (!arg("zoer") && !process.env.ZOER_CHECKOUT) { console.error("Pass --zoer <Zoer checkout> (or ZOER_CHECKOUT)."); process.exit(2); }
const ONLY = arg("only");
const DATA = await mkdtemp(join(tmpdir(), "wpm-parity-"));
process.env.DATA_DIR = join(DATA, "zoer-data");
await mkdir(process.env.DATA_DIR, { recursive: true });
const z = (path: string) => import(join(ZOER, "backend/src", path));

const integration = (manifest as any).integration;
const PLUGIN = "wordpress-manager";
const KEY = "zc_" + "1".repeat(64);
const PULL = "a".repeat(32), IMPORT = "c".repeat(32), PREVIEW = "e".repeat(32);

/** Tolerated differences, each with its reason. */
export const ALLOWED: Array<{ scenario: string; check: string; reason: string }> = [
  { scenario: "push-transient", check: "remote calls in order", reason: "After a transient failure S1 runs the next slice in a new worker execution, and S3 re-reads the destination cursor (GET imports/<id>?view=upload) at the start of every execution (remote cursor authority, docs section 6). The host engine's in-process runner retried the same batch without re-reading. Same batches, same bytes; one extra read per retried slice." },
];
type Check = { scenario: string; check: string; equal: boolean; legacy?: unknown; plugin?: unknown; note?: string };
const report: Check[] = [];
const check = (scenario: string, name: string, legacy: unknown, plugin: unknown, note?: string) => {
  const equal = JSON.stringify(legacy) === JSON.stringify(plugin);
  report.push({ scenario, check: name, equal, ...(equal ? {} : { legacy, plugin }), ...(note ? { note } : {}) });
};

// -------------------------------------------------------------------------------------------
// Zoer modules
// -------------------------------------------------------------------------------------------
const [{ WordPressPullStore }, { WordPressConnectError }, { WordPressPushStore, isActivePush }, { PushUploadLimits }, store, filesetCalls, transfersCalls, service, stateStore, peers, caps, endpoints, contracts, runtimeOps] = await Promise.all([
  z("wordpress-pull.ts"), z("wordpress-connect.ts"), z("wordpress-push.ts"), z("wordpress-push-upload.ts"),
  z("filesets/store.ts"), z("host-calls/filesets.ts"), z("host-calls/transfers.ts"), z("transfers/service.ts"), z("transfers/state-store.ts"), z("transfers/peers.ts"),
  z("plugin-host-capabilities.ts"), z("manifest-extensions/endpoints.ts"), z("integration-contracts.ts"), z("runtime-operations.ts"),
]);
const requirement = integration.requiredEndpoints[0];
const RISK: Record<string, number> = { read: 0, local_write: 1, external_write: 2, destructive: 3 };

// -------------------------------------------------------------------------------------------
// Legacy engine
// -------------------------------------------------------------------------------------------
function legacyRemote(sites: Map<string, FakeZoerConnect>) {
  return async (site: string, route: string, method = "GET", payload?: unknown) => {
    const response = sites.get(site)!.handle({ method, path: route, body: payload === undefined ? undefined : Buffer.from(JSON.stringify(payload)), contentType: "application/json" });
    if (response.status < 200 || response.status >= 300) throw new WordPressConnectError(`HTTP ${response.status}`, response.status, { transient: response.status >= 500 || response.status === 429 });
    return JSON.parse(response.body.toString("utf8"));
  };
}
async function legacyPull(sites: Map<string, FakeZoerConnect>, siteId: string, root: string) {
  const site = sites.get(siteId)!;
  const pulls = new WordPressPullStore(root, legacyRemote(sites), async () => ({ url: site.options.origin, generation: "g1" }), async () => undefined);
  // The /pulls route probes the connection (GET /status) and maps the options exactly like this.
  const status = site.handle({ method: "GET", path: "/status" });
  const caps = JSON.parse(status.body.toString()).capabilities;
  const resolved = await pulls.resolveOptions(siteId, { options: { resources: { database: true, themes: true, plugins: true, media: true, muplugins: false, core: false } } });
  let job = await pulls.start(siteId, { ...resolved, pagedExport: caps.pagedExport === true && resolved.profile.core !== true, ...(caps.blockDigestExport === true ? { largeTransfer: true } : {}) }, PULL);
  job = await pulls.resume(siteId, PULL);
  for (let i = 0; i < 1000 && ["preparing", "downloading"].includes(job.status); i++) job = await pulls.step(siteId, PULL);
  const { files } = await pulls.verifiedFiles(siteId, PULL);
  const entries = await Promise.all(files.map(async (f: any) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256, ...(f.sourceSha256 ? { sourceSha256: f.sourceSha256 } : {}), blob: sha(await readFile(f.localPath)) })));
  return { pulls, job, entries };
}

// -------------------------------------------------------------------------------------------
// Plugin engine over Zoer's real S2/S3 host services
// -------------------------------------------------------------------------------------------
async function pluginWorld(sites: Record<string, FakeZoerConnect>, root: string) {
  const world = new FakeWorld();
  for (const [id, site] of Object.entries(sites)) { world.addSite(id, site); world.catalog.engine(id); }
  const files = new store.DiskFileSetStore({ root: join(root, "filesets"), resolveRules: async () => integration.fileRules, env: {} });
  filesetCalls.setFilesetHostStoreForTests(files);
  const siteFor = (url: URL) => [...world.endpoints.values()].find(e => url.href.startsWith(`${e.origin}/wp-json/zoer-connect/v1/`));
  const resolver = {
    async endpointUrl(input: { endpointId: string; path: string }) {
      const endpoint = world.endpoints.get(input.endpointId);
      if (!endpoint) throw new caps.PluginHostCapabilityError("Endpoint is not bound.", "endpoint_unbound");
      if (!endpoints.matchEndpointRequest(requirement, requirement.pathPrefix + input.path, "GET").ok && !endpoints.matchEndpointRequest(requirement, requirement.pathPrefix + input.path, "POST").ok) throw new caps.PluginHostCapabilityError("Route not declared.", "endpoint_route_denied");
      return new URL(`${endpoint.origin}/wp-json/zoer-connect/v1/${input.path}`);
    },
    async resolveRequest(input: any) {
      const endpoint = world.endpoints.get(input.endpointId)!;
      if (input.generation && input.generation !== endpoint.generation) throw new caps.PluginHostCapabilityError("The endpoint key changed.", "endpoint_changed");
      const match = endpoints.matchEndpointRequest(requirement, input.url.pathname + input.url.search, input.httpMethod);
      if (!match.ok || RISK[match.route.effect]! > RISK[input.actionEffect]!) throw new caps.PluginHostCapabilityError("Route denied.", "endpoint_route_denied");
      return { headers: { "x-zoer-connection": KEY }, secrets: [KEY], allowOutsideAllowlist: true, methodAllowed: true, maxBodyBytes: requirement.maxBodyBytes, resolveAddress: async () => "192.0.2.10" };
    },
  };
  const transport = async (input: any) => {
    const endpoint = siteFor(input.url);
    if (!endpoint) return { status: 404, headers: {}, body: Buffer.from("{}") };
    const response = endpoint.site.handle({ method: input.method, path: input.url.href.slice(`${endpoint.origin}/wp-json/zoer-connect/v1`.length), body: input.body, contentType: input.headers["content-type"] });
    return { status: response.status, headers: response.headers, body: response.body };
  };
  const transferService = service.createTransferService({ fileSets: () => files, states: new stateStore.TransferStateStore(join(root, "transfers")), peers: { ...peers.defaultPeerDependencies, endpoints: resolver, transport, resolvePublic: async () => "192.0.2.10" }, now: Date.now, random: () => 0.5 });
  const transferModule = transfersCalls.createTransfersModule(transferService);
  const executions = new Map<string, { ticket: string; context: any }>();
  const real = async (method: string, input: any, ctx: { actionId: string; runId: string; effect: string; execution: number }) => {
    const key = `${ctx.runId}:${ctx.actionId}:${ctx.execution}`;
    let execution = executions.get(key);
    if (!execution) {
      const action = integration.actions.find((a: any) => a.id === ctx.actionId);
      const broker = new caps.PluginHostCapabilityBroker({ pluginId: PLUGIN, pluginVersion: (manifest as any).version, actionId: ctx.actionId, runId: ctx.runId }, { secretBindings: [], secretValue: async () => null, actionEffect: action.effect, ttlMs: 600_000, maxNetworkRequests: action.resourceLimits?.maxNetworkRequests ?? 100 });
      const access = broker.hostCallAccess();
      execution = { ticket: access.issueServiceTicket("filesets"), context: { plugin: { id: PLUGIN, version: (manifest as any).version }, action, integration, runId: ctx.runId, access, resumable: { deadlineAt: new Date(Date.now() + 300_000).toISOString() } } };
      executions.set(key, execution);
    }
    const module = method.startsWith("transfer.") ? transferModule : filesetCalls.filesetsService;
    try {
      const response = await module.call(method, { ticket: execution.ticket, ...input }, execution.context);
      execution.ticket = response.nextTicket;
      return response.result;
    } catch (error: any) {
      if (error?.nextTicket) execution.ticket = error.nextTicket;
      throw new FakeHostError(error?.message ?? String(error), error?.code ?? "host_error");
    }
  };
  for (const method of ["fileset.create", "fileset.extend", "fileset.describe", "fileset.list", "fileset.read", "fileset.seal", "fileset.delete", "transfer.download", "transfer.upload", "transfer.state", "transfer.reset"]) world.services[method] = (input, ctx) => real(method, input, ctx);
  // network.fetch: the declared route table and route effects apply exactly as the S7b broker applies them.
  world.services["network.fetch"] = (input, ctx) => {
    const url = new URL(input.url);
    const match = endpoints.matchEndpointRequest(requirement, url.pathname + url.search, input.method);
    if (!match.ok) throw new FakeHostError(`Undeclared endpoint route ${input.method} ${url.pathname}.`, "endpoint_route_denied");
    if (RISK[match.route.effect]! > RISK[ctx.effect]!) throw new FakeHostError("Route effect exceeds the action effect.", "endpoint_route_denied");
    return world.serve("network.fetch", input, ctx.effect);
  };
  return { world, files };
}
const entriesOf = async (files: any, setId: string) => {
  const set = await files.get(PLUGIN, setId);
  return Promise.all(set.entries.map(async (e: any, index: number) => ({ path: e.path, bytes: e.bytes, sha256: e.sha256, ...(e.sourceSha256 ? { sourceSha256: e.sourceSha256 } : {}), blob: sha(await readFile(join(files.root, createHash("sha256").update(PLUGIN).digest("hex"), setId, "blobs", String(index))).catch(() => Buffer.alloc(0))) })));
};
const routesOf = (site: FakeZoerConnect) => site.log.map(l => `${l.method} ${l.route}`);

// -------------------------------------------------------------------------------------------
// Scenarios
// -------------------------------------------------------------------------------------------
async function pullScenario(name: string, make: () => FakeZoerConnect) {
  const root = join(DATA, name);
  const legacySite = make(), pluginSite = make();
  const legacy = await legacyPull(new Map([["site-1", legacySite]]), "site-1", join(root, "legacy"));
  const { world, files } = await pluginWorld({ "site-1": pluginSite }, join(root, "plugin"));
  const run = await world.run("transfer.pull", { siteId: "site-1", pullId: PULL, exportOptions: { resources: { database: true, themes: true, plugins: true, media: true, muplugins: false, core: false } } });
  if (run.status !== "succeeded") throw new Error(`${name}: plugin pull ${run.status}: ${(run as any).error?.message ?? (run as any).reason}`);
  const plugin = await entriesOf(files, `fs_${PULL}`);
  check(name, "file set (path, bytes, sha256, block-digest source, blob digest)", legacy.entries, plugin);
  const record = world.catalog.records.get(`pull:${PULL}`)!.data;
  check(name, "source and skipped list", { source: legacy.job.source, skipped: legacy.job.skipped, skippedCount: legacy.job.skippedCount }, { source: record.source, skipped: record.skipped, skippedCount: record.skippedCount });
  check(name, "pull options sent to Zoer Connect", legacy.job.options, record.options);
  check(name, "remote calls in order", routesOf(legacySite), routesOf(pluginSite));
  return { legacy, world, files, pluginSite, legacySite };
}

async function pushScenario() {
  const name = "push";
  const destination = () => new FakeZoerConnect({ origin: "https://dest.example", files: {}, existing: { "wp-content/themes/twentyone/style.css": "body{color:red}", "wp-content/plugins/akismet/akismet.php": "old" } });
  const root = join(DATA, name);
  // Legacy: pull from the source, then push that pull.
  const legacySource = sampleSite(), legacyDestination = destination();
  const sites = new Map([["site-1", legacySource], ["dest", legacyDestination]]);
  const legacyPulls = (await legacyPull(sites, "site-1", join(root, "legacy-pulls"))).pulls;
  const pushes = new WordPressPushStore(join(root, "legacy-pushes"), legacyRemote(sites), async (site: string) => ({ url: sites.get(site)!.options.origin, generation: "g1" }), legacyPulls, legacyPulls, {
    send: async (site: string, route: string, body: Buffer, contentType: string) => {
      const response = sites.get(site)!.handle({ method: "POST", path: route, body, contentType });
      if (response.status < 200 || response.status >= 300) throw new WordPressConnectError(`HTTP ${response.status}`, response.status, { transient: response.status >= 500 });
      return JSON.parse(response.body.toString());
    },
    limits: new PushUploadLimits(join(root, "limits.json")), clock: Date.now, random: () => 0.5,
  });
  legacyDestination.log.length = 0;
  let job = await pushes.start("dest", { source: { kind: "pull", sourceSiteId: "site-1", pullId: PULL }, requestId: IMPORT, confirmTarget: "https://dest.example", replacementAccepted: true });
  job = await pushes.resume("dest", IMPORT);
  for (let i = 0; i < 1000 && isActivePush(job); i++) job = await pushes.step("dest", IMPORT);
  // Plugin: pull, then push the sealed set.
  const pluginSource = sampleSite(), pluginDestination = destination();
  const { world } = await pluginWorld({ "site-1": pluginSource, dest: pluginDestination }, join(root, "plugin"));
  const pulled = await world.run("transfer.pull", { siteId: "site-1", pullId: PULL });
  if (pulled.status !== "succeeded") throw new Error(`push: plugin pull ${pulled.status}`);
  const pushed = await world.run("transfer.push", { siteId: "dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://dest.example", replacementAccepted: true });
  if (pushed.status !== "succeeded") throw new Error(`push: plugin push ${pushed.status}: ${(pushed as any).error?.message ?? (pushed as any).reason}`);
  check(name, "final phase", job.phase, (pushed as any).output.status);
  check(name, "import manifest", legacyDestination.imports.get(IMPORT)!.manifest, pluginDestination.imports.get(IMPORT)!.manifest);
  check(name, "remote calls in order", routesOf(legacyDestination), routesOf(pluginDestination));
  const digests = (site: FakeZoerConnect) => ({ database: site.database ? sha(site.database) : null, files: Object.fromEntries([...site.site.entries()].sort().map(([path, data]) => [path, sha(data)])) });
  check(name, "destination files and database after activation", digests(legacyDestination), digests(pluginDestination));
}

async function pushTransientScenario() {
  const name = "push-transient";
  const root = join(DATA, name);
  const content = () => { const site = sampleSite(); const big = Buffer.alloc(3 * 1024 * 1024 + 777); for (let i = 0; i < big.length; i++) big[i] = (i * 7 + 3) % 253; site.options.files["wp-content/uploads/2024/02/video.mp4"] = big; return site; };
  const destination = () => { const site = new FakeZoerConnect({ origin: "https://dest.example", files: {}, batchLimits: { maxBatchBytes: 1024 * 1024 } }); site.failNext(/\/batch$/, 503, 1, "0"); return site; };
  const legacySource = content(), legacyDestination = destination();
  const sites = new Map([["site-1", legacySource], ["dest", legacyDestination]]);
  const legacyPulls = (await legacyPull(sites, "site-1", join(root, "legacy-pulls"))).pulls;
  const pushes = new WordPressPushStore(join(root, "legacy-pushes"), legacyRemote(sites), async (site: string) => ({ url: sites.get(site)!.options.origin, generation: "g1" }), legacyPulls, legacyPulls, {
    send: async (site: string, route: string, body: Buffer, contentType: string) => {
      const response = sites.get(site)!.handle({ method: "POST", path: route, body, contentType });
      if (response.status < 200 || response.status >= 300) throw new WordPressConnectError(`HTTP ${response.status}`, response.status, { transient: response.status >= 500, retryAfterMs: 0 });
      return JSON.parse(response.body.toString());
    },
    limits: new PushUploadLimits(join(root, "limits.json")), clock: Date.now, random: () => 0.5,
  });
  legacyDestination.log.length = 0;
  let job = await pushes.start("dest", { source: { kind: "pull", sourceSiteId: "site-1", pullId: PULL }, requestId: IMPORT, confirmTarget: "https://dest.example", replacementAccepted: true });
  job = await pushes.resume("dest", IMPORT);
  for (let i = 0; i < 1000 && isActivePush(job); i++) { if (job.transfer?.retryAt) job.transfer.retryAt = 0; job = await pushes.step("dest", IMPORT); }
  const pluginSource = content(), pluginDestination = destination();
  const { world } = await pluginWorld({ "site-1": pluginSource, dest: pluginDestination }, join(root, "plugin"));
  await world.run("transfer.pull", { siteId: "site-1", pullId: PULL });
  pluginDestination.log.length = 0;
  const pushed = await world.run("transfer.push", { siteId: "dest", setId: `fs_${PULL}`, importId: IMPORT, confirmTarget: "https://dest.example", replacementAccepted: true });
  check(name, "final phase", job.phase, (pushed as any).output?.status);
  check(name, "slice outcomes", ["retry once, then done"], [pushed.envelopes.filter((e: any) => e.resumable === "retry").length === 1 && (pushed as any).output ? "retry once, then done" : JSON.stringify(pushed.envelopes.map((e: any) => e.resumable))]);
  const digests = (site: FakeZoerConnect) => ({ database: site.database ? sha(site.database) : null, files: Object.fromEntries([...site.site.entries()].sort().map(([path, data]) => [path, sha(data)])) });
  check(name, "destination files and database after activation", digests(legacyDestination), digests(pluginDestination));
  check(name, "batches sent (body digests in order)", legacyDestination.log.filter(l => l.route.endsWith("/batch")).map(l => l.body), pluginDestination.log.filter(l => l.route.endsWith("/batch")).map(l => l.body));
  check(name, "remote calls in order", routesOf(legacyDestination), routesOf(pluginDestination));
}

async function previewScenario() {
  const name = "preview+selective push";
  const root = join(DATA, "preview");
  const destination = () => new FakeZoerConnect({ origin: "https://dest.example", files: {}, existing: { "wp-content/themes/twentyone/style.css": "body{color:red}", "wp-content/plugins/akismet/akismet.php": "old" }, blocked: ["wp-content/uploads/empty.txt"] });
  const legacySource = sampleSite(), legacyDestination = destination();
  const sites = new Map([["site-1", legacySource], ["dest", legacyDestination]]);
  const legacyPulls = (await legacyPull(sites, "site-1", join(root, "legacy-pulls"))).pulls;
  const pushes = new WordPressPushStore(join(root, "legacy-pushes"), legacyRemote(sites), async (site: string) => ({ url: sites.get(site)!.options.origin, generation: "g1" }), legacyPulls, legacyPulls, { limits: new PushUploadLimits(join(root, "limits.json")), clock: Date.now, random: () => 0.5,
    send: async (site: string, route: string, body: Buffer, contentType: string) => JSON.parse(sites.get(site)!.handle({ method: "POST", path: route, body, contentType }).body.toString()) });
  // The host engine names the preview on its first call and continues it by that ID.
  let preview: any = await pushes.preview("dest", { source: { kind: "pull", sourceSiteId: "site-1", pullId: PULL } });
  const legacyPreviewId = preview.id;
  for (let i = 0; i < 100 && !preview.complete; i++) preview = await pushes.preview("dest", { source: { kind: "pull", sourceSiteId: "site-1", pullId: PULL }, previewId: legacyPreviewId });
  const pluginSource = sampleSite(), pluginDestination = destination();
  const { world } = await pluginWorld({ "site-1": pluginSource, dest: pluginDestination }, join(root, "plugin"));
  await world.run("transfer.pull", { siteId: "site-1", pullId: PULL });
  const run = await world.run("transfer.preview", { siteId: "dest", setId: `fs_${PULL}`, previewId: PREVIEW });
  if (run.status !== "succeeded") throw new Error(`preview ${run.status}: ${(run as any).error?.message}`);
  const pages = [...world.catalog.records.values()].filter(r => r.kind === "preview-page").sort((a, b) => a.data.page - b.data.page).flatMap(r => r.data.files);
  check(name, "classification per path", preview.files.map((f: any) => [f.path, f.state]), pages.map((f: any) => [f.path, f.state]));
  const selectedPaths = ["database.sql", "wp-content/uploads/2024/01/photo.jpg", "wp-content/plugins/akismet/akismet.php"];
  let job = await pushes.start("dest", { source: { kind: "pull", sourceSiteId: "site-1", pullId: PULL }, previewId: legacyPreviewId, selectedPaths, requestId: IMPORT, confirmTarget: "https://dest.example", replacementAccepted: true });
  job = await pushes.resume("dest", IMPORT);
  for (let i = 0; i < 1000 && isActivePush(job); i++) job = await pushes.step("dest", IMPORT);
  const pushed = await world.run("transfer.push", { siteId: "dest", setId: `fs_${PULL}`, importId: IMPORT, previewId: PREVIEW, selectedPaths, confirmTarget: "https://dest.example", replacementAccepted: true });
  check(name, "selective import manifest", legacyDestination.imports.get(IMPORT)!.manifest, pluginDestination.imports.get(IMPORT)!.manifest);
  check(name, "final phase", job.phase, (pushed as any).output?.status);
}

// -------------------------------------------------------------------------------------------
// UpdraftPlus preparation: PHP bundle vs legacy Python
// -------------------------------------------------------------------------------------------
const UPDRAFT_SQL = (() => {
  let sql = "# WordPress MySQL database backup\n# Created by UpdraftPlus\n# WordPress Version: 6.9.4\n# Home URL: http://backup.local\n# Table prefix: wp_\n# Site info: multisite=0\n";
  for (const table of ["options", "posts", "users", "usermeta"]) sql += `DROP TABLE IF EXISTS \`wp_${table}\`;\nCREATE TABLE \`wp_${table}\` (\n  \`id\` bigint NOT NULL,\n  \`value\` longtext NOT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO \`wp_${table}\` VALUES (1,'Hello\\nworld, café; \\'quoted\\''),(2,'it''s'),(-3,NULL);\n`;
  return sql;
})();
async function stageUpdraft(root: string, mutate: (component: string, entries: any[]) => void = () => {}, sql = UPDRAFT_SQL) {
  const components: any[] = [];
  for (const component of ["database", "plugins", "themes", "uploads", "others"]) {
    const dir = join(root, "parts", component); await mkdir(dir, { recursive: true });
    let data: Buffer;
    if (component === "database") data = gzipSync(sql);
    else {
      const entries: any[] = component === "others" ? [{ name: "index.php", data: "<?php" }, { name: "languages/fr.mo", data: "mo", deflate: true }, { name: "object-cache.php", data: "<?php" }] : [{ name: `${component}/` }, { name: `${component}/file.txt`, data: "content".repeat(40), deflate: true }];
      if (component === "uploads") entries.push({ name: "uploads/2024/index.php", data: "<?php // Silence is golden." });
      mutate(component, entries);
      data = writeZip(entries);
    }
    await writeFile(join(dir, "000000.part"), data);
    components.push({ component, chunks: 1, size: data.length, sha256: sha(data) });
  }
  await writeFile(join(root, "manifest.json"), JSON.stringify({ components }));
  return components;
}
async function runPython(root: string) {
  const script = join(ZOER, "backend/scripts/wordpress/prepare-updraft-copy.py");
  const proc = Bun.spawn(["python3", "-c", `import importlib.util,sys\nspec=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ntry:\n m.prepare(__import__('pathlib').Path(sys.argv[2]))\nexcept ValueError as e:\n print('ERROR:'+str(e));sys.exit(3)`, script, root], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text(); const code = await proc.exited;
  if (code !== 0) return { error: out.trim().replace(/^ERROR:/, "") || (await new Response(proc.stderr).text()).trim().split("\n").at(-1) };
  const prepared = JSON.parse(await readFile(join(root, "prepared.json"), "utf8"));
  return { metadata: prepared.metadata, warnings: prepared.warnings, files: prepared.files.map((f: any) => [f.path, f.bytes, f.sha256]), sql: sha(await readFile(join(root, "extracted/database.sql"))) };
}
async function runPhp(root: string, components: any[]) {
  const script = resolve(import.meta.dir, "../../plugin/computer/wordpress/prepare-updraft.php");
  const map = Object.fromEntries(components.map(c => [c.component, { path: join(root, "parts", c.component, "000000.part"), size: c.size, sha256: c.sha256 }]));
  const code = `define('UPDRAFT_LIBRARY',true);require ${JSON.stringify(script)};try{$p=updraft_prepare(${JSON.stringify(root)},json_decode(${JSON.stringify(JSON.stringify(map))},true));echo json_encode($p,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);}catch(UpdraftError $e){echo 'ERROR:'.$e->getMessage();exit(3);}`;
  const proc = Bun.spawn(["php", "-r", code], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text(); const exit = await proc.exited;
  if (exit !== 0) return { error: out.trim().replace(/^ERROR:/, "") || (await new Response(proc.stderr).text()).trim().split("\n").at(-1) };
  const prepared = JSON.parse(out);
  return { metadata: prepared.metadata, warnings: prepared.warnings, files: prepared.files.map((f: any) => [f.path, f.bytes, f.sha256]), sql: sha(await readFile(join(root, "extracted/database.sql"))) };
}
async function updraftScenario() {
  const name = "updraft";
  const cases: Array<[string, (component: string, entries: any[]) => void, string?]> = [
    ["valid set", () => {}],
    ["traversal", (c, e) => { if (c === "themes") e.push({ name: "../escape", data: "bad" }); }],
    ["executable upload", (c, e) => { if (c === "uploads") e.push({ name: "uploads/shell.php", data: "<?php system(1);" }); }],
    ["duplicate", (c, e) => { if (c === "plugins") e.push({ name: "plugins/file.txt", data: "dup" }); }],
    ["link", (c, e) => { if (c === "themes") e.push({ name: "themes/link", data: "/secret", mode: 0o120777 }); }],
    ["wrong root", (c, e) => { if (c === "themes") e.push({ name: "plugins/x.txt", data: "x" }); }],
    ["multisite", () => {}, UPDRAFT_SQL.replace("multisite=0", "multisite=1")],
    ["MyISAM", () => {}, UPDRAFT_SQL.replace("ENGINE=InnoDB", "ENGINE=MyISAM")],
    ["SQL expression", () => {}, UPDRAFT_SQL + "INSERT INTO `wp_usermeta` VALUES (LOAD_FILE('/secret'),1);\n"],
    ["non-root URL", () => {}, UPDRAFT_SQL.replace("http://backup.local", "http://backup.local/sub")],
  ];
  for (const [label, mutate, sql] of cases) {
    const python = join(DATA, "updraft", label.replace(/\W+/g, "-"), "python"), php = join(DATA, "updraft", label.replace(/\W+/g, "-"), "php");
    await stageUpdraft(python, mutate, sql);
    const components = await stageUpdraft(php, mutate, sql);
    check(name, label, await runPython(python), await runPhp(php, components));
  }
}

async function scriptsScenario() {
  for (const file of ["SnapshotStream.php", "SerializedReplacement.php", "Replacement.php", "import-copy.php"]) {
    const host = sha(await readFile(join(ZOER, "backend/scripts/wordpress", file)));
    const bundle = sha(await readFile(resolve(import.meta.dir, "../../plugin/computer/wordpress", file)));
    check("scripts", `${file} identical to the host engine's copy`, host, bundle);
  }
}

async function manifestScenario() {
  check("manifest", "host manifest validation", { valid: true }, contracts.validateIntegrationManifest(integration));
  // Runtime permissions under enforcement: every operation each action calls is classed and declared.
  const restore = runtimeOps.setRuntimeOperationDependencies({ permissionMode: () => "enforce" });
  try { check("manifest", "runtime permission findings (enforce)", [], runtimeOps.runtimePermissionFindings(integration)); }
  finally { restore(); }
}

const scenarios: Array<[string, () => Promise<unknown>]> = [
  ["pull", () => pullScenario("pull", () => sampleSite())],
  ["pull-paged", () => pullScenario("pull-paged", () => sampleSite("https://source.example", { pagedExport: true, pageSize: 2, exportSteps: 2 }))],
  ["push", pushScenario],
  ["push-transient", pushTransientScenario],
  ["preview", previewScenario],
  ["updraft", updraftScenario],
  ["scripts", scriptsScenario],
  ["manifest", manifestScenario],
];
let crashed = false;
for (const [id, scenario] of scenarios) {
  if (ONLY && !id.includes(ONLY)) continue;
  try { await scenario(); }
  catch (error) { crashed = true; report.push({ scenario: id, check: "ran", equal: false, note: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) }); }
}
await rm(DATA, { recursive: true, force: true });
const failures = report.filter(r => !r.equal && !ALLOWED.some(a => a.scenario === r.scenario && a.check === r.check));
for (const row of report) console.log(`${row.equal ? "same" : ALLOWED.some(a => a.scenario === row.scenario && a.check === row.check) ? "allowed" : "DIFF"}  ${row.scenario}: ${row.check}${row.equal ? "" : `\n    legacy: ${JSON.stringify(row.legacy)?.slice(0, 2000)}\n    plugin: ${JSON.stringify(row.plugin)?.slice(0, 2000)}${row.note ? `\n    ${row.note}` : ""}`}`);
const out = arg("json"); if (out) await writeFile(out, JSON.stringify({ report, allowed: ALLOWED }, null, 2));
console.log(`\n${report.length} checks, ${report.filter(r => r.equal).length} identical, ${failures.length} unexplained difference(s).`);
process.exit(failures.length || crashed ? 1 : 0);
