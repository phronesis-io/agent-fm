import {test} from 'node:test';import assert from 'node:assert/strict';
import {initialState} from '../src/types.ts';import {switchProgram,current,timer} from '../src/domain.ts';
const a='sound-first-010',b='sound-first-011';
test('explicit switching preserves clock, pause, queue and session; invalid IDs are atomic',()=>{
 const s=initialState();timer(s,'start',25);timer(s,'pause');s.nextProgram=b;
 const t=current(s);const before={id:t.id,state:t.state,deadline:t.deadline,remaining:t.remaining,started:t.started};
 switchProgram(s,a);assert.deepEqual({id:t.id,state:t.state,deadline:t.deadline,remaining:t.remaining,started:t.started},before);assert.equal(s.nextProgram,b);
 const once=JSON.stringify(s);switchProgram(s,a);assert.equal(JSON.stringify(s),once);
 assert.throws(()=>switchProgram(s,'missing'));assert.equal(JSON.stringify(s),once);
 assert.equal(s.sessions.length,1);
});
test('untimed explicit choice survives start and an explicit queue takes priority',()=>{
 const s=initialState();switchProgram(s,a);timer(s,'start',25);assert.equal(current(s).programId,a);
 const q=initialState();switchProgram(q,a);q.nextProgram=b;timer(q,'start',25);assert.equal(current(q).programId,b);
});
