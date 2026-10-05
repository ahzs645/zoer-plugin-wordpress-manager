import {expect,test} from "bun:test";
import {createMigrationClient,MIGRATION_ID,summarize} from "../tools/migrate-host-transfers";

test("the migration tool is a dry run unless --apply and talks only to the operator API",async()=>{
 const calls:any[]=[];
 const fetch=(async(url:string,init:any={})=>{calls.push({url,method:init.method??"GET",body:init.body,auth:init.headers.authorization});
  return new Response(JSON.stringify(url.endsWith("data-migrations")?{migrations:[{id:MIGRATION_ID}]}:{id:MIGRATION_ID,apply:JSON.parse(init.body).apply,report:{pulls:{planned:[{id:"pull:a"}],skipped:[{id:"pull:b",reason:"digest changed"}]},presets:{planned:[],skipped:[]}}}),{status:200});}) as unknown as typeof globalThis.fetch;
 const client=createMigrationClient({zoerUrl:"https://zoer.example/",token:"t",fetch});
 expect(await client.available()).toBe(true);
 const result=await client.run(false);
 expect(calls.map(c=>[c.method,c.url])).toEqual([["GET","https://zoer.example/api/admin/data-migrations"],["POST",`https://zoer.example/api/admin/data-migrations/${MIGRATION_ID}`]]);
 expect(JSON.parse(calls[1].body)).toEqual({apply:false});expect(calls[1].auth).toBe("Bearer t");
 expect(summarize(result)).toBe(`Dry run of ${MIGRATION_ID}\n  pulls: 1 planned, 1 skipped\n    - pull:b: digest changed\n  presets: 0 planned, 0 skipped`);
});
