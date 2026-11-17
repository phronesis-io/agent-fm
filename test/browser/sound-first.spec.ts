import {test,expect} from '@playwright/test';
import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import programs from '../../web/programs.json' with {type:'json'};
import sounds from '../../web/sounds.json' with {type:'json'};
import {editionPool} from '../../src/rotation.ts';
test('sound-first previews play, translate, pause and stay out of automatic rotation',async({page})=>{
 test.setTimeout(300000);
 const dir=mkdtempSync(join(tmpdir(),'fm-preview-'));const app=await serve(dir,resolve('web'),{connect:false});
 const batch=programs.filter(p=>p.collection==='sound-first-preview');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  app.store.update(s=>{s.settings.language='zh-CN';});
  for(const library of ['contemporary','museum','all'] as const){const s=structuredClone(app.store.read());s.settings.visualLibrary=library;expect(editionPool(s,'field').some(e=>Object.keys(sounds).some(id=>(id.startsWith('sf-')||id==='sergo-duduk') && e.endsWith('@'+id)))).toBe(false);}
  await page.goto(app.issueLink());
  await page.locator('#station-open').click();await page.locator('#prepared-programs > summary').click();await page.locator('#program-search').fill('新声');
  await expect(page.locator('#program-list > details')).toHaveCount(100);
  for(const p of batch){
   await page.evaluate(async id=>{for(const [url,data] of [['/api/timer',{action:'end'}],['/api/programs/select',{id}],['/api/timer',{action:'start',minutes:25}]] as const){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error(await r.text());}},p.id);
   const sound=p.media.edition!.split('@')[1];
   await expect(page.locator('#local-player')).toHaveAttribute('src','/'+sound+'.mp3');
   await page.locator('.artwork').evaluate((img:HTMLImageElement)=>img.decode());
   await page.locator('#local-player').evaluate(async(a:HTMLAudioElement)=>{a.muted=true;await a.play();});
   await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
   await expect(page.locator('#label-shelf')).toContainText('试听');
   await expect(page.locator('#label-fact')).toHaveText(p.facts[0].text);
   await page.locator('#label-translate').click();await expect(page.locator('#label-fact')).toHaveText(p.translations!['zh-CN'].facts[0]);
   await page.locator('#label-translate').click();await expect(page.locator('#label-fact')).toHaveText(p.facts[0].text);
   // Close the station shelf before exercising the room controls.
   await page.keyboard.press('Escape');
   await page.locator('#clock').click();await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
   expect(app.store.read().sessions.at(-1)?.state).toBe('paused');
   await page.locator('#clock').click();await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
  }
  expect(errors).toEqual([]);await page.screenshot({path:'artifacts/sound-first-preview.png'});
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});
