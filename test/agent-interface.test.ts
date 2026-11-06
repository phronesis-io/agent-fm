import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Store} from "../src/store.ts";
import {agentRequest} from "../src/agent-interface.ts";
import {current,event,removeSession} from "../src/domain.ts";
test("agent invitations retry safely; context and cursors respect deletion",()=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-agent-"));const store=new Store(join(dir,"s.db"));
 try{
  const input={command:"invitation create",id:"repeat-123",text:"hello"};
  const first=agentRequest(store,input);
  assert.deepEqual(agentRequest(store,input),first);
  assert.throws(()=>agentRequest(store,{...input,text:"changed"}));
  const id=store.update(s=>{const t=current(s);event(s,t.id,"play","rain");return t.id});
  const page=agentRequest(store,{command:"events read",limit:1}) as any;
  assert.equal(page.events.length,1);
  store.update(s=>removeSession(s,id));
  assert.throws(()=>agentRequest(store,{command:"events read",after:page.cursor}),/CURSOR_EXPIRED/);
  assert.throws(()=>agentRequest(store,{command:"invitation get",id:"repeat-123"}),/NOT_FOUND/);
  assert.deepEqual((agentRequest(store,{command:"context read"}) as any).messages,[]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});


test("invitation freezes source facts before a later source change",()=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-agent-snapshot-"));const store=new Store(join(dir,"s.db"));
 try {
  store.update(s=>{const t=current(s);t.programId="lofi-synthwave";event(s,t.id,"source-selected","Synthwave");});
  const request={command:"invitation create",id:"snapshot-123",text:"What is this programme?"};
  agentRequest(store,request);
  store.update(s=>{const t=current(s);delete t.programId;event(s,t.id,"source-selected","Another station");});
  agentRequest(store,request);
  const run=store.read().runs[0];
  assert.equal(run.context?.program?.id,"lofi-synthwave");
  assert.equal(run.context?.events.at(-1)?.detail,"Synthwave");
  assert.equal(store.read().runs.length,1);
  store.update(s=>removeSession(s,run.sessionId));
  assert.equal(store.read().runs[0].context,undefined);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
