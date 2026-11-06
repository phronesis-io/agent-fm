import {readFileSync,writeFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const art=read('web/editions.json'),sounds=read('web/sounds.json');
const decisions=read('docs/research/contemporary-pairing-editorial.json');
const previous=read('web/programs.json').filter(p=>p.collection!=='contemporary-pairings');
const clean=t=>t.replace(/\.(?:jpg|jpeg|png|webp)$/i,'');
const title=t=>clean(t).length<=160?clean(t):clean(t).slice(0,156).replace(/\s+\S*$/,'')+'…';
const next=decisions.map(d=>{
 const w=art[d.work],s=sounds[d.sound];
 if(!w||!s||w.library!=='contemporary')throw Error('Unknown pairing '+d.work);
 const reference=previous.find(p=>p.media.kind==='edition'&&p.media.edition.split('@')[1]===d.sound&&p.facts.length>=2&&p.translations?.['zh-CN']?.facts.length>=2);
 if(!reference)throw Error('Missing reviewed recording facts '+d.sound);
 const originalTitle=clean(w.originalTitle||w.art)+' × '+s.track;
 if(originalTitle.length>240)throw Error('Original title too long '+d.work);
 return {id:'now-'+d.work,revision:1,curator:'Agent FM · Codex-assisted',collection:'contemporary-pairings',
 title:title(w.art),originalTitle,language:'en',tags:[w.collection,'contemporary-pairings'],style:reference.style,
 facts:[{text:w.fact,source:w.source},reference.facts[1]],note:d.note,
 media:{kind:'edition',edition:d.work+'@'+d.sound},
 translations:{'zh-CN':{title:title(w.translations['zh-CN'].title),facts:[w.translations['zh-CN'].fact,reference.translations['zh-CN'].facts[1]],note:d.noteZh}}};
});
if(next.length!==235||new Set(next.map(p=>p.id)).size!==235)throw Error('Expected 235 unique programmes');
writeFileSync(new URL('../web/programs.json',import.meta.url),JSON.stringify([...previous,...next],null,2)+'\n');
console.log(JSON.stringify({added:next.length,recordings:new Set(decisions.map(x=>x.sound)).size,total:previous.length+next.length}));
