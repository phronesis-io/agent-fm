import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import programs from "../web/programs.json" with {type:"json"};
import sounds from "../web/sounds.json" with {type:"json"};
import works from "../web/editions.json" with {type:"json"};
import {normalizeProgram} from "../src/programs.ts";
import {editionPool} from "../src/rotation.ts";
import {initialState} from "../src/types.ts";

test("first collection contains twenty complete, independently addressable bilingual pairs",()=>{
 const collection=programs.filter(p=>(p as any).collection==="first-light");
 assert.equal(collection.length,20);
 assert.equal(new Set(collection.map(p=>p.id)).size,20);
 const pairs=new Set<string>(); const tracks=new Set<string>();
 for(const raw of collection){
  const p=normalizeProgram(raw);
  assert.equal(p.revision,1);assert.ok(p.curator);
  assert.equal(p.language,"en");assert.ok(p.translations?.["zh-CN"]);
  assert.equal(p.media.kind,"edition");
  if(p.media.kind!=="edition")continue;
  pairs.add(p.media.edition);
  const [art,track]=p.media.edition.split("@");tracks.add(track);
  const w=(works as Record<string,any>)[art];
  assert.ok(existsSync("web/"+(w.image ? w.image.slice(1):art+".jpg")));
  assert.ok(existsSync("web/"+track+".mp3"));
  assert.ok(p.facts.length>=2,"Both art and recording need facts");
 }
 assert.equal(pairs.size,20);assert.ok(tracks.size>=16,"The collection must not recycle a handful of tracks");
});

test("curated additions do not change the museum roaming pool or reset its persisted bag",()=>{
 const s=initialState();s.settings.visualLibrary="museum";
 editionPool(s,"unknown");
 s.rotation!.remaining=s.rotation!.remaining.slice(20);
 const before=JSON.stringify(s.rotation);
 const pool=editionPool(s,"unknown");
 assert.equal(JSON.stringify(s.rotation),before);
 assert.equal(s.rotation!.offsets.length,16);
 for(const pair of pool) assert.notEqual((sounds as Record<string,any>)[pair.split("@")[1]].curatedOnly,true);
});

test("focus library spans seven declared styles with bounded reuse and no missing provenance",()=>{
 const library=programs.filter(p=>["first-light","focus-library"].includes((p as any).collection));
 assert.equal(library.length,100);
 assert.equal(new Set(library.map(p=>p.id)).size,100);
 const arts=new Map<string,number>(),tracks=new Map<string,number>(),styles=new Set<string>(),pairs=new Set<string>();
 for(const raw of library){
  const p=normalizeProgram(raw);
  assert.ok(p.style); styles.add(p.style!);
  assert.ok(p.translations?.["zh-CN"]);assert.ok(p.facts.length>=2);
  assert.equal(p.media.kind,"edition");if(p.media.kind!=="edition")continue;
  const [a,t]=p.media.edition.split("@");
  arts.set(a,(arts.get(a)??0)+1);tracks.set(t,(tracks.get(t)??0)+1);pairs.add(p.media.edition);
  assert.ok(existsSync("web/"+t+".mp3"));
  for(const f of p.facts) assert.ok(f.source.startsWith("https://"));
 }
 assert.equal(pairs.size,100);
 assert.deepEqual([...styles].sort(),["acoustic","ambient","beats","electronic","game","jazz","piano"]);
 assert.ok(tracks.size>=36);
 assert.ok(Math.max(...tracks.values())<=4);
 assert.ok(Math.max(...arts.values())<=2);
});
