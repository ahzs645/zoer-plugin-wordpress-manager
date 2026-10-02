import { json } from "./_http";
import { wordpressManagerClient } from "./wordpress-manager-client";
import type { Computer } from "@zoer/api-types";
import type { WordPressUpdraftImportManifest, WordPressUpdraftImportStatus } from "./computers-client";
export * from "./types";
const base="/wordpress-manager/workspace";
const computer=(id:string)=>`${base}/computers/${encodeURIComponent(id)}`;
export const api = {
 ...wordpressManagerClient,
 contract:()=>json<{version:number}>(`${base}/contract`),
 createComputer:(input:{name:string;runtime?:string;runtimeProfile?:string;runtimeConnectorId?:string;aiMode?:string})=>json<Computer>(`${base}/computers`,{method:"POST",body:JSON.stringify(input)}),
 getComputer:(id:string)=>json<Computer>(computer(id)),
 startComputer:(id:string)=>json<{ok:boolean}>(`${computer(id)}/start`,{method:"POST"}),
 stopComputer:(id:string)=>json<{ok:boolean}>(`${computer(id)}/stop`,{method:"POST"}),
 destroyComputer:(id:string)=>json<{ok:boolean}>(computer(id),{method:"DELETE"}),
 createWordPressLoginHandoff:(id:string)=>json<{path:string}>(`${computer(id)}/wordpress-login-handoffs`,{method:"POST"}),
 prepareWordPressUpdraftImport:(id:string,manifest:WordPressUpdraftImportManifest)=>json(`${computer(id)}/wordpress-updraft-imports/${encodeURIComponent(manifest.importId)}/prepare`,{method:"POST",body:JSON.stringify(manifest)}),
 getWordPressUpdraftImportStatus:(id:string,importId:string)=>json<WordPressUpdraftImportStatus>(`${computer(id)}/wordpress-updraft-imports/${encodeURIComponent(importId)}`),
 uploadFiles:(id:string,path:string,files:File[])=>{const form=new FormData();form.append("path",path);for(const file of files)form.append("files",file);return json(`${computer(id)}/files/upload`,{method:"POST",body:form});},
};
