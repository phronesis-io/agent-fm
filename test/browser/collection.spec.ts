import {test,expect} from "@playwright/test";
import {serve} from "../../src/server.ts";
import {mkdtempSync,rmSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import programs from "../../web/programs.json" with {type:"json"};

test("the bundled library resolves to their own images and recordings, with timer-linked playback",async({page})=>{
 test.setTimeout(120000);
 const dir=mkdtempSync(join(tmpdir(),"fm-collection-"));const app=await serve(dir,resolve("web"),{connect:false});
 try{
  app.store.update(s=>{s.settings.language="zh-CN"});
  await page.goto(app.issueLink());
  await page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.muted=true);
  const collection=programs.filter(p=>["first-light","focus-library"].includes((p as any).collection));
  expect(collection).toHaveLength(100);
  for(const p of collection){
   await page.evaluate(async id=>{
    await fetch("/api/timer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"end"})});
    const r=await fetch("/api/programs/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
    if(!r.ok)throw Error("Programme selection failed");
   },p.id);
   await expect(page.locator("#clock")).toHaveAccessibleName("开始");
   await page.locator("#clock").click();
   const track=(p.media as any).edition.split("@")[1];
   await expect(page.locator("#local-player")).toHaveAttribute("src","/"+track+".mp3");
   await expect.poll(()=>page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
   await expect.poll(()=>page.locator(".artwork").evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
   expect(app.store.read().sessions.at(-1)?.programId).toBe(p.id);
   await page.locator("#clock").click();
   await expect.poll(()=>page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  }
  await page.locator("#station-open").click();
  await page.locator("#prepared-programs > summary").click();
  await expect(page.locator("#program-heading")).toContainText("335");
  const first=page.locator("#program-list > details").first();
  await first.locator(":scope > summary").click();
  await expect(first.locator(".program-editorial")).not.toHaveAttribute("open","");
  await expect.poll(()=>first.locator("img").evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
  mkdirSync("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/focus-library-1440.png"});
  await page.locator("#station-close").click();
  await page.screenshot({path:"artifacts/focus-library-playing.png"});
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
