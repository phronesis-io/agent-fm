import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import programs from '../web/programs.json' with {type:'json'};
import sounds from '../web/sounds.json' with {type:'json'};
import works from '../web/editions.json' with {type:'json'};
import recordings from '../docs/research/independent-recordings.json' with {type:'json'};
import {normalizeProgram} from '../src/programs.ts';
import {editionPool} from '../src/rotation.ts';
import {initialState} from '../src/types.ts';

test('independent collection adds twenty real recordings by ten identities, with provenance and no rotation change',()=>{
 const batch=programs.filter(p=>p.collection==='independent-sounds');assert.equal(batch.length,20);
 assert.equal(recordings.length,20);assert.equal(new Set(recordings.map(r=>r.creatorIdentity)).size,10);
 assert.equal(new Set(recordings.map(r=>r.sourceSha256)).size,20);assert.equal(new Set(recordings.map(r=>r.pairedImage)).size,20);
 for(const raw of batch){
  const p=normalizeProgram(raw);assert.equal(p.language,'en');assert.equal(p.media.kind,'edition');if(p.media.kind!=='edition')continue;
  const [art,track]=p.media.edition.split('@');const r=recordings.find(r=>r.id===track)!;assert.ok(r);
  const a=(works as Record<string,any>)[art];const s=(sounds as Record<string,any>)[track];assert.ok(a&&s);
  assert.equal(s.curatedOnly,true);assert.equal(s.creatorIdentity,r.creatorIdentity);assert.equal(s.recordingSource,r.source);assert.equal(s.licenseUrl,r.licenseUrl);
  assert.ok(/^https:\/\/creativecommons.org\/(licenses\/by(?:-sa)?\/|publicdomain\/zero\/)/.test(s.licenseUrl));
  assert.equal(p.facts[0].source,a.source);assert.equal(p.facts[1].source,r.source);assert.equal(p.facts[2].source,r.creatorSource);
  assert.equal(p.translations?.['zh-CN'].facts.length,p.facts.length);assert.ok(existsSync('web'+a.image));assert.ok(r.duration>100);assert.equal(r.fullDecode,true);
  assert.equal(createHash('sha256').update(readFileSync('web/'+track+'.mp3')).digest('hex'),r.sha256);
 }
 for(const visualLibrary of ['contemporary','museum','all'] as const){const s=initialState();s.settings.visualLibrary=visualLibrary;assert.ok(editionPool(s,'field').every(e=>!e.includes('@pf-')));}
});
