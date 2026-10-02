import { useEffect, useRef, useState } from "react";
import { json } from "../../lib/api/_http";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import type { PushSource } from "../../lib/api/types/wordpress-transfer";

type Entry = { path: string; bytes: number; state: string };
type Preview = { id: string; cursor: number; complete: boolean; files: Entry[] };
export type PushSelection = { previewId: string; selectedPaths: string[] };
export default function WordPressPushSelection({ endpoint, source, disabled, onChange }: { endpoint: string; source: PushSource; disabled: boolean; onChange: (selection: PushSelection | null) => void }) {
  const [preview,setPreview]=useState<Preview|null>(null),[selected,setSelected]=useState<Set<string>>(new Set()),[filter,setFilter]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef(true),run=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;run.current=false;};},[]);
  function choose(next:Set<string>){setSelected(next);onChange(preview?.complete?{previewId:preview.id,selectedPaths:[...next]}:null);}
  async function compare(resume=false){setBusy(true);setError("");onChange(null);run.current=true;let id=resume?preview?.id:undefined;try{while(active.current&&run.current){const {preview:p}=await json<{preview:Preview}>(`${endpoint}/preview`,{method:"POST",body:JSON.stringify({source,sourceSiteId:source.sourceSiteId,...(source.kind==="local-export"?{exportId:source.exportId}:{pullId:source.pullId}),previewId:id})});if(!active.current)return;setPreview(p);id=p.id;if(p.complete){const paths=p.files.filter(f=>["new","changed"].includes(f.state)).map(f=>f.path);setSelected(new Set(paths));onChange({previewId:p.id,selectedPaths:paths});break;}}}catch(e){if(active.current)setError(e instanceof Error?e.message:"Comparison interrupted.");}finally{run.current=false;if(active.current)setBusy(false);}}
  const filtered=(preview?.files??[]).filter(f=>f.path.toLowerCase().includes(filter.toLowerCase()));
  return <div className="space-y-3 rounded border border-border-default p-3">
    <p className="font-medium">Choose what to push</p>
    <p className="text-xs text-text-secondary">Compare the verified export with this destination. New and changed files are selected by default. Files absent from the export are retained. Database replacement is optional and does not merge records.</p>
    <div className="flex flex-wrap gap-2"><Btn disabled={disabled||busy} onClick={()=>void compare()}>Compare files with destination</Btn>{busy?<Btn onClick={()=>{run.current=false;}}>Pause comparison</Btn>:preview&&!preview.complete&&<Btn disabled={disabled} onClick={()=>void compare(true)}>Resume comparison</Btn>}</div>
    {preview&&<p role="status" className="text-xs">Compared {preview.cursor} / {preview.files.length} · {selected.size} selected</p>}
    {preview?.complete&&<>
      <label className="block text-sm">Filter by theme, plugin or file path<input className={`${controlClass()} mt-1 w-full text-base`} value={filter} onChange={e=>setFilter(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><Btn disabled={disabled} onClick={()=>choose(new Set([...selected,...filtered.filter(f=>["new","changed"].includes(f.state)).map(f=>f.path)]))}>Select changed matches</Btn><Btn disabled={disabled} onClick={()=>choose(new Set([...selected].filter(p=>!filtered.some(f=>f.path===p))))}>Clear matches</Btn></div>
      <div className="max-h-72 overflow-y-auto space-y-1">{filtered.slice(0,200).map(f=><label key={f.path} className="flex min-h-11 items-start gap-2 py-2 text-xs"><input type="checkbox" className="mt-1" disabled={disabled||f.state==="blocked"} checked={selected.has(f.path)} onChange={e=>{const next=new Set(selected);if(e.target.checked)next.add(f.path);else next.delete(f.path);choose(next);}}/><span className="min-w-0 break-all">{f.path}<span className="block text-text-secondary">{f.state==="database"?"Replace database content — explicit selection required":f.state==="blocked"?"Cannot compare safely; excluded from selective Push":f.state} · {f.bytes.toLocaleString()} bytes</span></span></label>)}</div>
      {filtered.length>200&&<p className="text-xs">Showing 200 of {filtered.length} matches. Narrow the filter to review other files.</p>}
      <p className="text-xs text-text-secondary">Protected paths and destination files over 32 MiB are excluded from this comparison. Larger files still use the existing full-export Push.</p>
    </>}
    {error&&<p role="alert" className="text-status-error text-sm">{error}</p>}
  </div>;
}
