import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiBase, json } from '../../lib/api/_http';
import type { DevelopmentRepository as RepoEntry } from './WordPressRepositoryDevelopment';
import { Btn } from "@zoer/plugin-ui/controls";
import { Field } from "@zoer/plugin-ui/controls";
import { ComputerSelect } from "@zoer/plugin-ui/controls";
import { CodeBlock } from "@zoer/plugin-ui/controls";
interface Tooling {settings:null|{computerId:string;enabled:boolean;command:string;excludes:string[];setupStatus:string;error?:string;versions?:string};computerStatus?:string;build:null|{status:string;sequence:number;output?:string;workerAlive:boolean;sourceDigest:string;currentDigest:string}}
export default function WordPressDevelopmentTools({repo,onRecipe}:{repo:RepoEntry;onRecipe:(recipe:{folder:string;slug:string})=>void}) {
  const client=useQueryClient(), path=`/repository-development/${encodeURIComponent(repo.id)}/tooling`, key=[getApiBase(),'wordpress-development-tooling',repo.id];
  const query=useQuery({queryKey:key,queryFn:()=>json<Tooling>(path),refetchInterval:3000});
  const [computerId,setComputerId]=useState(repo.attachedComputers[0]?.id??''),[command,setCommand]=useState(''),[excludes,setExcludes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
  const data=query.data, settings=data?.settings;
  useEffect(()=>{if(!dirty&&settings){setComputerId(settings.computerId);setCommand(settings.command);setExcludes(settings.excludes.join(', '));}if(!computerId&&repo.attachedComputers[0])setComputerId(repo.attachedComputers[0].id);},[settings,repo.attachedComputers,dirty,computerId]);
  async function save(enabled:boolean) {setBusy(true);setError('');try{await json(path,{method:'PUT',body:JSON.stringify({computerId,enabled,command,excludes})});setDirty(false);await client.invalidateQueries({queryKey:key});}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <div className="min-w-0 space-y-3 rounded-lg border border-border-default p-4">
    <h3 className="font-medium text-text-heading">PHP/Composer and build-on-save</h3>
    <p className="text-sm text-text-secondary">Enable once to install native PHP, Composer and common PHP extensions. Saves in Files, Terminal or Chat trigger one build after a quiet interval. Setup and watching resume when this computer starts again.</p>
    <Btn disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const recipe=await json<{command:string;folder:string;slug:string}>(`/wordpress-manager/repositories/${encodeURIComponent(repo.id)}/development/inspect`);setCommand(recipe.command);setDirty(true);onRecipe(recipe);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}>Inspect repository and prepare build</Btn>
    <ComputerSelect computers={repo.attachedComputers} aria-label="WordPress development computer" value={computerId} onChange={e=>{setComputerId(e.target.value);setDirty(true);}}><option value="">Choose an attached computer</option>{repo.attachedComputers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</ComputerSelect>
    <Field label="Build command" value={command} onChange={v=>{setCommand(v);setDirty(true);}} placeholder="Blank: install dependencies, build assets and lint PHP"/>
    <Field label="Additional ignored folders" value={excludes} onChange={v=>{setExcludes(v);setDirty(true);}} placeholder="generated, cache"/>
    <p className="text-xs text-text-muted">Blank detects root Composer/Node manifests, installs dependencies when manifests change, runs their build scripts and lints PHP. For dependencies/assets, use a command such as composer install --no-interaction &amp;&amp; npm run build. Enabling authorizes repository dependency/build scripts. Commands run as the development user in /workspace, with a 15-minute limit. vendor, node_modules, dist, build, coverage and hidden folders do not trigger builds. Add other output folders above.</p>
    <div className="flex flex-wrap gap-2"><Btn variant="primary" disabled={busy||!computerId||settings?.setupStatus==='installing'} loading={busy} onClick={()=>void save(true)}>{settings?.enabled?'Save settings and build now':'Enable PHP/Composer'}</Btn>{settings?.enabled&&<Btn disabled={busy||settings.setupStatus==='installing'} onClick={()=>void save(false)}>Stop build-on-save</Btn>}</div>
    {data&&<p role="status" className="text-sm">Tools: {settings?.setupStatus??'not configured'}{data.computerStatus?` · Computer: ${data.computerStatus}`:''}{data.build?` · Build ${data.build.sequence}: ${data.build.status}${data.build.workerAlive?'':' · watcher stopped'}${data.build.sourceDigest!==data.build.currentDigest?' · saved changes awaiting build':''}`:''}</p>}
    {(error||query.error||settings?.error)&&<p role="alert" className="break-words text-sm text-status-error">{error||settings?.error||String(query.error)}</p>}
    {settings?.versions&&<p className="whitespace-pre-line text-xs text-text-muted">{settings.versions}</p>}
    {data?.build?.output&&<CodeBlock code={data.build.output} language="text" filename="Latest WordPress development build"/>}
    <p className="text-xs text-text-muted">A successful build of current saved source is required for an update while watching is enabled. Review and install from this panel when ready. Disabling watching keeps installed tools and saved repository files.</p>
  </div>;
}
