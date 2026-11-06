import {test,expect} from '@playwright/test';
import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('next set stays under the pointer across titles and timer states and accepts rapid clicks',async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'fm-next-'));const app=await serve(dir,resolve('web'),{connect:false});
 try {
  app.store.update(s=>s.settings.language='zh-CN');await page.goto(app.issueLink());
  await expect(page.locator('#clock')).toBeEnabled();
  const button=page.locator('#next-edition');
  for(const size of [{width:1440,height:960},{width:1024,height:768}]){
   await page.setViewportSize(size);const before=(await button.boundingBox())!;
   for(const text of ['X','Stories About the World That Once Was · a very long recording title']){
    await page.locator('#station-caption').evaluate((el,t)=>el.textContent=t,text);
    const after=(await button.boundingBox())!;expect(after.x).toBeCloseTo(before.x,1);expect(after.y).toBeCloseTo(before.y,1);
   }
   await page.locator('#clock').click();const running=(await button.boundingBox())!;
   expect(running.x).toBeCloseTo(before.x,1);expect(running.y).toBeCloseTo(before.y,1);
   await page.locator('#clock').click();const paused=(await button.boundingBox())!;
   expect(paused.x).toBeCloseTo(before.x,1);expect(paused.y).toBeCloseTo(before.y,1);
   await page.evaluate(()=>fetch('/api/timer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'end'})}));
   await expect(page.locator('#clock')).toHaveAccessibleName('开始');
  }
  await page.locator('#clock').click();const deadline=app.store.read().sessions.at(-1)!.deadline;
  const count=()=>app.store.read().events.filter(e=>e.kind==='tune-away').length;const initial=count();
  let concurrent=0,maxConcurrent=0;
  await page.route('**/api/next-edition',async route=>{
   concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
   await new Promise(r=>setTimeout(r,100));await route.continue();concurrent--;
  });
  const rect=(await button.boundingBox())!;
  for(let i=0;i<6;i++)await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
  await expect.poll(count).toBe(initial+6);expect(maxConcurrent).toBe(1);
  expect(app.store.read().sessions.at(-1)!.deadline).toBe(deadline);
  await expect(button).toBeEnabled();await expect(button).not.toHaveAttribute('aria-busy','true');
  const after=(await button.boundingBox())!;expect(after.x).toBeCloseTo(rect.x,1);expect(after.y).toBeCloseTo(rect.y,1);
  await page.unroute('**/api/next-edition');
  await page.route('**/api/next-edition',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));
  await button.click();await expect(page.locator('#toast')).toContainText('Unavailable');
  await expect(button).not.toHaveAttribute('aria-busy','true');
  await page.unroute('**/api/next-edition');await button.click();await expect.poll(count).toBe(initial+7);
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
