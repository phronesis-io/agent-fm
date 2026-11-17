import {readFileSync,writeFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL(`../web/${name}.json`,import.meta.url),'utf8'));
const programs=read('programs'),sounds=read('sounds'),images=read('editions');
const local=programs.filter(p=>p.media?.edition);
const counts={};const missing=[];
for(const p of local){const [image,sound]=p.media.edition.split('@');counts[sound]=(counts[sound]??0)+1;if(!images[image]||!sounds[sound])missing.push(p.id);}
const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
const report={schema:1,programmes:programs.length,localPairs:local.length,uniquePairs:new Set(local.map(p=>p.media.edition)).size,pairedImages:new Set(local.map(p=>p.media.edition.split('@')[0])).size,pairedRecordings:sorted.length,availableImages:Object.keys(images).length,missingReferences:missing,styles:Object.fromEntries([...new Set(local.map(p=>p.style))].map(s=>[s,local.filter(p=>p.style===s).length])),recordingReuse:sorted.map(([id,pairs])=>({id,title:sounds[id].track,pairs})),topTenRecordingShare:Number((sorted.slice(0,10).reduce((n,x)=>n+x[1],0)/local.length).toFixed(4)),listeningReview:'Unknown: catalogue membership is not evidence of full human audition',culturalCoverage:'Not inferred: requires source-level research'};
const output=process.argv[2];if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');else console.log(JSON.stringify(report,null,2));
if(missing.length)process.exitCode=1;
