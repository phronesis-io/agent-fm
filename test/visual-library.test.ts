import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import art from '../web/editions.json' with {type:'json'};
import {initialState} from '../src/types.ts';
import {drawEdition,editionPool,visualIds} from '../src/rotation.ts';
import {timer} from '../src/domain.ts';

test('new visual files have unique hashes, licensed sources and bundled Chinese titles and facts',()=>{
 const ids=visualIds('contemporary');assert.ok(ids.length>=200);
 const hashes=new Set<string>();
 for(const id of ids){
  const a=(art as Record<string,any>)[id];
  for(const key of ['source','licenseUrl'])assert.ok(a[key]?.startsWith('https://'),id+': '+key);
  assert.ok(a.credit && a.license && a.sourceName);
  assert.ok(a.translations['zh-CN'].title && a.translations['zh-CN'].fact);
  const digest=createHash('sha256').update(readFileSync('web'+a.image)).digest('hex');
  assert.equal(digest,a.sha256,id);assert.ok(!hashes.has(digest),id+' duplicate');hashes.add(digest);
 }
});
test('default moves to images only on the next draw; library switch and explicit programme queue preserve the current timer',()=>{
 const s=initialState();s.settings.visualLibrary='museum';
 timer(s,'start',25,1000);const t=s.sessions.at(-1)!;
 const before=JSON.stringify(t);const nextProgram='first-light-wheat-and-branches';s.nextProgram=nextProgram;
 delete s.settings.visualLibrary;
 const pool=editionPool(s,t.edition!);assert.ok(pool.every(e=>visualIds('contemporary').includes(e.split('@')[0])));
 assert.equal(JSON.stringify(t),before);assert.equal(s.nextProgram,nextProgram);
 timer(s,'end',25,2000);timer(s,'start',25,3000);
 assert.equal(s.sessions.at(-1)!.programId,nextProgram);
 assert.equal(s.sessions.at(-1)!.edition,'field@arabesque');
});
for(const library of ['contemporary','all'] as const)test(library+' visits each image once per pass, survives restart and preserves sound alternation',()=>{
 let s=initialState();s.settings.visualLibrary=library;let previous='field@arabesque';const seen=new Set<string>();
 for(let i=0;i<visualIds(library).length;i++){
  if(i===90)s=JSON.parse(JSON.stringify(s));
  const next=drawEdition(s,previous).edition;const [id,sound]=next.split('@');
  assert.ok(visualIds(library).includes(id));assert.ok(!seen.has(id));seen.add(id);
  assert.notEqual(id,previous.split('@')[0]);assert.notEqual(sound,previous.split('@')[1]);previous=next;
 }
 assert.equal(seen.size,visualIds(library).length);
 s.settings.visualLibrary='museum';
 assert.ok(editionPool(s,previous).every(e=>visualIds('museum').includes(e.split('@')[0])));
});
