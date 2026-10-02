import {expect,test} from "bun:test";
import {bindHost,hostRequest} from "../src/host/bridge";
import {json} from "../src/lib/api/_http";
test("bridge preserves structured bodies, binary chunks and API errors",async()=>{
 const requests:unknown[]=[];const unbind=bindHost({request:async(method,input)=>{requests.push({method,input});return {ok:true};},subscribe:()=>()=>{}});
 try{await json("/wordpress-manager/test",{method:"POST",body:JSON.stringify({domain:"example.test"})});expect(requests[0]).toMatchObject({method:"api.request",input:{body:{domain:"example.test"},method:"POST"}});
 const bytes=new Blob(["chunk"]);await json("/wordpress-manager/upload",{method:"PUT",body:bytes});expect((requests[1] as any).input.body).toBe(bytes);
 const form=new FormData();form.set("files",new File(["data"],"000000.part"));await json("/wordpress-manager/upload",{method:"POST",body:form});expect((requests[2] as any).input.body).toBe(form);
 }finally{unbind();}
 await expect(hostRequest("api.request")).rejects.toThrow("inside Zoer");
});
test("closing the workspace invalidates an in-flight response",async()=>{
 let done!:(value:unknown)=>void;const unbind=bindHost({request:()=>new Promise(resolve=>{done=resolve;}),subscribe:()=>()=>{}});const request=hostRequest("api.request");unbind();done({ok:true});await expect(request).rejects.toThrow("closed");
});
test("cancelled operations cannot start another backend request",async()=>{
 let calls=0;const unbind=bindHost({request:async()=>{calls++;return {};},subscribe:()=>()=>{}});const c=new AbortController();c.abort();try{await expect(json("/wordpress-manager/sites",{signal:c.signal})).rejects.toThrow("Aborted");expect(calls).toBe(0);}finally{unbind();}
});
