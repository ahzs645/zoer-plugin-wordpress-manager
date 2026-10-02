import { queryOptions } from "@tanstack/react-query";
import { getApiBase, json } from "../api/_http";
const key=(name:string)=>["resources",getApiBase(),name] as const;
export const resourceQueries={
 connectors:()=>queryOptions({queryKey:key("connectors"),queryFn:async()=>(await json<{connectors:Array<{id:string;active:boolean;unavailableReason?:string|null}>}>("/wordpress-manager/workspace/connectors")).connectors,staleTime:60_000}),
 computers:()=>({queryKey:key("computers")}),
 secrets:()=>({queryKey:key("secrets")}),
};
