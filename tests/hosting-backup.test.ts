import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { FakeWorld } from "./fakes/host";
import { validateHostingSet } from "../plugin/worker/lib/updraft.js";
import { backupIdentity, backupSelectionError, classifyBackup } from "../src/components/extensions/backupFiles";
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const archiveName = "u123.example-com.20261006202752.tar.gz";
const databaseName = "u123_db.example-com.20261006202752.sql.gz";
const entry = (path: string) => ({ path, bytes: 42, sha256: "a".repeat(64) });

test("Hostinger pair validation binds account, domain, time and component; upload order is independent", () => {
  expect(validateHostingSet([entry(archiveName),entry(databaseName)]).map((c:any)=>c.component)).toEqual(["database","archive"]);
  for (const name of [databaseName.replace('u123_','u999_'), databaseName.replace('example-com','other-com'), databaseName.replace('20261006','20261005')]) expect(()=>validateHostingSet([entry(archiveName),entry(name)])).toThrow('same Hostinger');
  expect(()=>validateHostingSet([entry(archiveName),entry(archiveName)])).toThrow('Duplicate');
  expect(()=>validateHostingSet([entry('../'+archiveName),entry(databaseName)])).toThrow('filename');
  expect(()=>validateHostingSet([entry(archiveName),{...entry(databaseName),bytes:0}])).toThrow('size');
});
test("picker recognises both formats and rejects invalid or mixed Hostinger pairs", () => {
  expect(classifyBackup(databaseName,'hostinger')).toBe('database');
  expect(classifyBackup(archiveName,'updraft')).toBeNull();
  expect(classifyBackup('backup_x-db.gz','updraft')).toBe('database');
  expect(backupIdentity(archiveName,'archive','hostinger')).toBe(backupIdentity(databaseName,'database','hostinger'));
  expect(backupSelectionError({ archive:new File(['x'],archiveName),database:new File(['x'],databaseName)},'hostinger')).toBeNull();
  expect(backupSelectionError({ archive:new File(['x'],archiveName),database:new File(['x'],databaseName.replace('u123_','u999_'))},'hostinger')).toContain('same Hostinger');
  expect(backupSelectionError({ archive:new File([],archiveName)},'hostinger')).toContain('1 byte');
});

type Member = { name:string; data?:string; type?:string; link?:string };
function tar(members: Member[]) {
  const parts: Buffer[]=[];
  for (const m of members) {
    const data=Buffer.from(m.data??''); const h=Buffer.alloc(512);
    h.write(m.name,0,100); h.write('0000644\0',100); h.write('0000000\0',108); h.write('0000000\0',116);
    h.write(data.length.toString(8).padStart(11,'0')+'\0',124); h.write('00000000000\0',136); h.fill(32,148,156); h.write(m.type??'0',156); h.write(m.link??'',157,100); h.write('ustar\0',257); h.write('00',263);
    const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    parts.push(h,data,Buffer.alloc((512-data.length%512)%512));
  }
  parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
const web='./domains/example.com/public_html/';
const base: Member[]=[{name:'./',type:'5'}, {name:web+'wp-config.php',data:'<?php NEVER_EXECUTE();'}, {name:web+'wp-includes/version.php',data:"<?php $wp_version = '6.9.4';"}, {name:web+'wp-content/themes/t/style.css',data:'x'}, {name:web+'wp-content/uploads/a.jpg',data:'jpg'}, {name:web+'wp-content/object-cache.php',data:'<?php'}, {name:web+'wp-content/mu-plugins/x.php',data:'<?php'}];
function sql() {
  const chunks=['-- MariaDB dump\n/*!40101 SET NAMES utf8mb4 */;'];
  for (const table of ['options','posts','users','usermeta']) {
    const columns=table==='options'?'  `option_id` bigint NOT NULL,\n  `option_name` varchar(191) NOT NULL,\n  `option_value` longtext NOT NULL':'  `ID` bigint NOT NULL';
    chunks.push(`DROP TABLE IF EXISTS \`wp_${table}\`;\nCREATE TABLE \`wp_${table}\` (\n${columns}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    chunks.push('SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;');
    if(table==='options') chunks.push("INSERT INTO `wp_options` VALUES\n(1,'home','https://example.com'),\n(2,'siteurl','https://example.com'),\n(3,'active_plugins','a:0:{}');");
    else chunks.push(`INSERT INTO \`wp_${table}\` VALUES\n(1);`);
    chunks.push('COMMIT;\nSET AUTOCOMMIT=@OLD_AUTOCOMMIT;');
  }
  return chunks.join('\n')+'\n';
}
const temp=mkdtempSync(join(tmpdir(),'wpm-hosting-test-'));
afterAll(()=>rmSync(temp,{recursive:true,force:true}));
let counter=0;
function prepareRaw(archive: Buffer, db: Buffer, corrupt=false) {
  const root=join(temp,String(counter++));mkdirSync(root);
  writeFileSync(join(root,'archive.gz'),archive);writeFileSync(join(root,'database.gz'),db);
  const components=Object.fromEntries(([['archive',archive],['database',db]] as const).map(([name,bytes])=>[name,{path:join(root,name+'.gz'),size:bytes.length,sha256:corrupt?'0'.repeat(64):digest(bytes)}]));
  const script=resolve('plugin/computer/wordpress/prepare-hostinger.php');
  const code=`require ${JSON.stringify(script)};try {$p=hosting_prepare(${JSON.stringify(root)}, json_decode(${JSON.stringify(JSON.stringify(components))},true));echo json_encode($p);}catch(Throwable $e){fwrite(STDERR,$e->getMessage());exit(1);}`;
  const proc=Bun.spawnSync(['php','-r',code]);
  return {status:proc.exitCode,error:proc.stderr.toString(),prepared:proc.exitCode===0?JSON.parse(proc.stdout.toString()):null,root};
}

const prepare = (members=base, database=sql(), corrupt=false) => prepareRaw(tar(members),gzipSync(database),corrupt);

describe("real PHP preparation (no mocked SQL converter or extractor)",()=>{
  test("creates the guarded import format, derives metadata from literal options and omits core/configuration",()=>{
    const result=prepare();expect(result.status).toBe(0);
    expect(result.prepared.metadata).toMatchObject({prefix:'wp_',sourceUrl:'https://example.com',tables:4,wordpressVersion:'6.9.4'});
    expect(result.prepared.files.map((f:any)=>f.path)).toEqual(['database.sql','wp-content/themes/t/style.css','wp-content/uploads/a.jpg']);
    const converted=readFileSync(join(result.root,'extracted/database.sql'),'utf8');
    expect(converted).toStartWith('-- Zoer Connect database snapshot');expect(converted).not.toContain('AUTOCOMMIT');expect(converted).toContain("X'68747470733a2f2f6578616d706c652e636f6d'");
  });
  test("rejects traversal, links, special files, duplicate paths and multiple installations",()=>{
    for (const m of [{name:'../evil',data:'x'},{name:web+'wp-content/link',type:'2',link:'/etc/passwd'},{name:'fifo',type:'6'},{...base[3]},{name:'other/wp-includes/version.php',data:"<?php $wp_version='6.9.4';"}]) expect(prepare([...base,m]).status).toBe(1);
  });
  test("checks SHA-256 and refuses executable uploads",()=>{
    expect(prepare(base,sql(),true).error).toContain('SHA-256');
    expect(prepare([...base,{name:web+'wp-content/uploads/x.php',data:'<?php system(1);'}]).error).toContain('Executable upload');
  });
  test("rejects arbitrary SQL, expressions, wrong database scope, multisite and non-root URLs",()=>{
    for (const dump of [sql()+'SELECT SLEEP(1);\n',sql().replace('(1);','(SLEEP(1));'),sql().replaceAll('`wp_posts`','`other_posts`'),sql().replace('https://example.com','https://example.com/subdir'),sql()+'CREATE TABLE `wp_blogs` (\n `id` bigint\n) ENGINE=InnoDB;\n']) expect(prepare(base,dump).status).toBe(1);
  });
  test("handles GNU long paths without trusting their extraction names",()=>{
    const path=web+'wp-content/uploads/'+ 'a'.repeat(110)+'.jpg';
    const result=prepare([...base,{name:'././@LongLink',type:'L',data:path+'\0'},{name:path.slice(0,90),data:'jpg'}]);
    expect(result.status).toBe(0);expect(result.prepared.files.at(-1).path).toEndWith('a'.repeat(110)+'.jpg');
  });
});


describe("Hostinger resumable restore pipeline",()=>{
  test("stages both components in canonical order and uses the PHP hosting preparer through to final verification",async()=>{
    const w=new FakeWorld();
    const setId=w.sets.sealed("Hostinger",{[archiveName]:tar(base),[databaseName]:gzipSync(sql())});
    const original=w.ddev.invoke.bind(w.ddev);
    w.ddev.invoke=(input:any)=>{
      if(input.operation!=="runtime.exec.v1" || input.args.command!=="wordpress.hostinger.prepare")return original(input);
      const plan=JSON.parse(input.args.files.find((f:any)=>f.name==="plan.json").text);
      expect(plan.components.map((c:any)=>[c.component,c.source])).toEqual([["database","0"],["archive","1"]]);
      const stage=w.ddev.sites.get(input.resourceId)!.stage.get(plan.id)!;
      const prepared=prepareRaw(stage.get("1")!,stage.get("0")!);
      if(prepared.status!==0)throw new Error(prepared.error);
      for(const f of prepared.prepared.files)stage.set(f.source,readFileSync(join(prepared.root,f.source)));
      stage.set("prepared.json",Buffer.from(JSON.stringify(prepared.prepared)));
      w.ddev.commands.push({command:input.args.command,resourceId:input.resourceId,plan});
      return {exitCode:0,stdoutTail:JSON.stringify({metadata:prepared.prepared.metadata,warnings:prepared.prepared.warnings,fileCount:prepared.prepared.files.length,databaseSha256:prepared.prepared.files[0].sha256}),stderrTail:""};
    };
    const result:any=await w.run("backup.restore-local",{uploadSetId:setId,restoreId:"a".repeat(32),name:"Hosting restored"});
    expect(result.status).toBe("succeeded");
    const site=w.ddev.sites.get(result.output.targetId)!;
    expect(site.files.get("wp-content/themes/t/style.css")!.toString()).toBe("x");
    expect(site.files.has("wp-content/object-cache.php")).toBe(false);
    expect(site.home).toBe(result.output.targetUrl);
    expect(w.ddev.commands.map(c=>c.command)).toEqual(["wordpress.copy.prepare","wordpress.hostinger.prepare","wordpress.copy.database","wordpress.copy.files","wordpress.copy.finish"]);
    expect(w.catalog.records.get("local-copy:"+"a".repeat(32))?.data.phase).toBe("complete");
  });
  test("mismatched pairs are refused before provisioning a destination",async()=>{
    const w=new FakeWorld();
    const setId=w.sets.sealed("Hostinger",{[archiveName]:tar(base),[databaseName.replace('u123_','u999_')]:gzipSync(sql())});
    const result:any=await w.run("backup.restore-local",{uploadSetId:setId,name:"Bad pair"});
    expect(result.status).toBe("failed");expect(result.error.message).toContain("same Hostinger");expect(w.ddev.sites.size).toBe(0);
  });
});


test("maintenance guard preserves its PHP path literal and local HTTPS checks match the bridge",()=>{
  const path="/var/www/.zoer-local-copy/a'b/pending";
  const lib=resolve('plugin/computer/wordpress/lib.php');
  const code=`require ${JSON.stringify(lib)};echo zoer_copy_guard_source(${JSON.stringify(path)});`;
  const proc=Bun.spawnSync(['php','-r',code]);expect(proc.exitCode).toBe(0);
  const guard=proc.stdout.toString();
  expect(guard).not.toContain('\\/var');expect(guard).toContain("http_response_code(503)");
  const literal=/is_file\((.*?)\)/.exec(guard)![1];
  const parsed=Bun.spawnSync(['php','-r',`echo ${literal};`]);expect(parsed.stdout.toString()).toBe(path);
  const finish=readFileSync(resolve('plugin/computer/wordpress/finish-copy.php'),'utf8');
  expect(finish).toContain("'X-Forwarded-Proto: https'");expect(finish).toContain('zoer_copy_guard_source');
});
