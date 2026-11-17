import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import programs from '../web/programs.json' with {type:'json'};
import sounds from '../web/sounds.json' with {type:'json'};
import works from '../web/editions.json' with {type:'json'};
import {normalizeProgram} from '../src/programs.ts';
import evidence from '../docs/research/sound-first-recordings.json' with {type:'json'};

test('100 sound-first pairs have bounded reuse, aligned facts and intact recording provenance',()=>{
 const batch=programs.filter(p=>p.collection==='sound-first-preview');assert.equal(batch.length,100);
 const pairs=new Set<string>();const reuse=new Map<string,number>();
 for(const raw of batch){
  const p=normalizeProgram(raw);assert.equal(p.language,'en');assert.equal(p.media.kind,'edition');if(p.media.kind!=='edition')continue;
  pairs.add(p.media.edition);const [art,track]=p.media.edition.split('@');reuse.set(track,(reuse.get(track)??0)+1);
  const a=(works as Record<string,any>)[art];const s=(sounds as Record<string,any>)[track];assert.ok(a&&s);
  assert.equal(p.facts[0].source,a.source);assert.equal(decodeURIComponent(p.facts[1].source),decodeURIComponent(s.recordingSource??'https://commons.wikimedia.org/wiki/File:'+s.file.replaceAll(' ','_')));
  assert.equal(p.translations?.['zh-CN'].facts.length,p.facts.length);
  assert.ok(existsSync('web'+a.image));assert.ok(existsSync('web/'+track+'.mp3'));
 }
 assert.equal(pairs.size,100);assert.ok(reuse.size>=33);assert.ok(Math.max(...reuse.values())<=4);
 assert.equal(evidence.records.length,30);
 for(const r of evidence.records){
  assert.ok(reuse.has(r.id));const s=(sounds as Record<string,any>)[r.id];assert.equal(s.curatedOnly,true);
  assert.equal(s.recordingSource,r.source);assert.equal(s.licenseUrl,r.licenseUrl);assert.ok(r.duration>90);
  assert.equal(createHash('sha256').update(readFileSync('web/'+r.id+'.mp3')).digest('hex'),r.sha256);
 }
});
