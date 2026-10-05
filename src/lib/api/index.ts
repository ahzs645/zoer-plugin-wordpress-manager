import { json } from "./_http";
import { wordpressManagerClient } from "./wordpress-manager-client";
import type { Computer } from "@zoer/api-types";
export * from "./types";
const base="/wordpress-manager/workspace";
const computer=(id:string)=>`${base}/computers/${encodeURIComponent(id)}`;
export const api = {
 ...wordpressManagerClient,
 contract:()=>json<{version:number}>(`${base}/contract`),
 createComputer:(input:{name:string;runtime?:string;runtimeProfile?:string;runtimeConnectorId?:string;aiMode?:string})=>json<Computer>(`${base}/computers`,{method:"POST",body:JSON.stringify(input)}),
 startComputer:(id:string)=>json<{ok:boolean}>(`${computer(id)}/start`,{method:"POST"}),
 stopComputer:(id:string)=>json<{ok:boolean}>(`${computer(id)}/stop`,{method:"POST"}),
 destroyComputer:(id:string)=>json<{ok:boolean}>(computer(id),{method:"DELETE"}),
 createWordPressLoginHandoff:(id:string)=>json<{path:string}>(`${computer(id)}/wordpress-login-handoffs`,{method:"POST"}),
};
