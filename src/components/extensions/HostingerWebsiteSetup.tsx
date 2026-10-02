import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type HostingerConnectionPublic } from "../../lib/api";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";

export default function HostingerWebsiteSetup({connections,onCreated}:{connections:HostingerConnectionPublic[];onCreated:()=>void}) {
  const dialogs=useDialogs();
  const [connection,setConnection]=useState("");
  const [domainMode,setDomainMode]=useState("temporary");
  const [domain,setDomain]=useState("");
  const [order,setOrder]=useState("");
  const [datacenter,setDatacenter]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  const inventory=useQuery({queryKey:["wordpress","hostinger-setup",connection],queryFn:()=>api.getHostingerSetupInventory(connection),enabled:!!connection,staleTime:0});
  async function generateTemporaryDomain() {
    if(busy||!connection)return;
    setBusy(true);setError("");setNotice("");
    try {setDomain((await api.generateHostingerTemporaryDomain(connection)).domain);}
    catch(e){setError(e instanceof Error?e.message:"Temporary domain generation failed.");}
    finally{setBusy(false);}
  }
  async function create() {
    if(busy||!connection||!domain||!order)return;
    const name=domain.trim().toLowerCase();const phrase=`CREATE ${name}`;
    const typed=await dialogs.prompt({title:`Create ${name}?`,description:"Creates an empty website on the selected hosting plan. You can then publish a local WordPress site to it.",label:`Type ${phrase}`,submitLabel:"Create website"});
    if(typed!==phrase)return;
    setBusy(true);setError("");setNotice("");
    try{await api.createHostingerWebsite({connectionId:connection,domain:name,orderId:Number(order),datacenterCode:datacenter||undefined,confirmation:typed});setNotice("Website creation queued. Refresh destinations after Hostinger finishes setup.");await inventory.refetch();onCreated();}
    catch(e){setError(e instanceof Error?e.message:"Website creation failed.");}finally{setBusy(false);}
  }
  return <section className="space-y-3 rounded-md border border-border-default p-3" aria-label="Create Hostinger destination"><h4 className="text-sm font-semibold text-text-heading">Create Hostinger website</h4>
    <label className="block text-sm">Account<Select searchable aria-label="Website Hostinger connection" value={connection} disabled={busy} onChange={e=>{setConnection(e.target.value);setOrder("");setDomain("");setNotice("");}}><option value="">Choose connected account</option>{connections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
    <label className="block text-sm">Domain<Select aria-label="Hostinger destination domain option" value={domainMode} disabled={busy} onChange={e=>{setDomainMode(e.target.value);setDomain("");}}><option value="temporary">Temporary domain</option><option value="account">Domain from account</option><option value="custom">Other owned domain</option></Select></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block min-w-0 text-sm">Hosting plan<Select searchable aria-label="Hostinger hosting plan" value={order} disabled={busy||inventory.isFetching} onChange={e=>setOrder(e.target.value)}><option value="">Choose existing plan</option>{inventory.data?.orders.map(o=><option key={o.id} value={o.id} disabled={o.status!=="active"}>{o.name} · {o.id} · {o.status}</option>)}</Select></label>
      {domainMode==="temporary" ? <div className="min-w-0 space-y-2 text-sm"><p>Generate a free temporary domain to review the site. You can connect your own domain later.</p>{domain&&<p className="break-all" role="status">{domain}</p>}<Btn disabled={!connection||busy} loading={busy} onClick={()=>void generateTemporaryDomain()}>{domain?"Generate another domain":"Generate temporary domain"}</Btn></div> : domainMode==="account" ? <label className="block min-w-0 text-sm">Account domain<Select searchable aria-label="Hostinger account domain" value={domain} disabled={busy||inventory.isFetching} onChange={e=>setDomain(e.target.value)}><option value="">Choose unassigned domain</option>{inventory.data?.domains.map(d=><option key={d.domain} value={d.domain} disabled={d.assigned||d.status!=="active"}>{d.domain}{d.assigned?" · already assigned":""}</option>)}</Select></label> : <label className="block text-sm">Owned domain<input aria-label="New website domain" className={controlClass()} value={domain} disabled={busy} onChange={e=>setDomain(e.target.value)} placeholder="example.com" /></label>}
      <label className="block text-sm">Datacenter code (first website only)<input aria-label="Datacenter code" className={controlClass()} value={datacenter} disabled={busy} onChange={e=>setDatacenter(e.target.value)} /></label><Btn className="self-end" disabled={!connection||!domain||!order||busy||!!inventory.error} loading={busy} onClick={()=>void create()}>Review and create</Btn>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-sm"><Btn disabled={!connection||busy} loading={inventory.isFetching} onClick={()=>{void inventory.refetch();onCreated();}}>Refresh destinations</Btn><a href="https://hpanel.hostinger.com/websites" target="_blank" rel="noreferrer" className="text-accent underline">Open Hostinger websites</a></div>
    {(error||inventory.error) && <p role="alert" className="text-sm text-status-warning">{error||(inventory.error instanceof Error?inventory.error.message:"Account inventory unavailable.")}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  </section>;
}
