import {test} from "node:test";
import assert from "node:assert/strict";
import {completionReminder} from "../src/reminder.ts";
test("completion reminds once, excluding history, pause and stale completion",()=>{
 let count=0;
 const old={id:"old",kind:"completed",at:900};
 const remind=completionReminder([old],()=>count++);
 const fresh={id:"new",kind:"completed",at:1000};
 remind([old,{id:"pause",kind:"pause",at:1000},fresh],1100);
 remind([old,fresh],1200);
 remind([{id:"stale",kind:"completed",at:1000}],130000);
 assert.equal(count,1);
});
import {initialState} from "../src/types.ts";
import {timer,tick} from "../src/domain.ts";
test("real timer completion reaches reminder after pause and resume",()=>{
 const s=initialState();let calls=0;
 const remind=completionReminder(s.events,()=>calls++);
 timer(s,"start",1,1000);
 timer(s,"pause",1,2000);tick(s,false,90000);remind(s.events,90000);
 assert.equal(calls,0);
 timer(s,"resume",1,100000);tick(s,false,159000);remind(s.events,159000);
 tick(s,false,160000);remind(s.events,160000);
 assert.equal(calls,1);
});
