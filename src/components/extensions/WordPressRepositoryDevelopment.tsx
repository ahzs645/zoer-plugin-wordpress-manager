import { useQuery } from "@tanstack/react-query";
import { Select } from "@zoer/plugin-ui/controls";
import { getApiBase, isDemoMode, useResourceSelection } from "@zoer/plugin-ui/workspace";
import { json } from "../../lib/api/_http";
import WordPressDevelopmentPanel from "./WordPressDevelopmentPanel";
import { sourcesForPlugin, repositoryForPlugin, type SiteRepositorySource } from "./repositoryPluginSelection";
export interface DevelopmentRepository {id:string;name:string;attachedComputers:{id:string;name:string;status:string}[]}
export interface InstalledPluginTarget {siteId:string;slug:string}
const PATHWAY = [
 {title:"Repository",detail:"Clone or import the plugin's source in Repos."},
 {title:"Build and install locally",detail:"Inspect, build and install it on a local site or local copy."},
 {title:"Edit and update locally",detail:"Edit in Repos; builds run on save. Review, then Update local site."},
 {title:"Push code to live",detail:"Push only this plugin's code; live content stays as it is."},
];

/** The plugin development pathway, ending in the guided Push to live (code only). */
function Pathway({current,onPushToLive}:{current:number;onPushToLive?:()=>void}) {
 return <ol className="grid min-w-0 gap-2 sm:grid-cols-4" aria-label="Plugin development steps">
  {PATHWAY.map((step,index)=><li key={step.title} aria-current={index===current?"step":undefined} className={`min-w-0 rounded-lg border p-2.5 text-sm ${index===current?"border-accent bg-surface-hover":"border-border-default"}`}>
   <p className="font-medium text-text-primary"><span className="mr-1.5 text-text-secondary">{index+1}.</span>{step.title}</p>
   <p className="text-[12px] leading-4 text-text-muted">{step.detail}</p>
   {index===3&&onPushToLive&&<button type="button" className="mt-1.5 min-h-11 text-[13px] text-accent underline sm:min-h-0" onClick={onPushToLive}>Push to live</button>}
  </li>)}
 </ol>;
}

export default function WordPressRepositoryDevelopment({targetPlugin,onPushToLive}:{targetPlugin?:InstalledPluginTarget;/** Opens Push to live for the selected local site. */onPushToLive?:()=>void}={}) {
 const [repoId,setRepoId]=useResourceSelection<string|null>("repo",null);
 const [selectedSiteId,setSelectedSiteId]=useResourceSelection<string|null>("site",null);
 const query=useQuery({queryKey:[getApiBase(),"development-repositories"],queryFn:()=>json<{repositories:DevelopmentRepository[]}>("/repository-development"),enabled:!isDemoMode(),refetchInterval:5000});
 const links=useQuery({queryKey:[getApiBase(),"site-repository-development",targetPlugin?.siteId],queryFn:()=>json<{repositories:SiteRepositorySource[]}>(`/wordpress-manager/sites/${encodeURIComponent(targetPlugin!.siteId)}/repository-development`),enabled:!!targetPlugin&&!isDemoMode(),refetchInterval:5000});
 const available=targetPlugin?sourcesForPlugin(links.data?.repositories??[],targetPlugin.siteId,targetPlugin.slug):null;
 const repositories=(query.data?.repositories??[]).filter(repo=>!available||available.some(source=>source.id===repo.id));
 const currentId=targetPlugin?repositoryForPlugin(links.data?.repositories??[],targetPlugin.siteId,targetPlugin.slug,repoId):repoId;
 const bound=available?.some(source=>!!source.link&&source.link.siteId===targetPlugin?.siteId&&source.link.slug===targetPlugin?.slug)??false;
 const repo=repositories.find(row=>row.id===currentId);
 return <section className="min-w-0 space-y-4" aria-label="Repository plugin development">
  {!targetPlugin&&<Pathway current={repo?1:0} onPushToLive={onPushToLive}/>}
  <div className="flex flex-wrap items-center gap-3"><Select className="min-w-0 flex-1" searchable aria-label="Plugin source repository" disabled={bound} value={currentId??""} onChange={event=>setRepoId(event.target.value||null)}><option value="">Choose a repository</option>{repositories.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</Select><a className="inline-flex min-h-11 items-center text-sm text-accent underline" href="/#/repos">Clone or import in Repos</a></div>
  {targetPlugin&&<p className="break-words text-sm text-text-secondary">Development source for wp-content/plugins/{targetPlugin.slug} on this local site.{bound?" Unlink the current development source before choosing another repository; installed site code is preserved.":" Choose an unlinked repository to develop this installed plugin."}</p>}
  {links.error&&<p role="alert" className="text-sm text-status-error">{String(links.error)}</p>}
  {query.error&&<p role="alert" className="text-sm text-status-error">{String(query.error)}</p>}
  {query.isPending&&!isDemoMode()&&<p role="status">Loading repositories…</p>}
  {repo?<WordPressDevelopmentPanel key={repo.id} repo={repo} requestedSiteId={targetPlugin?.siteId??selectedSiteId} fixedTarget={targetPlugin} onLinkedSite={setSelectedSiteId}/>:<p className="text-sm text-text-secondary">Clone or create a repository in Repos, then select it here to build and install its plugin on a local WordPress site or local copy.</p>}
 </section>;
}
