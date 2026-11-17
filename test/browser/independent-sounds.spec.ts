import {test,expect} from '@playwright/test';
import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import programs from '../../web/programs.json' with {type:'json'};

test('all twenty independent recordings switch through visible controls, decode, translate and preserve the clock',async({page})=>{
 test.setTimeout(120000);const dir=mkdtempSync(join(tmpdir(),'fm-independent-'));const app=await serve(dir,resolve('web'),{connect:false});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  app.store.update(s=>s.settings.language='zh-CN');await page.goto(app.issueLink());await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.muted=true);
  await page.locator('#clock').click();const before=structuredClone(app.store.read().sessions.at(-1)!);
  await page.locator('#station-open').click();await page.locator('#prepared-programs>summary').click();await page.locator('#program-search').fill('独立之声');
  await expect(page.locator('#program-list>details')).toHaveCount(20);
  await expect(page.locator('.program-group').first()).toHaveText('独立之声');
  for(const p of programs.filter(p=>p.collection==='independent-sounds')){
   const button=page.locator(`[data-program="${p.id}"] .program-switch`);await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
   const id=p.media.edition!.split('@')[1];await expect(page.locator('#local-player')).toHaveAttribute('src','/'+id+'.mp3');
   await page.locator('.artwork').evaluate((i:HTMLImageElement)=>i.decode());await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
   await expect(page.locator('#label-fact')).toHaveText(p.facts[0].text);
   expect(app.store.read().sessions.at(-1)!.deadline).toBe(before.deadline);
  }
  await page.keyboard.press('Escape');await page.locator('#label-translate').click();const last=programs.at(-1)!;
  await expect(page.locator('#label-fact')).toHaveText(last.translations!['zh-CN'].facts[0]);await page.locator('#label-translate').click();await expect(page.locator('#label-fact')).toHaveText(last.facts[0].text);
  await page.locator('#clock').click();await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.locator('#station-open').click();await page.locator('#program-search').fill('Axletree');await expect(page.locator('#program-list>details')).toHaveCount(2);
  await page.locator('[data-program="pf-axletree-books"] .program-switch').click();await expect(page.locator('.program-feedback')).toContainText('计时仍暂停');
  expect(await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.screenshot({path:'artifacts/performers/installed-design.png'});expect(errors).toEqual([]);expect(app.store.read().ledger).toHaveLength(0);expect(app.store.read().sessions).toHaveLength(1);
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
