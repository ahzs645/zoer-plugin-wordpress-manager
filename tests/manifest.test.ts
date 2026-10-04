import {expect,test} from "bun:test";
import manifest from "../plugin/manifest.json";
import recipe from "../zoer-plugin.json";
import pkg from "../package.json";
test("package retains WordPress identity, isolated actions, native entrypoint and source recipe",()=>{
 expect(manifest.id).toBe("wordpress-manager");expect(manifest.integration.permissions).toContain("workspace:native");expect(manifest.integration.permissions).toContain("workspace:wordpress");expect(manifest.integration.workspace.native.module).toBe("native/index.js");
 for(const action of manifest.integration.actions)expect(action.execution.kind).toBe("isolated-process");
 expect(manifest.integration.actions.map(a=>a.id)).toContain("site.start");expect(manifest.integration.actions.map(a=>a.id)).toContain("backup.restore");expect(recipe.manifest).toBe("plugin/manifest.json");expect(recipe.package).toBe("dist/package");
});
test("0.6.0 uses generic runtime permission names and adds only runtime:manage",()=>{
 expect(manifest.version).toBe("0.6.0");expect(pkg.version).toBe(manifest.version);
 const permissions=manifest.integration.permissions;
 for(const legacy of ["runtime:wordpress:read","runtime:wordpress:lifecycle","wordpress:wp-cli:read","wordpress:snapshots","wordpress:backups"])expect(permissions).not.toContain(legacy);
 expect([...permissions].sort()).toEqual(["database:linked-register","runtime:backups","runtime:commands:read","runtime:lifecycle","runtime:manage","runtime:read","runtime:snapshots","workspace:native","workspace:wordpress"]);
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
