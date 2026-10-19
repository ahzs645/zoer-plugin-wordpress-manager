import { hostRequest } from "../../host/bridge";
export { getApiBase } from "@zoer/plugin-ui/workspace";
export class ApiError extends Error {
 /** The host's stable error code and details, when the backend sent a structured or flat `{ error, code, details }` body. */
 readonly code?: string; readonly details?: Record<string, unknown>;
 constructor(message:string, readonly status:number, readonly body?:unknown, extra:{code?:string;details?:Record<string,unknown>}={}){super(message); this.code=extra.code; this.details=extra.details;}
}
/** Code and details from a host error: its own fields, or the raw response body it kept. */
export function apiErrorFields(error:unknown):{code?:string;details?:Record<string,unknown>} {
 if(!error || typeof error!=="object") return {};
 const own=error as {code?:unknown;details?:unknown;envelope?:unknown;body?:unknown};
 const record=(value:unknown)=>value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : undefined;
 const body=record(own.envelope) ?? record(own.body);
 const nested=record(body?.error);
 const code=[own.code, body?.code, nested?.code].find((value):value is string=>typeof value==="string" && !!value);
 const details=record(own.details) ?? record(body?.details) ?? record(nested?.details);
 return {...(code ? {code} : {}), ...(details ? {details} : {})};
}
export async function json<T>(path:string, init:RequestInit={}):Promise<T> {
 if(init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
 const body=typeof init.body==="string" ? JSON.parse(init.body || "null") : init.body;
 try { const result=await hostRequest<T>("api.request", {path,method:init.method,body});
  if(init.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return result;
 } catch(e) { if(e instanceof Error && "status" in e) throw new ApiError(e.message, Number(e.status), (e as {envelope?:unknown;body?:unknown}).envelope ?? (e as {body?:unknown}).body, apiErrorFields(e)); throw e; }
}
export function blob(path:string):Promise<Blob> { return hostRequest("api.request",{path,response:"blob"}); }
