import {test,expect} from '@playwright/test';
import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import art from '../../web/editions.json' with {type:'json'};
import {current} from '../../src/domain.ts';
const visuals=Object.entries(art).filter(([,a])=>'library' in a && a.library==='contemporary') as [string,any][];

test('the real new library decodes and shows translated facts without model calls; the library setting affects only the next draw',async({page})=>{
 test.setTimeout(120000);
 const dir=mkdtempSync(join(tmpdir(),'fm-visuals-'));const app=await serve(dir,resolve('web'),{connect:false});let labels=0, modelCalls=0;
 try {
  app.store.update(s=>s.settings.language='zh-CN');
  await page.route('**/api/label',r=>{labels++;if(r.request().postDataJSON()?.translate)modelCalls++;return r.fulfill({json:{translation:null}})});
  await page.goto(app.issueLink());
  const results=await page.evaluate(async paths=>{
   const out=[];
   for(let i=0;i<paths.length;i+=4){
    out.push(...await Promise.all(paths.slice(i,i+4).map(async path=>{
     const r=await fetch(path);if(!r.ok)return false;
     const image=await createImageBitmap(await r.blob());const ok=image.width>=1000;image.close();return ok;
    })));
   }return out;
  },visuals.map(([,a])=>a.image));
  expect(results.length).toBeGreaterThanOrEqual(200);expect(results.every(Boolean)).toBe(true);
  for(const prefix of ['nasa-','revoy-','commons-']){
   const [id,a]=visuals.find(([id])=>id.startsWith(prefix))!;
   app.store.update(s=>{current(s).edition=id+'@drift'});app.engine.changed();
   await expect(page.locator('#label-title')).toHaveText(a.art);
   await expect(page.locator('#label-fact')).toHaveText(a.fact);
   await expect(page.locator('#label-quote')).toBeHidden();
   await expect(page.locator('#label-source')).toHaveAttribute('href',a.source);
   await page.locator('#label-translate').click();
   await expect(page.locator('#label-title')).toHaveText(a.translations['zh-CN'].title);
   await expect(page.locator('#label-fact')).toHaveText(a.translations['zh-CN'].fact);
   await page.locator('#label-translate').click();
   await expect(page.locator('#label-title')).toHaveText(a.art);
   await page.locator('.artwork').evaluate((image:HTMLImageElement)=>image.decode());
   await page.screenshot({path:'artifacts/visuals-'+prefix.slice(0,-1)+'.png'});
  }
  await page.locator('#local-player').evaluate((a:HTMLAudioElement)=>a.muted=true);
  await page.locator('#clock').click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe('running');
  const before=structuredClone(app.store.read().sessions.at(-1)!);
  expect(visuals.some(([id])=>before.edition?.startsWith(id+'@'))).toBe(true);
  const settings=app.store.read().settings;
  const status=await page.evaluate(async version=>(await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,visualLibrary:'museum'})})).status,settings.version);
  expect(status).toBe(200);expect(app.store.read().sessions.at(-1)).toEqual(before);
  const invalid=await page.evaluate(async version=>(await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,visualLibrary:'unknown'})})).status,app.store.read().settings.version);
  expect(invalid).toBe(400);
  expect(labels).toBe(0);
  await page.locator('#next-edition').click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.edition).not.toBe(before.edition);
  expect(visuals.some(([id])=>app.store.read().sessions.at(-1)?.edition?.startsWith(id+'@'))).toBe(false);
  expect(app.store.read().sessions.at(-1)?.deadline).toBe(before.deadline);
  expect(modelCalls).toBe(0);
 }finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
