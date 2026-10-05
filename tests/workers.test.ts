import {expect,test} from "bun:test";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {resolve} from "node:path";

type Reply = (call: any) => any;
/** Runs one worker against a scripted Zoer host; returns its host calls and final output. */
async function runWorker(file: string, request: any, reply: Reply) {
 const child=spawn(process.execPath,[resolve(import.meta.dir,"../plugin/worker",file)],{stdio:["pipe","pipe","pipe"]});
 let stderr="";child.stderr.on("data",d=>{stderr+=d;});
 const calls:any[]=[];let output:any;
 const exited=new Promise<number>(done=>child.on("exit",code=>done(code ?? 1)));
 const lines=createInterface({input:child.stdout});
 lines.on("line",line=>{const message=JSON.parse(line);if(message.kind==="host-call"){calls.push(message);child.stdin.write(JSON.stringify({protocolVersion:"1",kind:"host-response",requestId:message.requestId,...reply(message)})+"\n");}else output=message;});
 child.stdin.write(JSON.stringify({protocolVersion:"1",run:{id:"run-1"},...request})+"\n");
 const code=await exited;lines.close();
 return {code,calls,output,stderr};
}
const runtime=(actionId:string,input:any={})=>({action:{id:actionId},input,grants:{runtimes:[{alias:"wordpress_site",ticket:"t0"}]}});

test("site lifecycle worker maps actions onto S9 operations and rotates tickets",async()=>{
 let n=0;const ok=(result:any)=>({ok:true,result,nextTicket:`t${++n}`});
 const create=await runWorker("site-lifecycle.js",runtime("site.create",{name:"Shop"}),()=>ok({resource:{id:"ddev-shop",name:"Shop"}}));
 expect(create.calls[0].input).toEqual({alias:"wordpress_site",ticket:"t0",operation:"runtime.create.v1",args:{name:"Shop",profile:"wordpress-ddev"}});
 expect(create.output.output).toMatchObject({ok:true,siteId:"ddev-shop"});
 const trash=await runWorker("site-lifecycle.js",runtime("sites.trash"),()=>ok({resources:[{id:"ddev-a",name:"A",status:"stopped",state:"archived",archivedAt:"2026-10-01T00:00:00Z",scheduledPurgeAt:"2026-10-08T00:00:00Z",ownerPluginId:"wordpress-manager"},{id:"ddev-b",name:"B",status:"running",state:"active"}]}));
 expect(trash.calls[0].input.args).toEqual({includeArchived:true});
 expect(trash.output.output.sites).toEqual([{id:"ddev-a",name:"A",status:"stopped",archivedAt:"2026-10-01T00:00:00Z",scheduledPurgeAt:"2026-10-08T00:00:00Z",owned:true}]);
 const plan={resourceId:"ddev-a",name:"A",connectorId:"ddev",operation:"remove-from-zoer",confirmationPhrase:"REMOVE FROM ZOER ddev-a",steps:["s"],warnings:["w"],retainedResources:["r"],fingerprintSha256:"f".repeat(64)};
 const planned=await runWorker("site-lifecycle.js",runtime("site.removal-plan",{siteId:"ddev-a"}),()=>ok({plan}));
 expect(planned.output.output.plan).toEqual(plan);
 const removed=await runWorker("site-lifecycle.js",runtime("site.remove",{siteId:"ddev-a",fingerprintSha256:plan.fingerprintSha256,confirmation:plan.confirmationPhrase}),()=>ok({removed:true,receipt:{retainedResources:["r"]}}));
 expect(removed.calls[0].input).toMatchObject({operation:"runtime.remove.v1",resourceId:"ddev-a",args:{fingerprintSha256:plan.fingerprintSha256,confirmation:plan.confirmationPhrase}});
 expect(removed.output.output.summary).toContain("Retained: r");
 const refused=await runWorker("site-lifecycle.js",runtime("site.archive",{siteId:"ddev-a"}),()=>({ok:false,error:{code:"capability_denied",message:"This runtime resource is managed by another owner."},nextTicket:"t9"}));
 expect(refused.code).not.toBe(0);expect(refused.stderr).toContain("managed by another owner");
});

test("inventory keeps going when one site is refused, using the refusal's next ticket",async()=>{
 const tickets:string[]=[];
 const result=await runWorker("inventory.js",{action:{id:"plugins.refresh"},input:{},grants:{runtimes:[{alias:"wordpress_sites",ticket:"t0"}]}},call=>{
  tickets.push(call.input.ticket);
  if(call.input.operation==="runtime.list.v1")return {ok:true,result:{resources:[{id:"ddev-a",name:"A",status:"running"},{id:"ddev-b",name:"B",status:"running"}]},nextTicket:"t1"};
  if(call.input.resourceId==="ddev-a")return {ok:false,error:{code:"resource_unbound",message:"Runtime resource is archived; restore it first."},nextTicket:"t2"};
  return {ok:true,result:{rows:[{name:"akismet",status:"active",version:"5"}]},nextTicket:"t3"};
 });
 expect(tickets).toEqual(["t0","t1","t2"]);
 expect(result.output.output.rows.map((r:any)=>[r.site,r.name])).toEqual([["A","Unavailable"],["B","akismet"]]);
});

test("sites.refresh reports a refused site and continues",async()=>{
 const result=await runWorker("sites.js",{action:{id:"sites.refresh"},input:{},grants:{runtimes:[{alias:"wordpress_sites",ticket:"t0"}]}},call=>{
  if(call.input.operation==="runtime.list.v1")return {ok:true,result:{resources:[{id:"ddev-a",name:"A",status:"running"}]},nextTicket:"t1"};
  return {ok:false,error:{message:"refused"},nextTicket:"t2"};
 });
 expect(result.output.output.rows).toEqual([expect.objectContaining({name:"A",wordpress:"unavailable",database:"unavailable"})]);
});

test("site.test checks the Zoer Connect status through the endpoint grant",async()=>{
 const origin="https://shop.example/blog";
 const grants={network:{ticket:"n0",allowedHosts:[],maxRequests:2,endpoints:[{alias:"site",endpoints:[{id:"ep_1",origin,label:"Shop",generation:"g1"}]}]}};
 const body=(value:any)=>({ok:true,result:{status:200,headers:{},bodyBase64:Buffer.from(JSON.stringify(value)).toString("base64")},nextTicket:"n1"});
 const good=await runWorker("connections.js",{action:{id:"site.test"},input:{endpointId:"ep_1"},grants},()=>body({target:origin+"/",version:"0.4.0",capabilities:{connectionKey:true,pull:true},permissions:{pull:true,push:false},stagingReady:true}));
 expect(good.calls[0].input).toEqual({ticket:"n0",url:`${origin}/wp-json/zoer-connect/v1/status`,method:"GET",headers:{accept:"application/json"},auth:{type:"endpoint",endpointId:"ep_1",generation:"g1"}});
 expect(good.output.output).toMatchObject({ok:true,version:"0.4.0",pull:true,push:false,stagingReady:true});
 const other=await runWorker("connections.js",{action:{id:"site.test"},input:{endpointId:"ep_1"},grants},()=>body({target:"https://other.example",version:"0.4.0",capabilities:{connectionKey:true}}));
 expect(other.output.output).toMatchObject({ok:false,summary:"The response does not match this site or Zoer Connect 0.2+."});
 const gone=await runWorker("connections.js",{action:{id:"site.test"},input:{endpointId:"ep_2"},grants},()=>body({}));
 expect(gone.calls).toEqual([]);expect(gone.output.output.ok).toBe(false);
 const refused=await runWorker("connections.js",{action:{id:"site.test"},input:{endpointId:"ep_1"},grants},()=>({ok:false,error:{code:"endpoint_changed",message:"The endpoint connection changed."},nextTicket:"n1"}));
 expect(refused.output.output).toEqual({ok:false,summary:"The endpoint connection changed."});
});

test("site.test with diagnostics reads the Zoer Connect inventory the transfer panels use (0.8.0)",async()=>{
 const origin="https://shop.example";
 const grants={network:{ticket:"n0",allowedHosts:[],maxRequests:2,endpoints:[{alias:"site",endpoints:[{id:"ep_1",origin,label:"Shop",generation:"g1"}]}]}};
 const answer=(status:number,value:any)=>({ok:true,result:{status,headers:{},bodyBase64:Buffer.from(JSON.stringify(value)).toString("base64")},nextTicket:"n1"});
 const inventory={wordpress:{version:"6.6",prefix:"wp_"},database:{tables:[{name:"wp_posts",suffix:"posts",prefixed:true,rows:3}]},postTypes:[{name:"post"}],themes:[{slug:"t"}],plugins:[{slug:"p",active:true}],secretish:"dropped"};
 const read=await runWorker("connections.js",{action:{id:"site.test"},input:{endpointId:"ep_1",diagnostics:true},grants},()=>answer(200,inventory));
 expect(read.calls.map(c=>c.input.url)).toEqual([`${origin}/wp-json/zoer-connect/v1/diagnostics`]);
 expect(read.calls[0].input.auth).toEqual({type:"endpoint",endpointId:"ep_1",generation:"g1"});
 const {secretish,...kept}=inventory;
 expect(read.output.output).toEqual({ok:true,summary:"Diagnostics read · 1 table.",diagnostics:kept});
 const old=await runWorker("connections.js",{action:{id:"site.test"},input:{endpointId:"ep_1",diagnostics:true},grants},()=>answer(404,{}));
 expect(old.output.output).toEqual({ok:false,summary:"Diagnostics need Zoer Connect 0.4.0 on this site. Update the plugin in WordPress."});
});

test("hostinger.check uses the selected bound account through host bearer auth",async()=>{
 const grants={network:{ticket:"n0",allowedHosts:["developers.hostinger.com"],maxRequests:2,connections:[{alias:"hostinger",provider:"hostinger",apiHosts:["developers.hostinger.com"],accounts:[{id:"oc_"+"a".repeat(32),label:"Agency"}]}]}};
 const result=await runWorker("connections.js",{action:{id:"hostinger.check"},input:{account:"oc_"+"a".repeat(32)},grants},()=>({ok:true,result:{status:200,headers:{},bodyBase64:Buffer.from(JSON.stringify({data:[{},{}]})).toString("base64")},nextTicket:"n1"}));
 expect(result.calls[0].input.auth).toEqual({type:"bearer",connectionAlias:"hostinger",account:"oc_"+"a".repeat(32)});
 expect(result.output.output).toEqual({ok:true,websites:2,summary:"Hostinger account reachable · 2 websites."});
});

test("transfer worker entry speaks the line protocol and needs no engine record (0.8.0)",async()=>{
 const request={action:{id:"transfer.pull"},input:{siteId:"hostinger-1",pullId:"a".repeat(32)},grants:{network:{ticket:"n0",endpoints:[]},filesets:{ticket:"f0"},catalog:{ticket:"c0"}},resumable:{step:1,checkpoint:null,attempt:0,deadlineAt:new Date(Date.now()+60_000).toISOString()}};
 const result=await runWorker("transfers.js",request,call=>({ok:true,result:{revision:3,records:[]},nextTicket:`${call.input.ticket}x`}));
 expect(result.code).toBe(0);
 // No `site-engine:` read: the site's missing endpoint is the first (and only) refusal, before any network call.
 expect(result.calls.some(c=>JSON.stringify(c.input).includes("site-engine:"))).toBe(false);
 expect(result.calls.some(c=>c.method==="network.fetch")).toBe(false);
 expect(result.output).toMatchObject({ok:false,error:{code:"endpoint_unbound"}});
});
