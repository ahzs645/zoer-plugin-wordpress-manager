const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
async function run(limit) {
  let submit, received=0, reloaded=false, rejected=0;
  const file = new Blob([new Uint8Array(700000)]); file.name='module.zip';
  const button={disabled:false};
  const elements={
    'zcm-import-form':{reportValidity:()=>true,querySelector:()=>button,addEventListener:(_,fn)=>{submit=fn;}},
    'zcm-import-status':{textContent:''},'zcm-progress':{},
    'zcm-file':{files:[file]},'zcm-title':{value:'Course'},'zcm-entry':{value:''}
  };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../admin.js'),'utf8'), {
    document:{getElementById:id=>elements[id]},
    window:{addEventListener:()=>{},location:{reload:()=>{reloaded=true;}}},
    FormData, zcmAdmin:{url:'/ajax',nonce:'test',chunkBytes:524288,maxBytes:268435456},
    fetch:async (_,options)=>{
      const form=options.body,action=form.get('action');
      let data={upload:'session'};
      if(action==='zcm_chunk'){
        assert.equal(Number(form.get('offset')),received);
        if(form.get('chunk').size>limit){rejected++;return {status:413,ok:false};}
        received+=form.get('chunk').size; data={received};
      }
      if(action==='zcm_finish'){assert.equal(received,file.size);data={module:1,files:3};}
      return {status:200,ok:true,json:async()=>({success:true,data})};
    }
  });
  await submit({preventDefault:()=>{}});
  assert.equal(button.disabled,false);
  return {received,reloaded,rejected,message:elements['zcm-import-status'].textContent};
}
(async()=>{
  const success=await run(131072);
  assert.equal(success.reloaded,true);assert.equal(success.received,700000);assert.equal(success.rejected,2);
  const failure=await run(1);
  assert.equal(failure.reloaded,false);assert.equal(failure.received,0);assert.equal(failure.rejected,4);
  assert.match(failure.message,/server rejected/);
  console.log('PASS: adaptive 413 retries preserve offsets; lower bound stops safely; controls recover.');
})().catch(e=>{console.error(e);process.exitCode=1;});
