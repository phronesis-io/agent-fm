import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {serve} from "../src/server.ts";

test("the latest explicit queue choice wins in either direction",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-program-queue-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 try {
  const key=new URL(app.issueLink()).hash.slice(6);
  const paired=await fetch(app.origin+"/api/pair",{
   method:"POST",headers:{Origin:app.origin,"Content-Type":"application/json"},body:JSON.stringify({key})
  });
  assert.equal(paired.status,200);
  const headers={Origin:app.origin,"Content-Type":"application/json",Cookie:paired.headers.get("set-cookie")!.split(";")[0],Authorization:`Bearer ${readFileSync(join(dir,"control.secret"),"utf8")}`};
  async function post(path:string,body:unknown) {
   const response=await fetch(app.origin+path,{method:"POST",headers,body:JSON.stringify(body)});
   assert.equal(response.status,200,await response.clone().text());
   return response.json();
  }
  await post("/api/programs/select",{id:"lofi-synthwave"});
  const listening=await post("/api/queue-listening",{index:0});
  assert.equal(app.store.read().nextProgram,undefined);
  assert.equal(app.store.read().nextListeningEdition,listening.edition);
  await post("/api/timer",{action:"start",minutes:25});
  let session=app.store.read().sessions.at(-1)!;
  assert.equal(session.programId,undefined);
  assert.equal(session.edition,listening.edition);
  await post("/api/timer",{action:"end"});

  await post("/api/queue-listening",{index:1});
  await post("/api/programs/select",{id:"lofi-synthwave"});
  assert.equal(app.store.read().nextListeningEdition,undefined);
  assert.equal(app.store.read().nextProgram,"lofi-synthwave");
  await post("/api/timer",{action:"start",minutes:25});
  session=app.store.read().sessions.at(-1)!;
  assert.equal(session.programId,"lofi-synthwave");
  assert.equal(app.store.read().nextListeningEdition,undefined);
  assert.equal(app.store.read().nextProgram,undefined);
 } finally {await app.stop();rmSync(dir,{recursive:true,force:true})}
});
