import {test,expect} from '@playwright/test';import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
for(const width of [1280,1440])test(`real music selection clicks at ${width}px preserve timer and recover from failure`,async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'fm-switch-'));const app=await serve(dir,resolve('web'),{connect:false});
 try{
  app.store.update(s=>s.settings.language='zh-CN');await page.setViewportSize({width,height:800});await page.goto(app.issueLink());
  await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.muted=true);
  await page.locator('#clock').click();const clock=structuredClone(app.store.read().sessions.at(-1)!);
  await page.locator('#station-open').click();await page.locator('#prepared-programs>summary').click();
  await page.locator('#program-search').fill('Dreams Become Real');
  const rows=page.locator('#program-list>details');await expect(rows).toHaveCount(3);
  const first=rows.nth(0).locator('.program-switch');const box=await first.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await first.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})).toBe(true);
  await first.click();await expect(first).toHaveText('已选');await expect(page.locator('#local-player')).toHaveAttribute('src','/sf-dreams-become-real.mp3');
  await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
  expect(app.store.read().sessions.at(-1)?.deadline).toBe(clock.deadline);expect(app.store.read().sessions.at(-1)?.id).toBe(clock.id);
  await rows.nth(1).locator(':scope>summary').click();await rows.nth(1).getByRole('button',{name:'下一钟听',exact:true}).click();
  const queue=app.store.read().nextProgram;
  await rows.nth(2).locator('.program-switch').focus();await page.keyboard.press('Enter');await expect(rows.nth(2).locator('.program-switch')).toHaveText('已选');expect(app.store.read().nextProgram).toBe(queue);
  await page.keyboard.press('Escape');await page.locator('#clock').click();const paused=app.store.read().sessions.at(-1)?.remaining;
  await page.locator('#station-open').click();await first.click();await expect(page.locator('.program-feedback')).toContainText('计时仍暂停');
  expect(app.store.read().sessions.at(-1)?.remaining).toBe(paused);expect(await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.route('**/api/programs/switch',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test unavailable'})}));
  const chosen=app.store.read().sessions.at(-1)?.programId;await rows.nth(1).locator('.program-switch').click();await expect(page.locator('.program-feedback')).toContainText('未能切换');expect(app.store.read().sessions.at(-1)?.programId).toBe(chosen);
  await page.unroute('**/api/programs/switch');await rows.nth(1).locator('.program-switch').click();await expect(rows.nth(1).locator('.program-switch')).toHaveText('已选');
  await page.screenshot({path:`artifacts/music-selection-${width}.png`});expect(app.store.read().sessions).toHaveLength(1);expect(app.store.read().ledger).toHaveLength(0);
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});

test('slow switching prevents competing clicks and different recordings really replace audio',async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'fm-switch-slow-'));const app=await serve(dir,resolve('web'),{connect:false});
 try {
  await page.setViewportSize({width:1280,height:800});await page.goto(app.issueLink());
  await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.muted=true);
  await page.locator('#clock').click();const deadline=app.store.read().sessions.at(-1)!.deadline;
  await page.locator('#station-open').click();await page.locator('#prepared-programs>summary').click();
  const rows=page.locator('#program-list>details');
  await rows.first().locator('.program-switch').click();
  await expect(rows.first().locator('.program-switch')).toHaveAttribute('aria-pressed','true');
  const oldSource=await page.locator('#local-player').getAttribute('src');
  await page.locator('#program-search').fill('Dreams Become Real');
  let release!:()=>void;let requests=0;const held=new Promise<void>(r=>release=r);
  await page.route('**/api/programs/switch',async r=>{requests++;await held;await r.continue()});
  const button=rows.first().locator('.program-switch');await button.click();
  await expect(button).toBeDisabled();await expect(rows.nth(1).locator('.program-switch')).toBeDisabled();
  await expect(button).toHaveText(/Switching|切换中/);expect(requests).toBe(1);
  release();await expect(button).toHaveAttribute('aria-pressed','true');await expect(button).toBeEnabled();
  await expect(page.locator('#local-player')).toHaveAttribute('src','/sf-dreams-become-real.mp3');expect(oldSource).not.toBe('/sf-dreams-become-real.mp3');
  await expect.poll(()=>page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
  await button.click();expect(requests).toBe(1);
  expect(app.store.read().sessions.at(-1)!.deadline).toBe(deadline);
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
