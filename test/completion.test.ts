import {test} from "node:test";
import assert from "node:assert/strict";
import {initialState} from "../src/types.ts";
import {timer,tick,eligible,publicState} from "../src/domain.ts";
test("completion companion is opt-in, once per timer, visible and expires",()=>{
 const s=initialState();
 s.settings.completionCompanion=true;
 timer(s,"start",1,1000);tick(s,false,61000);tick(s,false,62000);
 const r=s.runs.find(r=>r.source==="completion")!;
 assert.ok(r);
 assert.equal(s.runs.length,1);
 assert.equal(publicState(s).runs.length,1);
 assert.equal(eligible(s,r,62000),true);
 assert.equal(eligible(s,r,190000),false);
 s.settings.completionCompanion=false;
 assert.equal(eligible(s,r,62000),false);
 const off=initialState();timer(off,"start",1,1000);tick(off,false,61000);
 assert.equal(off.runs.length,0);
});

test("completion cannot revive deleted sessions or exceed its daily budget",()=>{
 const s=initialState();s.settings.completionCompanion=true;
 // Separate completed Pomodoros share a local day and consume one call each.
 for(let i=0;i<25;i++) {
  const now=Date.UTC(2026,10,5,0,0)+i*120000;
  timer(s,"start",1,now);tick(s,false,now+60000);
  timer(s,"end",1,now+61000);
 }
 assert.equal(s.runs.filter(r=>r.source==="completion").length,24);
 const first=s.runs[0];s.sessions.find(t=>t.id===first.sessionId)!.deleted=true;
 assert.equal(eligible(s,first,first.created+1000),false);
});
