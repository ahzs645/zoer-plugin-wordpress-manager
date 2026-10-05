import {expect,test} from "bun:test";
import {createMigrationClient,explainLocalCopies,MIGRATION_ID,summarize} from "../tools/migrate-host-transfers";

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

test("a second legacy copy of the same target is reported as a duplicate target, not as already migrated",()=>{
 const target="ddev-zoer-connect-040-ui-copy-7072e286";
 // Zoer queues the newest copy first: its local-copy and site-link records, then the older copy, whose link is skipped.
 const report={localCopies:{planned:[{id:"local-copy:newer"},{id:`site-link:${target}`},{id:"local-copy:older"}],skipped:[{id:`site-link:${target}`,reason:"already migrated"}]}};
 expect(explainLocalCopies(report.localCopies)).toEqual([{id:`site-link:${target}`,reason:`duplicate target: 2 legacy local copies point at ${target}; the newest (local-copy:newer) keeps the site link, the others are kept as local-copy records only`}]);
 expect(summarize({apply:false,report})).toContain(`- site-link:${target}: duplicate target: 2 legacy local copies`);
 // A link that really exists (a rerun) stays "already migrated".
 const rerun={localCopies:{planned:[],skipped:[{id:"local-copy:newer",reason:"already migrated"},{id:`site-link:${target}`,reason:"already migrated"},{id:"local-copy:older",reason:"already migrated"},{id:`site-link:${target}`,reason:"already migrated"}]}};
 expect(explainLocalCopies(rerun.localCopies).every(row=>row.reason==="already migrated")).toBe(true);
 // Applied runs list created records the same way.
 expect(explainLocalCopies({created:[{id:"local-copy:a"},{id:"site-link:t"},{id:"local-copy:b"},{id:"local-copy:c"}],skipped:[{id:"site-link:t",reason:"already migrated"},{id:"site-link:t",reason:"already migrated"}]})[0]!.reason).toStartWith("duplicate target: 3 legacy local copies point at t; the newest (local-copy:a)");
});
