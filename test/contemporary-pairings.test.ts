import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import programmes from '../web/programs.json' with {type:'json'};
import art from '../web/editions.json' with {type:'json'};
import sounds from '../web/sounds.json' with {type:'json'};
import {normalizeProgram} from '../src/programs.ts';
import {initialState} from '../src/types.ts';
import {drawEdition,editionPool,curatorKey} from '../src/rotation.ts';
import {timer,keep,nextEdition} from '../src/domain.ts';
const batch=programmes.filter(p=>p.collection==='contemporary-pairings');
const pairs=new Map(batch.map(p=>[p.media.edition!,p]));
test('235 fixed bilingual pairs cover every new visual with 37 licensed recordings and all seven browsing styles',()=>{
 assert.equal(batch.length,235);
 assert.equal(pairs.size,235);
 const expected=Object.entries(art).filter(([,a])=>'library' in a&&a.library==='contemporary').map(([id])=>id).sort();
 assert.deepEqual(batch.map(p=>p.media.edition!.split('@')[0]).sort(),expected);
 assert.equal(new Set(batch.map(p=>p.media.edition!.split('@')[1])).size,37);
 assert.equal(new Set(batch.map(p=>p.style)).size,7);
 for(const raw of batch){
  const p=normalizeProgram(raw);assert.equal(p.language,'en');assert.equal(p.facts.length,2);
  assert.equal(p.translations?.['zh-CN'].facts.length,2);assert.ok(p.note && p.translations?.['zh-CN'].note);
  const [work,track]=raw.media.edition!.split('@');const a=(art as any)[work],s=(sounds as any)[track];
  assert.equal(p.facts[0].source,a.source);assert.equal(p.translations?.['zh-CN'].facts[0],a.translations['zh-CN'].fact);
  assert.ok(s.license && s.licenseUrl && s.credit);assert.ok(existsSync('web/'+track+'.mp3'));
 }
});
test('fixed pairs survive two full passes and restart, with no immediate music repeat',()=>{
 let s=initialState(),previous='field@arabesque';
 for(let pass=0;pass<2;pass++){
  const seen=new Set<string>();
  for(let i=0;i<235;i++){
   if(i===90)s=JSON.parse(JSON.stringify(s));
   const next=drawEdition(s,previous);assert.equal(next.programId,pairs.get(next.edition)?.id);
   assert.ok(pairs.has(next.edition));assert.ok(!seen.has(next.edition));seen.add(next.edition);
   assert.notEqual(next.edition.split('@')[1],previous.split('@')[1]);previous=next.edition;
  }
  assert.equal(seen.size,235);
 }
});
test('automatic and Codex selections carry programme identity into saves without interrupting clocks or explicit queues',()=>{
 const s=initialState();timer(s,'start',25,1000);const t=s.sessions.at(-1)!;
 assert.equal(t.programId,pairs.get(t.edition!)?.id);keep(s,2000);
 assert.equal(s.events.findLast(e=>e.kind==='keep')?.program?.media.kind,'edition');
 assert.equal(s.events.findLast(e=>e.kind==='keep')?.program?.id,t.programId);
 s.settings.connected=true;s.settings.curateNext=true;
 const pick=editionPool(s,t.edition!)[0];s.curatorPick={edition:pick,key:curatorKey(s,t.edition!),reason:'A test preference'} as any;
 const deadline=t.deadline;nextEdition(s);assert.equal(t.deadline,deadline);assert.equal(t.editionSource,'codex');assert.equal(t.programId,pairs.get(pick)?.id);
 s.nextProgram='first-light-wheat-and-branches';nextEdition(s);assert.equal(s.nextProgram,'first-light-wheat-and-branches');
 timer(s,'end',25,3000);timer(s,'start',25,4000);assert.equal(s.sessions.at(-1)?.programId,'first-light-wheat-and-branches');
 s.settings.visualLibrary='museum';nextEdition(s);assert.equal(s.sessions.at(-1)?.programId,undefined);
});
