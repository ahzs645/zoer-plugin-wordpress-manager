import {expect,test} from "bun:test";
import manifest from "../plugin/manifest.json";
import recipe from "../zoer-plugin.json";
import pkg from "../package.json";
test("package retains WordPress identity, isolated actions, native entrypoint and source recipe",()=>{
 expect(manifest.id).toBe("wordpress-manager");expect(manifest.integration.permissions).toContain("workspace:native");expect(manifest.integration.permissions).toContain("workspace:wordpress");expect(manifest.integration.workspace.native.module).toBe("native/index.js");
 for(const action of manifest.integration.actions)expect(action.execution.kind).toBe("isolated-process");
 expect(manifest.integration.actions.map(a=>a.id)).toContain("site.start");expect(manifest.integration.actions.map(a=>a.id)).toContain("backup.restore");expect(recipe.manifest).toBe("plugin/manifest.json");expect(recipe.package).toBe("dist/package");
});
test("0.7.1 keeps the generic runtime names and adds the P3 transfer services",()=>{
 expect(manifest.version).toBe("0.7.1");expect(pkg.version).toBe(manifest.version);
 const permissions=manifest.integration.permissions;
 for(const legacy of ["runtime:wordpress:read","runtime:wordpress:lifecycle","wordpress:wp-cli:read","wordpress:snapshots","wordpress:backups"])expect(permissions).not.toContain(legacy);
 expect([...permissions].sort()).toEqual(["database:linked-register","routes:hosted","runtime:backups","runtime:commands:read","runtime:commands:write","runtime:files","runtime:lifecycle","runtime:manage","runtime:read","runtime:snapshots","workspace:catalog","workspace:filesets","workspace:native","workspace:wordpress"]);
});
test("site lifecycle actions run on S9 operations with the reviewed risk",()=>{
 const byId=Object.fromEntries(manifest.integration.actions.map(a=>[a.id,a])) as Record<string,any>;
 const ops=(id:string)=>byId[id].requiredRuntimes.flatMap((r:any)=>r.operations);
 expect(ops("site.create")).toEqual(["runtime.create.v1"]);expect(ops("site.archive")).toEqual(["runtime.archive.v1"]);expect(ops("site.restore")).toEqual(["runtime.restore.v1"]);
 expect(ops("site.removal-plan")).toEqual(["runtime.removal-plan.v1"]);expect(ops("sites.trash")).toEqual(["runtime.list.v1"]);
 expect(byId["site.remove"]).toMatchObject({effect:"destructive",approval:"always"});expect(ops("site.remove")).toContain("runtime.remove.v1");
 expect(byId["site.remove"].inputSchema.required).toEqual(["siteId","fingerprintSha256","confirmation"]);
 for(const id of ["site.create","site.archive","site.restore","site.removal-plan","site.remove","sites.trash"])expect(byId[id].requiredRuntimes[0]).toMatchObject({connectorIds:["ddev"],profiles:["wordpress-ddev"]});
 for(const id of ["site.create","site.archive","site.restore"])expect(byId[id]).toMatchObject({effect:"local_write"});
});
test("WP-CLI arguments use the host's bounds",()=>{
 const action=manifest.integration.actions.find(a=>a.id==="wpcli.read") as any;
 expect(action.inputSchema.properties.args).toMatchObject({minItems:1,maxItems:24,items:{type:"string",minLength:1,maxLength:500}});
 const pattern=new RegExp(action.inputSchema.properties.args.items.pattern);expect(pattern.test("plugin list")).toBe(true);expect(pattern.test("a\nb")).toBe(false);
});
test("Hostinger accounts and Zoer Connect sites use host connections and endpoints",()=>{
 const integration=manifest.integration as any;
 expect(integration.requiredConnections).toEqual([expect.objectContaining({alias:"hostinger",provider:"hostinger",scopes:["hosting"],multiple:true,optional:true})]);
 expect(integration.networkAllowlist).toEqual(["developers.hostinger.com"]);
 const [site]=integration.requiredEndpoints;expect(site).toMatchObject({alias:"site",pathPrefix:"/wp-json/zoer-connect/v1/",keyHeader:"x-zoer-connection",keyPattern:"^zc_[a-f0-9]{64}$",probe:"status",multiple:true});
 expect(site.routes.find((r:any)=>r.path==="status")).toEqual({path:"status",methods:["GET"],effect:"read"});
 for(const id of ["site.test","hostinger.check"]){const action=integration.actions.find((a:any)=>a.id===id);expect(action).toMatchObject({effect:"read",approval:"never",requiredCapabilities:["network-egress"]});expect(action.resourceLimits.maxNetworkRequests).toBe(2);}
});

// Operation classes of the DDEV connector (Zoer backend/src/connectors/ddev.ts) and the host operations.
const OPERATION_CLASS:Record<string,string>={"runtime.list.v1":"read","runtime.inspect.v1":"read","runtime.start.v1":"lifecycle","runtime.stop.v1":"lifecycle","runtime.create.v1":"manage","runtime.archive.v1":"manage","runtime.restore.v1":"manage","runtime.removal-plan.v1":"manage","runtime.remove.v1":"manage","runtime.exec.v1":"commands:write","database.register-linked.v1":"database",
 "wordpress.overview.v1":"read","wordpress.plugins.v1":"read","wordpress.themes.v1":"read","wordpress.users.v1":"read","wordpress.site-health.v1":"read","wordpress.core.status.v1":"read","wordpress.core.check.v1":"read","wordpress.wp-cli.read.v1":"commands:read","wordpress.core.update.v1":"commands:write","wordpress.extension.mutate.v1":"commands:write","wordpress.export.prepare.v1":"files",
 "snapshot.list.v1":"snapshots","snapshot.create.v1":"snapshots","snapshot.restore.v1":"snapshots","backup.list.v1":"backups","backup.create.v1":"backups","backup.restore.v1":"backups","export.create.v1":"files","export.step.v1":"files","export.chunk.v1":"files","export.cancel.v1":"files","files.stage.v1":"files"};
const CLASS_PERMISSION:Record<string,string>={read:"runtime:read",lifecycle:"runtime:lifecycle",manage:"runtime:manage",snapshots:"runtime:snapshots",backups:"runtime:backups","commands:read":"runtime:commands:read","commands:write":"runtime:commands:write",files:"runtime:files",database:"database:linked-register"};
test("every runtime operation an action calls is classified and its permission declared (enforced runtime permissions)",()=>{
 for(const action of manifest.integration.actions as any[])for(const runtime of action.requiredRuntimes??[])for(const operation of runtime.operations){
  const operationClass=OPERATION_CLASS[operation];expect(operationClass,`${action.id} ${operation}`).toBeDefined();
  expect(manifest.integration.permissions,`${action.id} ${operation}`).toContain(CLASS_PERMISSION[operationClass!]);
 }
});
test("P3 transfer actions are resumable with the documented effects, locks and gates",()=>{
 const byId=Object.fromEntries(manifest.integration.actions.map(a=>[a.id,a])) as Record<string,any>;
 const expectations:Record<string,[string,string,boolean]>={"transfer.pull":["local_write","when_configured",true],"transfer.local-export":["local_write","when_configured",true],"transfer.preview":["local_write","when_configured",false],"transfer.push":["external_write","always",true],"transfer.replace":["external_write","always",true],"copy.local":["local_write","when_configured",true],"backup.restore-local":["local_write","when_configured",true]};
 for(const [id,[effect,approval,locked]] of Object.entries(expectations)){
  const action=byId[id];expect(action,id).toBeDefined();expect(action).toMatchObject({effect,approval,execution:{kind:"isolated-process",handler:"worker/transfers.js"}});
  expect(action.resumable,id).toBeDefined();expect(!!action.resumable.lock,id).toBe(locked);
  if(locked)expect(action.inputSchema.required).toContain(action.resumable.lock.input);
  expect(action.inputSchema.properties.dryRun??action.inputSchema.properties.previewId).toBeDefined();
 }
 for(const id of ["transfer.push","transfer.replace"])expect(byId[id].resumable).toMatchObject({autoResume:"manual",cleanup:true,lock:{input:"siteId",group:"site-transfer"}});
 expect(byId["transfer.push.control"]).toMatchObject({effect:"external_write",approval:"always"});
 // 0.7.1: one approved control drives a rollback or cleanup to its end across slices; its own lock (per import) so it can act while the push run waits at review.
 expect(byId["transfer.push.control"].resumable).toEqual({stepTimeoutMs:180000,maxSteps:20000,maxRunHours:48,lock:{input:"importId",group:"import-control"}});
 expect(byId["transfer.push.control"].inputSchema.required).toContain("importId");
 for(const id of ["transfer.pull","transfer.push","copy.local","transfer.local-export","transfer.replace"])expect(byId[id].presets).toEqual({max:100});
 expect(byId["transfer.pull"].requiredCapabilities).toEqual(["network-egress","file-transfer"]);
});
test("file rules and command bundles ship with the package",async()=>{
 const integration=manifest.integration as any;
 expect(integration.fileRules.map((r:any)=>r.id)).toEqual(["site-export","updraft-set"]);
 const siteExport=integration.fileRules[0];expect(siteExport.executables).toMatchObject({under:["wp-content/uploads/**"],allowPlaceholders:"php-silence"});expect(siteExport.exclude).toEqual(["**/wp-config.php","wp-content/plugins/zoer-connect/**"]);
 expect(integration.hostedRoutes).toEqual({family:"wp",profile:"https-upgrade",ports:[80,9400]});
 for(const command of integration.computerCommands){
  expect(command).toMatchObject({bundle:"computer/wordpress",targets:["runtime"],effect:"local_write"});expect(command.timeoutMs).toBeLessThanOrEqual(840000);
  expect(await Bun.file(new URL(`../plugin/${command.bundle}/${command.argv[1]}`,import.meta.url)).exists()).toBe(true);
 }
 const routes=integration.requiredEndpoints[0].routes.map((r:any)=>r.path);
 for(const path of ["status","files/compare","exports","exports/{hex32}/{step|chunks|manifest|batch}","exports/paged","exports/paged/{hex32}/{step|chunks|manifest|batch}","imports","imports/{hex32}","imports/{hex32}/{step|chunks|batch|rollback|finish|pause|resume|approve|cleanup}"])expect(routes).toContain(path);
});
test("resumable transfers keep Zoer's default retry limit, which the workers assume when recording failures",async()=>{
 const {MAX_CONSECUTIVE_RETRIES}=await import("../plugin/worker/lib/slices.js");
 const resumable=manifest.integration.actions.filter((a:any)=>a.resumable) as any[];
 expect(resumable.length).toBeGreaterThan(0);
 for(const action of resumable)expect(action.resumable.retry?.maxConsecutive ?? 8).toBe(MAX_CONSECUTIVE_RETRIES);
 const writes=resumable.filter(a=>["transfer.pull","transfer.local-export","copy.local","backup.restore-local"].includes(a.id));
 // Failure history is a catalog write: only local-write actions can record it.
 for(const action of writes)expect(action.effect).toBe("local_write");
});
