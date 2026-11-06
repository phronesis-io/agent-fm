import {test} from "node:test";
import assert from "node:assert/strict";
import {initialState} from "../src/types.ts";
import {current,event,enqueue,removeSession} from "../src/domain.ts";
import {activitySummary} from "../src/activity.ts";

test("bounded activity evidence preserves saved sets through repeated tuning",()=>{
 const s=initialState();const t=current(s);
 event(s,t.id,"keep","field@arabesque");
 const saved=s.events[0].id;
 for(let i=0;i<45;i++)event(s,t.id,"source-selected","Station "+i);
 event(s,t.id,"pause","paused");
 const before=JSON.stringify(s);
 const summary=activitySummary(s,t.id)!;
 assert.equal(summary.sourceSelections.count,45);
 assert.equal(summary.sourceSelections.last?.value,"Station 44");
 assert.equal(summary.savedSets.evidence[0].eventId,saved);
 assert.equal(summary.pauseEvents.count,1);
 assert.equal(summary.completions.count,0);
 assert.equal(JSON.stringify(s),before);
 assert.equal(s.runs.length,0);
 const run=enqueue(s,"activity-snapshot","Tell me about this set");
 event(s,t.id,"source-selected","Later station");
 assert.equal(run.context?.activity?.sourceSelections.count,45);
 assert.equal(activitySummary(s,t.id)?.sourceSelections.count,46);
 removeSession(s,t.id);
 assert.equal(run.context,undefined);
 assert.equal(activitySummary(s,t.id),null);
});

test("activity evidence remains bounded and excludes other sessions",()=>{
 const s=initialState();const first=current(s);first.ended=Date.now();const second=current(s);
 for(let i=0;i<15;i++){event(s,first.id,"keep","old");event(s,second.id,"keep","new");}
 const summary=activitySummary(s,second.id)!;
 assert.equal(summary.savedSets.count,15);
 assert.equal(summary.savedSets.evidence.length,10);
 assert.ok(summary.savedSets.evidence.every(e=>e.value==="new"));
});
