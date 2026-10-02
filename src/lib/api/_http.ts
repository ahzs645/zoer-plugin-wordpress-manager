import { hostRequest } from "../../host/bridge";
export { getApiBase } from "@zoer/plugin-ui/workspace";
export class ApiError extends Error { constructor(message:string, readonly status:number, readonly body?:unknown){super(message);} }
export async function json<T>(path:string, init:RequestInit={}):Promise<T> {
 if(init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
 const body=typeof init.body==="string" ? JSON.parse(init.body || "null") : init.body;
 try { const result=await hostRequest<T>("api.request", {path,method:init.method,body});
  if(init.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return result;
 } catch(e) { if(e instanceof Error && "status" in e) throw new ApiError(e.message, Number(e.status)); throw e; }
}
export function blob(path:string):Promise<Blob> { return hostRequest("api.request",{path,response:"blob"}); }
