import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HostingerConnectionPublic, type WordPressDeployment } from "../../lib/api";
import { wordpressQueries } from "../../lib/queries/wordpress";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { StatusBadge as StatusBadge } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";
import { hostingerPlanOptions, hostingerTestSites, type HostingerTestSite } from "./hostingerTestSites";

const radioClass = "flex cursor-pointer items-start gap-2 rounded-md border border-border-muted p-2.5 has-[:checked]:border-accent has-[:checked]:bg-surface-secondary";

/**
 * Creates a Hostinger website on any connected account. "WordPress with Zoer Connect" has Zoer set up
 * WordPress, install and pair Zoer Connect, so the site appears in Push to live; "Empty website" is
 * the earlier target for publishing through Hostinger's import.
 */
export default function HostingerWebsiteSetup({connections,onCreated,newSite=false,intro,createLabel,onStarted,confirmText}:{connections:HostingerConnectionPublic[];onCreated:()=>void;/** In New site: always WordPress with Zoer Connect, a temporary domain ready, no destination tools. */newSite?:boolean;
  /** newSite: replaces the explanation above the form. */intro?:React.ReactNode;/** newSite: the create button's label. */createLabel?:string;
  /** Called with the receipt once Hostinger accepted the website (Create a live site continues from it). */onStarted?:(deployment:WordPressDeployment)=>void|Promise<void>;/** The confirmation dialog's text. */confirmText?:string}) {
  const dialogs=useDialogs();
  const queryClient=useQueryClient();
  const [plan,setPlan]=useState("");
  const [kind,setKind]=useState<"wordpress"|"empty">("wordpress");
  const [domainMode,setDomainMode]=useState("temporary");
  const [domain,setDomain]=useState("");
  const [adminEmail,setAdminEmail]=useState("");
  const [datacenter,setDatacenter]=useState("");
  const [busy,setBusy]=useState<string|null>(null); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  const inventories=useQueries({queries:connections.map(connection=>({queryKey:["wordpress","hostinger-setup",connection.id],queryFn:()=>api.getHostingerSetupInventory(connection.id),staleTime:0}))});
  const inventoryById=Object.fromEntries(connections.map((connection,index)=>[connection.id,inventories[index]?.data]));
  const plans=hostingerPlanOptions(connections,inventoryById);
  const chosen=plans.find(option=>option.value===plan);
  const connection=chosen?.connectionId??"";
  const inventory=connection?inventoryById[connection]:undefined;
  const loading=inventories.some(query=>query.isFetching);
  const failures=connections.flatMap((item,index)=>inventories[index]?.error?[`${item.name}: ${inventories[index]!.error instanceof Error?inventories[index]!.error!.message:"inventory unavailable"}`]:[]);
  const deployments=useQuery({...wordpressQueries.deployments(),refetchInterval:query=>hostingerTestSites(query.state.data??[]).some(site=>site.running)?5_000:false});
  const sites=useMemo(()=>hostingerTestSites(deployments.data??[]).filter(site=>!site.deleted&&connections.some(item=>item.id===site.connectionId)),[deployments.data,connections]);
  // The single active plan is the obvious choice; with several accounts or plans the user picks.
  useEffect(()=>{const active=plans.filter(option=>!option.disabled);if(!plan&&active.length===1)setPlan(active[0]!.value);},[plan,plans]);
  // New site: the temporary domain is generated as soon as the plan is known, so creating is one step.
  const generatedFor=useRef("");
  useEffect(()=>{
    if(!newSite||domainMode!=="temporary"||!connection||domain||busy||generatedFor.current===plan)return;
    generatedFor.current=plan;void generateTemporaryDomain();
  },[newSite,domainMode,connection,domain,busy,plan]); // eslint-disable-line react-hooks/exhaustive-deps
  // A site that just became ready is a new Push to live destination.
  const ready=useRef<Set<string>|null>(null);
  useEffect(()=>{
    const now=new Set(sites.filter(site=>site.ready).map(site=>site.id));
    if(ready.current&&[...now].some(id=>!ready.current!.has(id))){void queryClient.invalidateQueries({queryKey:["wordpress-manager","publish-destinations"]});onCreated();}
    ready.current=now;
  },[sites,queryClient,onCreated]);

  async function generateTemporaryDomain() {
    if(busy||!connection)return;
    setBusy("domain");setError("");setNotice("");
    try {setDomain((await api.generateHostingerTemporaryDomain(connection)).domain);}
    catch(e){setError(e instanceof Error?e.message:"Temporary domain generation failed.");}
    finally{setBusy(null);}
  }
  async function create() {
    if(busy||!chosen||!domain)return;
    const name=domain.trim().toLowerCase();const phrase=`CREATE ${name}`;
    const typed=await dialogs.prompt({title:`Create ${name}?`,description:confirmText??(kind==="wordpress"?"Hostinger creates the website and installs WordPress, then Zoer installs and pairs Zoer Connect. This takes about 5 to 15 minutes. The site then appears in Push to live.":"Creates an empty website on the selected hosting plan. You can then publish a local WordPress site to it."),label:`Type ${phrase}`,submitLabel:"Create website"});
    if(typed!==phrase)return;
    setBusy("create");setError("");setNotice("");
    try{
      if(kind==="wordpress"){const {deployment}=await api.startHostingerTestSite(chosen.connectionId,{domain:name,orderId:chosen.orderId,adminEmail:adminEmail.trim()||undefined,datacenterCode:datacenter||undefined,confirmation:typed});setNotice(`Setting up ${name}. You can leave this page; progress is shown below.`);await onStarted?.(deployment);}
      else{await api.createHostingerWebsite({connectionId:chosen.connectionId,domain:name,orderId:chosen.orderId,datacenterCode:datacenter||undefined,confirmation:typed});setNotice("Website creation queued. Refresh destinations after Hostinger finishes setup.");}
      setDomain("");await deployments.refetch();void inventories.find((_,index)=>connections[index]?.id===chosen.connectionId)?.refetch();onCreated();
    }
    catch(e){setError(e instanceof Error?e.message:"Website creation failed.");}finally{setBusy(null);}
  }
  async function retry(site:HostingerTestSite) {
    setBusy(`retry:${site.id}`);setError("");
    try{await api.retryHostingerTestSite(site.connectionId,site.id);await deployments.refetch();}
    catch(e){setError(e instanceof Error?e.message:"Could not continue the setup.");}finally{setBusy(null);}
  }
  async function remove(site:HostingerTestSite) {
    const phrase=`DELETE ${site.domain}`;
    const typed=await dialogs.prompt({title:`Delete ${site.domain}?`,description:"Hostinger permanently deletes the website with its files and database, and Zoer removes its connection. This cannot be undone.",label:`Type ${phrase}`,submitLabel:"Delete website"});
    if(typed!==phrase)return;
    setBusy(`delete:${site.id}`);setError("");setNotice("");
    try{await api.deleteHostingerTestSite(site.connectionId,site.id,typed);setNotice(`Hostinger is deleting ${site.domain}. It can take a few minutes to disappear from hPanel.`);await deployments.refetch();void queryClient.invalidateQueries({queryKey:["wordpress-manager","publish-destinations"]});onCreated();}
    catch(e){setError(e instanceof Error?e.message:"Could not delete the website.");}finally{setBusy(null);}
  }

  return <section className={newSite?"space-y-3":"space-y-3 rounded-md border border-border-default p-3"} aria-label="Create Hostinger destination">{!newSite&&<h4 className="text-sm font-semibold text-text-heading">Create Hostinger website</h4>}
    {newSite&&intro?intro:newSite?<p className="text-[12px] leading-5 text-text-secondary">Hostinger creates the website with WordPress, then Zoer installs and pairs <strong>Zoer Connect</strong>, so you can push to it and pull from it. About 5 to 15 minutes; it keeps going if you close this window.</p>:<fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-1 text-sm">What to create</legend>
      <label className={radioClass}><input type="radio" name="hostinger-site-kind" className="mt-1" checked={kind==="wordpress"} disabled={!!busy} onChange={()=>setKind("wordpress")} /><span><span className="block text-sm font-medium">WordPress with Zoer Connect</span><span className="block text-xs text-text-secondary">Ready for Push to live from a local copy.</span></span></label>
      <label className={radioClass}><input type="radio" name="hostinger-site-kind" className="mt-1" checked={kind==="empty"} disabled={!!busy} onChange={()=>setKind("empty")} /><span><span className="block text-sm font-medium">Empty website</span><span className="block text-xs text-text-secondary">For publishing through Hostinger's import.</span></span></label>
    </fieldset>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block min-w-0 text-sm">{connections.length>1?"Account and hosting plan":"Hosting plan"}<Select searchable aria-label="Hostinger hosting plan" value={plan} disabled={!!busy||(loading&&!plans.length)} onChange={e=>{setPlan(e.target.value);setDomain("");setNotice("");}}><option value="">{loading&&!plans.length?"Loading plans…":"Choose a hosting plan"}</option>{plans.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</Select></label>
      <label className="block text-sm">Domain<Select aria-label="Hostinger destination domain option" value={domainMode} disabled={!!busy} onChange={e=>{setDomainMode(e.target.value);setDomain("");}}><option value="temporary">Temporary domain</option><option value="account">Domain from account</option><option value="custom">Other owned domain</option></Select></label>
      {domainMode==="temporary" ? <div className="min-w-0 space-y-2 text-sm sm:col-span-2"><p className="text-text-secondary">A free temporary domain to review the site. You can connect your own domain later.</p>{domain&&<p className="break-all font-medium" role="status">{domain}</p>}<Btn disabled={!connection||!!busy} loading={busy==="domain"} onClick={()=>void generateTemporaryDomain()}>{domain?"Generate another domain":"Generate temporary domain"}</Btn></div>
        : domainMode==="account" ? <label className="block min-w-0 text-sm sm:col-span-2">Account domain<Select searchable aria-label="Hostinger account domain" value={domain} disabled={!!busy||!inventory} onChange={e=>setDomain(e.target.value)}><option value="">Choose unassigned domain</option>{inventory?.domains.map(d=><option key={d.domain} value={d.domain} disabled={d.assigned||d.status!=="active"}>{d.domain}{d.assigned?" · already assigned":""}</option>)}</Select></label>
        : <label className="block text-sm sm:col-span-2">Owned domain<input aria-label="New website domain" className={controlClass()} value={domain} disabled={!!busy} onChange={e=>setDomain(e.target.value)} placeholder="example.com" /></label>}
      {kind==="wordpress"&&<label className="block text-sm sm:col-span-2">Administrator email<input aria-label="Administrator email" type="email" className={controlClass()} value={adminEmail} disabled={!!busy} onChange={e=>setAdminEmail(e.target.value)} placeholder="Leave empty to use the one on this account's other sites" /></label>}
    </div>
    <details><summary data-zoer-disclosure="" className="cursor-pointer py-1 text-[13px] text-text-secondary">Advanced</summary><label className="mt-2 block text-sm">Datacenter code (only for an account's first website)<input aria-label="Datacenter code" className={controlClass()} value={datacenter} disabled={!!busy} onChange={e=>setDatacenter(e.target.value)} /></label></details>
    <div className="flex flex-wrap items-center gap-3 text-sm"><Btn variant="primary" disabled={!chosen||!domain||!!busy} loading={busy==="create"} onClick={()=>void create()}>{newSite?(createLabel??"Create website"):"Review and create"}</Btn>{!newSite&&<><Btn disabled={!!busy} loading={loading} onClick={()=>{inventories.forEach(query=>void query.refetch());onCreated();}}>Refresh destinations</Btn><a href="https://hpanel.hostinger.com/websites" target="_blank" rel="noreferrer" className="text-accent underline">Open Hostinger websites</a></>}</div>
    {kind==="wordpress"&&<p className="text-xs text-text-secondary">Zoer creates an administrator with a generated password, used only to pair Zoer Connect and then deleted. Open the site's admin later through Hostinger.</p>}
    {failures.map(text=><p key={text} role="alert" className="text-sm text-status-warning">{text}</p>)}
    {error&&<p role="alert" className="text-sm text-status-warning">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
    {sites.length>0&&<div className="space-y-2 border-t border-border-muted pt-3"><h5 className="text-[13px] font-semibold text-text-heading">Websites created here</h5><ul className="space-y-2">{sites.map(site=>{
      const account=connections.length>1?connections.find(item=>item.id===site.connectionId)?.name:null;
      return <li key={site.id} className="min-w-0 space-y-1 rounded-md border border-border-muted p-2.5 text-sm">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all font-medium">{site.domain}{account&&<span className="ml-2 text-xs font-normal text-text-secondary">{account}</span>}</span><StatusBadge tone={site.ready?"success":site.running?"neutral":"error"}>{site.ready?"Ready":site.running?"Setting up":"Needs attention"}</StatusBadge></div>
        <p className="text-text-secondary" role={site.running?"status":undefined}>{site.ready?"Zoer Connect is paired. It is in your site list, and in Push to live.":site.step}</p>
        {site.error&&<p className="text-status-error">{site.error}</p>}
        {site.warnings.map(text=><p key={text} className="text-status-warning">{text}</p>)}
        <div className="flex flex-wrap items-center gap-2">{site.ready&&<a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="text-accent underline">Open site</a>}{!site.ready&&!site.running&&<Btn size="sm" loading={busy===`retry:${site.id}`} disabled={!!busy} onClick={()=>void retry(site)}>Retry</Btn>}{!site.running&&<Btn size="sm" variant="ghost" loading={busy===`delete:${site.id}`} disabled={!!busy} onClick={()=>void remove(site)}>Delete this site</Btn>}</div>
      </li>;})}</ul></div>}
  </section>;
}
