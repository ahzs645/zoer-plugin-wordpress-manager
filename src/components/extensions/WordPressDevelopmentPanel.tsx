import WordPressDevelopmentTools from './WordPressDevelopmentTools';
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { wordpressKeys } from "../../lib/queries/wordpress";
import type { DevelopmentRepository as RepoEntry } from "./WordPressRepositoryDevelopment";
import { getApiBase, json } from "../../lib/api/_http";
import { Btn } from "@zoer/plugin-ui/controls";
import { Field } from "@zoer/plugin-ui/controls";
import { Modal } from "@zoer/plugin-ui/controls";
import { Select } from "@zoer/plugin-ui/controls";


import { useDialogs } from "@zoer/plugin-ui/controls";

interface Link {siteId:string; folder:string; slug:string}
interface Job {id:string; operation:string; status:string; error?:string; createdAt:string; version?:string; sourceCommit?:string; siteId?:string; slug?:string; rollbackOf?:string}
interface State {link:Link|null; sites:{id:string; name:string; status:string; url:string}[]; jobs:Job[]; busy:boolean}
interface Review {id:string; fingerprint:string; siteId:string; slug:string; source:{name:string;version:string;mainFile:string;commit:string|null;digest:string;files:number;bytes:number}; changes:{path:string;kind:string}[]}
interface Activation {fingerprintSha256:string;steps:string[];warnings:string[];confirmationPhrase:string|null}

export default function WordPressDevelopmentPanel({repo, unsaved=false, requestedSiteId=null, fixedTarget, onLinkedSite}:{repo:RepoEntry; unsaved?:boolean; requestedSiteId?:string|null; fixedTarget?:{siteId:string;slug:string}; onLinkedSite?:(id:string)=>void}) {
  const client = useQueryClient(), dialogs = useDialogs();
  const base = `/wordpress-manager/repositories/${encodeURIComponent(repo.id)}/development`;
  const key = [getApiBase(),"wordpress-repository-development",repo.id];
  const query = useQuery({queryKey:key,queryFn:()=>json<State>(base),refetchInterval:q=>q.state.data?.busy?2000:30000});
  const state = query.data, link = state?.link, site = state?.sites.find(s=>s.id===link?.siteId);
  const [folder,setFolder] = useState("."), [slug,setSlug] = useState(repo.name.toLowerCase().replace(/[^a-z0-9-]+/g,"-").slice(0,80));
  const [siteId,setSiteId] = useState(""), [name,setName] = useState(`${repo.name} plugin development`);
  const [starter,setStarter] = useState(false);
  const [settings,setSettings] = useState(false), [create,setCreate] = useState(false);
  const installed = useQuery({queryKey:[getApiBase(),"development-site-plugins",siteId],queryFn:()=>api.getWordPressManagedSite(siteId,"plugins"),enabled:settings&&!fixedTarget&&!create&&!!siteId&&state?.sites.some(site=>site.id===siteId&&site.status==="running"),retry:false,staleTime:10000});
  const [busy,setBusy] = useState(""), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [review,setReview] = useState<Review|null>(null), [activation,setActivation] = useState<Activation|null>(null), [confirmation,setConfirmation] = useState("");
  useEffect(()=> { if(link){setFolder(link.folder);setSlug(link.slug);setSiteId(link.siteId);} },[link?.folder,link?.slug,link?.siteId]);
  useEffect(()=> { if(!link && requestedSiteId && state?.sites.some(s=>s.id===requestedSiteId))setSiteId(requestedSiteId); },[state?.link, state?.sites.length, requestedSiteId]);
  useEffect(()=> { if(link && link.siteId!==requestedSiteId)onLinkedSite?.(link.siteId); },[link?.siteId, requestedSiteId, onLinkedSite]);
  useEffect(()=>{if(fixedTarget&&!link){setSiteId(fixedTarget.siteId);setSlug(fixedTarget.slug);}},[fixedTarget?.siteId,fixedTarget?.slug,link]);
  const latestJob=state?.jobs[0];
  useEffect(()=>{if(link&&latestJob?.status==='succeeded'&&latestJob.siteId===link?.siteId&&latestJob.slug===link?.slug){void client.invalidateQueries({queryKey:[...wordpressKeys.all(),'site',link.siteId]});void client.invalidateQueries({queryKey:[getApiBase(),'development-site-plugins',link.siteId]});}},[latestJob?.id,latestJob?.status,link?.siteId,link?.slug,client]);
  const locked = !!busy || !!state?.busy;
  async function action<T>(label:string,path:string,body?:unknown,method="POST"):Promise<T|undefined> {
    setBusy(label);setError("");setNotice("");
    try { const result = await json<T>(base+path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}); await client.invalidateQueries({queryKey:key});await client.invalidateQueries({queryKey:[getApiBase(),"site-repository-development"]});return result; }
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }
  async function openAdmin(){
    if(!link)return;setBusy("admin");setError("");
    // Open synchronously so mobile browsers preserve the user gesture.
    const tab=window.open("about:blank","_blank");
    try {const handoff=await api.createWordPressLoginHandoff(link.siteId); const url=new URL(handoff.path,window.location.origin).href;if(tab)tab.location.href=url;else window.location.assign(url);}
    catch(e){tab?.close();setError(e instanceof Error?e.message:String(e));}finally{setBusy("");}
  }
  async function reviewActivation(){
    if(!link)return;setBusy("activation");setError("");
    try {const result=await json<{plan:Activation}>("/wordpress-manager/extension-actions/plan",{method:"POST",body:JSON.stringify({siteId:link.siteId,kind:"plugin",operation:"activate",slugs:[link.slug]})});setConfirmation("");setActivation(result.plan);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy("");}
  }
  async function prepareComputer(){
    setBusy("computer");setError("");
    try {
      const {computer}=await json<{computer:{id:string;name:string}}>(`/repository-development/${encodeURIComponent(repo.id)}/computer`,{method:"POST"});
      const computerName=computer.name,computerId=computer.id;
      const previous=await json<{settings:null|{command:string;excludes:string[]}}>(`/repository-development/${encodeURIComponent(repo.id)}/tooling`);
      await json(`/repository-development/${encodeURIComponent(repo.id)}/tooling`,{method:"PUT",body:JSON.stringify({computerId,enabled:true,command:previous.settings?.command??"",excludes:previous.settings?.excludes.join(",")??""})});
      await client.invalidateQueries({queryKey:[getApiBase(),"development-repositories"]});

      setNotice(`Development computer ${computerName} is starting. Open Files and choose it once it is running.`);
    } catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy("");}
  }
  if(fixedTarget&&link&&(link.siteId!==fixedTarget.siteId||link.slug!==fixedTarget.slug))return <p role="alert" className="text-sm text-status-error">This repository is linked to another site or plugin. Choose an unlinked repository or reopen its own development entry.</p>;
  return <section className="min-w-0 space-y-4" aria-label="WordPress plugin development">
    <div><h2 className="text-base font-semibold text-text-heading">{repo.name}</h2><p className="mt-2 text-sm text-text-secondary">Edit this repository, build or test in its development computer, then review and update a local WordPress site. Saved files and generated output are included, even before committing.</p></div>
    {(error||query.error)&&<p role="alert" className="break-words text-sm text-status-error">{error||String(query.error)}</p>}
    {notice&&<p role="status" className="text-sm text-status-success">{notice}</p>}
    {!state&&query.isPending&&<p role="status">Loading WordPress development…</p>}
    {state&&!link&&<div className="space-y-3 rounded-lg border border-border-default p-4"><p className="text-sm">{fixedTarget?"Choose the repository plugin folder to link to this installed plugin. Review replacement files before applying an update.":"Choose the plugin folder and create a new local site, or link an existing local DDEV site or local copy."}</p><div className="flex flex-wrap gap-2">{!fixedTarget&&<><Btn disabled={locked||unsaved} onClick={()=>setStarter(true)}>Create starter plugin</Btn><Btn variant="primary" disabled={locked} onClick={()=>{setCreate(true);setSettings(true);}}>Create local WordPress site</Btn></>}<Btn disabled={locked} onClick={()=>{setCreate(false);setSettings(true);}}>Link site</Btn></div></div>}
    {link&&<div className="min-w-0 space-y-3 rounded-lg border border-border-default p-4">
      <div><h3 className="font-medium text-text-heading">{site?.name ?? link.siteId}</h3><p className="break-all text-sm text-text-secondary">{site?.status ?? "Unavailable"} · {link.folder} → wp-content/plugins/{link.slug}</p></div>
      {!site&&<p role="status" className="text-sm">The linked site is unavailable or archived. Restore it in WordPress Manager, or link another local site.</p>}
      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" disabled={locked||unsaved||site?.status!=="running"} loading={busy==="review"} onClick={async()=>{const result=await action<Review>("review","/review");if(result)setReview(result);}}>Review local update</Btn>
        <Btn disabled={locked||!site} loading={busy==="start"||busy==="stop"} onClick={()=>void action(site?.status==="running"?"stop":"start",site?.status==="running"?"/stop":"/start")}>{site?.status==="running"?"Stop site":"Start site"}</Btn>
        <Btn disabled={locked||site?.status!=="running"} onClick={()=>void openAdmin()}>WordPress admin</Btn>
        {site?.url&&<a className="inline-flex min-h-11 items-center text-sm text-accent underline sm:min-h-8" href={site.url} target="_blank" rel="noreferrer">Preview site</a>}
        <a className="inline-flex min-h-11 items-center text-sm text-accent underline sm:min-h-8" href={`/#/plugins/wordpress-manager?site=${encodeURIComponent(link.siteId)}`}>Site overview</a>
        <Btn disabled={locked} onClick={()=>{setCreate(false);setSettings(true);}}>{fixedTarget?"Change source folder":"Change site link"}</Btn>
      </div>
      <p className="text-xs text-text-muted">Updates replace this plugin folder, including reviewed file deletions. PHP syntax is checked before deployment. Existing activation state stays the same; activate a new plugin separately.</p>
      <Btn disabled={locked||site?.status!=="running"} onClick={()=>void reviewActivation()}>Review plugin activation</Btn>
    </div>}
    {unsaved&&<p role="status" className="text-sm">Save or discard the open Files edits before reviewing an update.</p>}
    {state?.busy&&<p role="status" className="text-sm">Development operation is running. You can leave this page; progress is saved.</p>}
    <div className="flex flex-wrap gap-3 text-sm"><a className="text-accent underline" href={`/#/repos/${encodeURIComponent(repo.id)}/files`}>Edit repository files</a><a className="text-accent underline" href={`/#/repos/${encodeURIComponent(repo.id)}/scripts`}>Build and test scripts</a><a className="text-accent underline" href={`/#/repos/${encodeURIComponent(repo.id)}/status`}>Commit and Git actions</a></div>
    {repo.attachedComputers.length>0&&<p className="text-sm text-text-secondary">Development computers: {repo.attachedComputers.map((c,i)=><span key={c.id}>{i?", ":""}<a className="text-accent underline" href={`/#/computer/${encodeURIComponent(c.id)}/chat`}>{c.name}</a></span>)}</p>}
    {(!repo.attachedComputers.length||repo.attachedComputers.every(c=>c.status==="stopped"))&&<div className="space-y-2"><Btn disabled={locked} loading={busy==="computer"} onClick={()=>void prepareComputer()}>Start development computer</Btn><p className="text-sm text-text-secondary">Starts an attached development computer, or creates a headless computer for these repository files. Use Files, Chat, Terminal and build scripts.</p></div>}
    <WordPressDevelopmentTools repo={repo} onRecipe={recipe=>{setFolder(recipe.folder);setSlug(fixedTarget?.slug??recipe.slug);setNotice("Build recipe selected. Enable builds, then create or link a site using the built folder.");}}/>
    <p className="text-xs text-text-muted">Choose a folder with one root PHP Plugin Name header. Build assets first if needed. Hidden files and node_modules are excluded; symbolic links and protected paths are refused. Development packages support 1,000 files and 8 MiB. Code rollback keeps current database content. GitHub publishing and remote-site Push remain separate reviewed workflows.</p>
    {!!state?.jobs.length&&<div className="space-y-2"><h3 className="text-sm font-medium text-text-heading">Development history</h3>{state.jobs.map(job=><div key={job.id} className="min-w-0 space-y-1 rounded-lg border border-border-default p-3"><p role="status" className="text-sm">{job.operation==="create-site"?"Create local site":job.operation==="rollback"?"Code rollback":"Local plugin update"} · {job.status}{job.version?` · ${job.version}`:""}</p><p className="text-xs text-text-muted">{new Date(job.createdAt).toLocaleString()}{job.sourceCommit?` · Based on ${job.sourceCommit.slice(0,12)} plus saved files`:""}</p>{job.error&&<p role="alert" className="break-words text-sm text-status-error">{job.error}</p>}{job.operation==="update"&&job.status!=="running"&&job.siteId===link?.siteId&&job.slug===link?.slug&&<Btn disabled={locked||site?.status!=="running"} onClick={async()=>{if(await dialogs.confirm({title:"Restore previous plugin code?",description:"Restores the code saved before this update. Current site code must still match that update. Database content is preserved; deactivate a newly installed plugin before removing its files.",confirmLabel:"Roll back code"}))await action("rollback",`/rollback/${job.id}`);}}>Roll back code</Btn>}</div>)}</div>}
    {starter&&<Modal title="Create starter WordPress plugin" onClose={()=>{if(!busy)setStarter(false);}} footer={<><Btn disabled={!!busy} onClick={()=>setStarter(false)}>Cancel</Btn><Btn variant="primary" loading={busy==="starter"} disabled={locked||!folder||!slug} onClick={async()=>{const result=await action<{path:string;shortcode:string}>("starter","/starter",{folder,slug});if(result){setStarter(false);setNotice(`Created ${result.path}. After installing and activating, add [${result.shortcode}] to a test page.`);await client.invalidateQueries({queryKey:[getApiBase(),"development-repositories"]});}}}>Create starter file</Btn></>}><div className="space-y-4"><Field label="Plugin folder in repository" value={folder} onChange={setFolder}/><Field label="Installed plugin folder name" value={slug} onChange={setSlug}/><p className="text-sm">Creates one uncommitted PHP plugin file with an example shortcode. Existing files are preserved.</p>{error&&<p role="alert" className="text-status-error">{error}</p>}</div></Modal>}
    {settings&&<Modal title={create?"Create local WordPress site":fixedTarget?"Link repository to installed plugin":"Link WordPress site"} onClose={()=>{if(!busy)setSettings(false);}} footer={<><Btn disabled={!!busy} onClick={()=>setSettings(false)}>Cancel</Btn><Btn variant="primary" loading={busy==="setup"} disabled={locked||!folder||!slug||(!create&&!siteId)||(create&&!name)} onClick={async()=>{const result=await action("setup",create?"/create-site":"",{folder,slug:fixedTarget?.slug??slug,...(create?{name}:{siteId:fixedTarget?.siteId??siteId})},create?"POST":"PUT");if(result){setSettings(false);setReview(null);}}}>{create?"Create and link site":"Save development link"}</Btn></>}>
      <div className="space-y-4"><Field label="Plugin folder in repository" value={folder} onChange={setFolder} placeholder=". or dist/my-plugin"/>{fixedTarget?<p className="break-all text-sm">Installed plugin folder: <strong>wp-content/plugins/{fixedTarget.slug}</strong></p>:<Field label="Installed plugin folder name" value={slug} onChange={setSlug} placeholder="my-plugin"/>}{fixedTarget?<p className="text-sm">Local site: <strong>{state?.sites.find(site=>site.id===fixedTarget.siteId)?.name??fixedTarget.siteId}</strong></p>:create?<Field label="Site name" value={name} onChange={setName}/>:<label className="block space-y-2 text-sm">Local WordPress site<Select searchable aria-label="Local WordPress site" value={siteId} onChange={e=>setSiteId(e.target.value)} optionDetails={Object.fromEntries((state?.sites??[]).map(s=>[s.id,{description:`${s.status} · ${s.url}`}]))}><option value="">Choose a DDEV site</option>{state?.sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>}
      {!fixedTarget&&!create&&!!installed.data?.plugins.length&&<label className="block space-y-2 text-sm">Replace installed plugin<Select searchable aria-label="Replace installed plugin" value={installed.data.plugins.some(plugin=>plugin.slug===slug)?slug:""} onChange={event=>setSlug(event.target.value)} optionDetails={Object.fromEntries(installed.data.plugins.map(plugin=>[plugin.slug,{description:`${plugin.version} · ${plugin.status} · ${plugin.slug}`}]))}><option value="">Install a new plugin</option>{installed.data.plugins.filter(plugin=>plugin.slug!=="zoer-connect").map(plugin=><option value={plugin.slug} key={plugin.slug}>{plugin.name}</option>)}</Select><p className="text-xs text-text-muted">Use the existing folder name to replace its files. Activation state is preserved.</p></label>}
      {installed.error&&!create&&<p role="status" className="text-sm">Installed plugin lookup is unavailable. Enter its folder name above.</p>}
      <p className="text-sm text-text-secondary">{create?"Creates a new local WordPress site. Review and install the plugin after the site starts.":"Use the existing installed folder name to replace a plugin. Saving the link does not change site files; review the update first."}</p>{link&&!create&&<Btn variant="danger" disabled={locked} onClick={async()=>{if(await dialogs.confirm({title:"Unlink site?",description:"Keeps the repository, site, plugin files and update history.",confirmLabel:"Unlink"})){const result=await action("unlink","",undefined,"DELETE");if(result)setSettings(false);}}}>Unlink site</Btn>}{error&&<p role="alert" className="text-sm text-status-error">{error}</p>}</div>
    </Modal>}
    {review&&<Modal title="Review local WordPress update" onClose={()=>{if(!busy)setReview(null);}} footer={<><Btn disabled={!!busy} onClick={()=>setReview(null)}>Cancel</Btn><Btn variant="primary" disabled={locked||!review.changes.length} loading={busy==="apply"} onClick={async()=>{const result=await action("apply","/apply",{id:review.id,fingerprint:review.fingerprint});if(result)setReview(null);}}>Update local site</Btn></>}><div className="space-y-3 text-sm"><p>{review.source.name} · {review.source.version} · {review.source.files} files · {(review.source.bytes/1024).toFixed(1)} KiB</p><p className="break-all">To {review.siteId}: wp-content/plugins/{review.slug}</p><p>Deploys the reviewed saved files after PHP syntax checks. Previous code is retained for rollback. Database content and activation state stay as they are.</p>{!review.changes.length?<p role="status">The local site already has these exact bytes.</p>:<ul className="space-y-1">{review.changes.map(c=><li className="break-all" key={c.path}>{c.kind}: {c.path}</li>)}</ul>}{error&&<p role="alert" className="text-status-error">{error}</p>}</div></Modal>}
    {activation&&<Modal title="Activate development plugin" onClose={()=>{if(!busy)setActivation(null);}} footer={<><Btn disabled={!!busy} onClick={()=>setActivation(null)}>Cancel</Btn><Btn variant="primary" loading={busy==="activate"} disabled={locked||!!(activation.confirmationPhrase&&confirmation!==activation.confirmationPhrase)} onClick={async()=>{setBusy("activate");setError("");try{await json("/wordpress-manager/extension-actions/apply",{method:"POST",body:JSON.stringify({siteId:link!.siteId,kind:"plugin",operation:"activate",slugs:[link!.slug],fingerprintSha256:activation.fingerprintSha256,...(activation.confirmationPhrase?{confirmation}:{})})});setActivation(null);setNotice("Plugin activated through the WordPress backup and health-check workflow.");}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy("");}}}>Activate plugin</Btn></>}><div className="space-y-3 text-sm"><p>Activation runs the plugin's code and can change its WordPress database. Uses the existing WordPress backup and health-check workflow.</p><ol className="list-inside list-decimal">{activation.steps.map(s=><li key={s}>{s}</li>)}</ol>{activation.warnings.map(s=><p key={s}>{s}</p>)}{activation.confirmationPhrase&&<Field label={`Type ${activation.confirmationPhrase} to confirm`} value={confirmation} onChange={setConfirmation}/>}{error&&<p role="alert" className="text-status-error">{error}</p>}</div></Modal>}
  </section>;
}
