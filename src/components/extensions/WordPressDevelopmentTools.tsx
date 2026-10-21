import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiBase, json } from '../../lib/api/_http';
import type { DevelopmentRepository as RepoEntry } from './WordPressRepositoryDevelopment';
import { Btn } from "@zoer/plugin-ui/controls";
import { Field } from "@zoer/plugin-ui/controls";
import { ComputerSelect } from "@zoer/plugin-ui/controls";
import { CodeBlock } from "@zoer/plugin-ui/controls";
type BuildMode = "build" | "check";
/** savedBuild: the backend's record of the last finished build (outlives the computer). */
interface Tooling {settings:null|{computerId:string;enabled:boolean;command:string;excludes:string[];mode?:BuildMode;setupStatus:string;error?:string;versions?:string};computerStatus?:string;build:null|{status:string;sequence:number;output?:string;workerAlive:boolean;sourceDigest:string;currentDigest:string};savedBuild?:null|{status:string;sequence:number;finishedAt:number;output?:string}}
const pending = (data?: Tooling) => !!data && (data.settings?.setupStatus === "installing" || data.build?.status === "building" || (!!data.build && data.build.sourceDigest !== data.build.currentDigest));
export default function WordPressDevelopmentTools({repo,onRecipe}:{repo:RepoEntry;onRecipe:(recipe:{folder:string;slug:string;kind?:"plugin"|"theme"})=>void}) {
  const client=useQueryClient(), path=`/repository-development/${encodeURIComponent(repo.id)}/tooling`, key=[getApiBase(),'wordpress-development-tooling',repo.id];
  // Each read runs a short status command in the development computer: poll quickly only while a build is due.
  const query=useQuery({queryKey:key,queryFn:()=>json<Tooling>(path),refetchInterval:q=>pending(q.state.data)?3000:15000});
  const [computerId,setComputerId]=useState(repo.attachedComputers[0]?.id??''),[command,setCommand]=useState(''),[excludes,setExcludes]=useState(''),[mode,setMode]=useState<BuildMode>('build'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
  const data=query.data, settings=data?.settings, saved=data?.savedBuild;
  useEffect(()=>{if(!dirty&&settings){setComputerId(settings.computerId);setCommand(settings.command);setExcludes(settings.excludes.join(', '));setMode(settings.mode??'build');}if(!computerId&&repo.attachedComputers[0])setComputerId(repo.attachedComputers[0].id);},[settings,repo.attachedComputers,dirty,computerId]);
  async function save(enabled:boolean) {setBusy(true);setError('');try{await json(path,{method:'PUT',body:JSON.stringify({computerId,enabled,command,excludes,mode})});setDirty(false);await client.invalidateQueries({queryKey:key});}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <div className="min-w-0 space-y-3 rounded-lg border border-border-default p-4">
    <h3 className="font-medium text-text-heading">PHP/Composer and build-on-save</h3>
    <p className="text-sm text-text-secondary">Enable once: installs PHP and Composer, then rebuilds a moment after you save in Files, Terminal or Chat.</p>
    <Btn disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const recipe=await json<{command:string;folder:string;slug:string;kind?:"plugin"|"theme"}>(`/wordpress-manager/repositories/${encodeURIComponent(repo.id)}/development/inspect`);setCommand(recipe.command);setDirty(true);onRecipe(recipe);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}>Inspect repository and prepare build</Btn>
    <ComputerSelect computers={repo.attachedComputers} aria-label="WordPress development computer" value={computerId} onChange={e=>{setComputerId(e.target.value);setDirty(true);}}><option value="">Choose an attached computer</option>{repo.attachedComputers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</ComputerSelect>
    <div role="radiogroup" aria-label="What runs after each save" className="grid gap-2 sm:grid-cols-2">{([["build","Full build","Installs dependencies when manifests change, runs the build command and checks PHP."],["check","PHP checks only","For plain PHP, CSS, templates and theme.json: no installs or repository scripts."]] as const).map(([value,label,description])=><label key={value} className={`flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-sm focus-within:ring-2 focus-within:ring-input-focus ${mode===value?"border-accent bg-surface-hover":"border-border-default hover:bg-surface-hover"}`}><input type="radio" className="sr-only" name={`build-mode-${repo.id}`} checked={mode===value} onChange={()=>{setMode(value);setDirty(true);}}/><span className="font-medium">{label}</span><span className="text-[12px] text-text-muted">{description}</span></label>)}</div>
    {mode==="build"&&<Field label="Build command" value={command} onChange={v=>{setCommand(v);setDirty(true);}} placeholder="Blank: install dependencies, build assets and lint PHP"/>}
    <Field label="Additional ignored folders" value={excludes} onChange={v=>{setExcludes(v);setDirty(true);}} placeholder="generated, cache"/>
    {mode==="build"&&<p className="text-xs text-text-muted">Leave blank to detect Composer and npm builds automatically, or enter your own, e.g. <code>composer install --no-interaction &amp;&amp; npm run build</code>. Enabling lets this repository's scripts run on its development computer (15-minute limit). Changes in vendor, node_modules, dist, build and hidden folders don't trigger builds; add other output folders above.</p>}
    <div className="flex flex-wrap gap-2"><Btn variant="primary" disabled={busy||!computerId||settings?.setupStatus==='installing'} loading={busy} onClick={()=>void save(true)}>{settings?.enabled?'Save settings and build now':'Enable PHP/Composer'}</Btn>{settings?.enabled&&<Btn disabled={busy||settings.setupStatus==='installing'} onClick={()=>void save(false)}>Stop build-on-save</Btn>}</div>
    {data&&<p role="status" className="text-sm">Tools: {settings?.setupStatus??'not configured'}{data.computerStatus?` · Computer: ${data.computerStatus}`:''}{data.build?` · Build ${data.build.sequence}: ${data.build.status}${data.build.workerAlive?'':' · watcher stopped'}${data.build.workerAlive&&data.build.sourceDigest!==data.build.currentDigest?' · saved changes awaiting build':''}`:''}</p>}
    {settings?.enabled&&!data?.build?.workerAlive&&saved&&<p className="text-sm text-text-secondary">{saved.status==='succeeded'?`Last successful build (${saved.sequence}, ${new Date(saved.finishedAt*1000).toLocaleString()}) is saved. You can still review and update the site from it while the saved files are unchanged; start the computer to build new edits.`:`The last build (${saved.sequence}) failed. Start the computer to build again.`}</p>}
    {(error||query.error||settings?.error)&&<p role="alert" className="break-words text-sm text-status-error">{error||settings?.error||String(query.error)}</p>}
    {settings?.versions&&<p className="whitespace-pre-line text-xs text-text-muted">{settings.versions}</p>}
    {(data?.build?.output||saved?.output)&&<CodeBlock code={data?.build?.output||saved?.output||''} language="text" filename="Latest WordPress development build"/>}
    <p className="text-xs text-text-muted">While watching is on, an update needs a successful build of the saved source. An idle development computer stops itself after the idle shutdown period; its last build stays usable.</p>
  </div>;
}
