import {test,expect} from '@playwright/test';
import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import programmes from '../../web/programs.json' with {type:'json'};
import art from '../../web/editions.json' with {type:'json'};
const batch=programmes.filter(p=>p.collection==='contemporary-pairings');
test('all 235 new pairs reach their actual local image and recording; styles, queue and original text remain usable',async({page})=>{
 test.setTimeout(240000);
 const dir=mkdtempSync(join(tmpdir(),'fm-paired-'));const app=await serve(dir,resolve('web'),{connect:false});
 try {
  app.store.update(s=>s.settings.language='zh-CN');
  await page.goto(app.issueLink());
  await expect(page.locator('#clock')).toHaveAccessibleName('开始');
  await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.muted=true);
  await page.locator('#clock').click();
  await expect(page.locator('#label-shelf')).toContainText('随机选曲');
  expect(app.store.read().sessions.at(-1)?.programId).toMatch(/^now-/);
  await page.locator('#keep-edition').click();
  await expect.poll(()=>app.store.read().events.findLast(e=>e.kind==='keep')?.program?.id).toBe(app.store.read().sessions.at(-1)?.programId);
  const played=new Set<string>(),pausedStyles=new Set<string>();
  for(const p of batch){
   await page.evaluate(async id=>{
    for(const [path,body] of [['/api/timer',{action:'end'}],['/api/programs/select',{id}],['/api/timer',{action:'start',minutes:25}]] as const){
     const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(path+' '+r.status);
    }
   },p.id);
   const [work,track]=p.media.edition!.split('@');
   await expect(page.locator('#local-player')).toHaveAttribute('src','/'+track+'.mp3');
   await expect(page.locator('.artwork')).toHaveAttribute('src',(art as any)[work].image);
   await page.locator('.artwork').evaluate((i:HTMLImageElement)=>i.decode());
   expect(app.store.read().sessions.at(-1)?.programId).toBe(p.id);
   if(!played.has(track)){
    // Programmatic start has no trusted gesture; explicitly play muted for the media check.
    await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.play());
    await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
    played.add(track);
   }
   if(!pausedStyles.has(p.style!)){
    await expect(page.locator('#clock')).toHaveAccessibleName('暂停');
    await page.locator('#clock').click();
    await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe('paused');
    await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
    await page.locator('#clock').click();
    await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe('running');
    pausedStyles.add(p.style!);
   }
  }
  expect(played.size).toBe(37);expect(pausedStyles.size).toBe(7);
  const before=structuredClone(app.store.read().sessions.at(-1)!);
  await page.locator('#station-open').click();await page.locator('#prepared-programs > summary').click();
  await expect(page.locator('#program-heading')).toContainText('335');
  await expect(page.locator('.program-group').first()).toHaveText('别处');
  await page.locator('#program-search').fill('别处');
  await expect(page.locator('#program-list > details')).toHaveCount(235);
  await page.locator('#program-style').selectOption('jazz');
  await expect(page.locator('#program-list > details')).toHaveCount(batch.filter(p=>p.style==='jazz').length);
  const row=page.locator('#program-list > details').first();await row.locator(':scope > summary').click();
  await expect(row.locator('.program-editorial')).not.toHaveAttribute('open','');
  await row.getByRole('button',{name:'下一钟听',exact:true}).click();
  expect(app.store.read().nextProgram).toBeTruthy();expect(app.store.read().sessions.at(-1)).toEqual(before);
  mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/contemporary-pairings-shelf.png'});
  app.store.update(s=>s.settings.language='en');app.engine.changed();
  await expect(page.locator('.program-group').first()).toHaveText('Elsewhere');
  expect(app.store.read().ledger).toHaveLength(0);
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
