import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Store} from "../src/store.ts";
import {programCommand,normalizeProgram,listPrograms} from "../src/programs.ts";
import {initialState} from "../src/types.ts";
import {timer} from "../src/domain.ts";
const draft = {
 id:"test-program", title:"Test",originalTitle:"Test original",language:"en",
 tags:["game music"],facts:[{text:"A test fact",source:"https://example.org/source"}],
 note:"An editorial observation.",media:{kind:"youtube",url:"https://www.youtube.com/watch?v=tRsQsTMvPNg"}
};
const resolver=async()=>({id:"tRsQsTMvPNg",title:"Claude FM"});
test("program drafts validate sources and distinguish checks from factual verification", async()=>{
 for(const p of listPrograms(initialState())) assert.equal(normalizeProgram(p).id,p.id);
 assert.throws(()=>normalizeProgram({...draft,media:{kind:"youtube",url:"https://example.org/a"}}));
 assert.throws(()=>normalizeProgram({...draft,facts:[{text:"x",source:"javascript:alert(1)"}]}));
 assert.throws(()=>normalizeProgram({...draft,language:"invalid_thing"}));
});
test("preparing is idempotent and selection only applies at next timer start",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-program-"));const store=new Store(join(dir,"space.sqlite"));
 try{
  const original=store.update(s=>timer(s,"start",25,1000));
  await programCommand(store,"prepare",{program:draft},resolver);
  await programCommand(store,"prepare",{program:draft},resolver);
  assert.equal(store.read().programs?.length,1);
  await assert.rejects(()=>programCommand(store,"prepare",{program:{...draft,title:"changed"}},resolver));
  await programCommand(store,"select",{id:draft.id});
  const active=store.read().sessions[0];
  assert.equal(active.deadline,original.deadline);
  assert.equal(active.programId,original.programId);
  store.update(s=>timer(s,"end",25,2000));
  const next=store.update(s=>timer(s,"start",25,3000));
  assert.equal(next.programId,draft.id);
  assert.equal(store.read().nextProgram,undefined);
  assert.equal(store.read().events.filter(e=>e.kind==="program-start" && e.detail===draft.id).length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
test("concurrent prepare refuses different content with the same id",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-program-race-"));const store=new Store(join(dir,"space.sqlite"));
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r);
 try{
  const first=programCommand(store,"prepare",{program:draft},async()=>{await waiting;return resolver()});
  await programCommand(store,"prepare",{program:{...draft,title:"second"}},resolver);
  release();
  await assert.rejects(()=>first);
  assert.equal(store.read().programs?.[0].title,"second");
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

test("programme translations retain source alignment and immutable revision",async()=>{
 const extended={...draft,revision:1,curator:"Agent FM",collection:"personal",translations:{"zh-CN":{title:"测试",facts:["一条事实"],note:"编选判断"}}};
 assert.deepEqual(normalizeProgram(extended),extended);
 assert.throws(()=>normalizeProgram({...extended,revision:0}));
 assert.throws(()=>normalizeProgram({...extended,translations:{"zh-CN":{title:"测试",facts:[],note:"说明"}}}));
 const dir=mkdtempSync(join(tmpdir(),"fm-program-localized-"));const store=new Store(join(dir,"space.sqlite"));
 try {
   await assert.rejects(()=>programCommand(store,"prepare",{program:{...extended,collection:"first-light"}},resolver));
   await programCommand(store,"prepare",{program:extended},resolver);
   await assert.rejects(()=>programCommand(store,"prepare",{program:{...extended,revision:2}},resolver));
   assert.equal(store.read().programs?.[0].translations?.["zh-CN"].facts[0],"一条事实");
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

test("style is an optional declared browsing category, and editorial collections are reserved",async()=>{
 assert.equal(normalizeProgram({...draft,style:"jazz"}).style,"jazz");
 assert.equal(normalizeProgram(draft).style,undefined);
 assert.throws(()=>normalizeProgram({...draft,style:"guaranteed-focus"}));
 const dir=mkdtempSync(join(tmpdir(),"fm-style-"));const store=new Store(join(dir,"space.sqlite"));
 try {
  await assert.rejects(()=>programCommand(store,"prepare",{program:{...draft,collection:"focus-library"}},resolver));
  await assert.rejects(()=>programCommand(store,"prepare",{program:{...draft,collection:"contemporary-pairings"}},resolver));
  assert.equal(store.read().programs?.length??0,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
