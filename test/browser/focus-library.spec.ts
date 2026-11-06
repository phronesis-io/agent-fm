import {test,expect} from "@playwright/test";
import {serve} from "../../src/server.ts";
import {mkdtempSync,rmSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import bundled from "../../web/programs.json" with {type:"json"};

test("a hundred programmes can be narrowed locally without changing the clock or queue",async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-focus-ui-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 const styles=["ambient","piano","acoustic","jazz","electronic","beats","game"];
 const specimens=Array.from({length:100},(_,i)=>({
  id:`focus-fixture-${i}`,title:`Study piece ${String(i).padStart(3,"0")}`,originalTitle:`Original ${i}`,language:"en",
  tags:["fixture"],style:styles[i%styles.length],collection:i<20?"first-light":"focus-library",provider:"editorial",preparedAt:0,
  facts:[{text:"A layout test specimen.",source:"https://example.org"}],note:"An editorial test note.",
  media:{kind:"edition",edition:["field","reading","irises","drift","roses"][i%5]+"@arabesque"},
  translations:{"zh-CN":{title:`节目${String(i).padStart(3,"0")}`,facts:["界面测试用例。"],note:"测试编选理由。"}}
 }));
 try {
  app.store.update(s=>{s.settings.language="en";s.programs=specimens as any});
  await page.route("**/api/programs",r=>r.fulfill({json:{programs:specimens,queuedId:app.store.read().nextProgram??null}}));
  await page.goto(app.issueLink());
  await page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.muted=true);
  await expect(page.locator("#clock")).toHaveAccessibleName("Start");
  await page.locator("#clock").click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe("running");
  await expect.poll(()=>page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
  const deadline=app.store.read().sessions.at(-1)!.deadline;
  const source=await page.locator("#local-player").getAttribute("src");
  await page.locator("#station-open").click();
  await page.locator("#prepared-programs > summary").click();
  await expect(page.locator("#program-heading")).toHaveText("Selections · 100");
  await expect(page.locator("#program-list > details")).toHaveCount(100);
  await expect(page.locator("#program-style")).toHaveValue("");
  await expect(page.locator("#program-style")).toHaveAccessibleName("Sound style");
  await page.locator("#program-style").selectOption("jazz");
  await expect(page.locator("#program-list > details")).toHaveCount(14);
  await page.locator("#program-search").fill("Study piece 003");
  await expect(page.locator("#program-list > details")).toHaveCount(1);
  expect(app.store.read().sessions.at(-1)!.deadline).toBe(deadline);
  await expect(page.locator("#local-player")).toHaveAttribute("src",source!);
  expect(app.store.read().nextProgram).toBeUndefined();
  expect(app.store.read().ledger).toHaveLength(0);
  app.store.update(s=>{s.settings.language="zh-CN"});app.engine.changed();
  await expect(page.locator("#program-style")).toHaveAccessibleName("声音风格");
  await expect(page.locator("#program-style")).toHaveValue("jazz");
  await expect(page.locator("#program-search")).toHaveValue("Study piece 003");
  await expect(page.locator("#program-list > details > summary")).toHaveText("Study piece 003");
  await page.locator("#program-list > details > summary").click();
  await page.getByRole("button",{name:"下一钟听",exact:true}).click();
  await expect.poll(()=>app.store.read().nextProgram).toBe("focus-fixture-3");
  await page.locator("#program-search").fill("no-match-at-all");
  await expect(page.locator("#program-list")).toContainText("换个风格或关键词试试。");
  expect(app.store.read().nextProgram).toBe("focus-fixture-3");
  await page.locator("#station-close").click();
  await page.locator("#station-open").click();
  await expect(page.locator("#program-style")).toHaveValue("jazz");
  await expect(page.locator("#program-search")).toHaveValue("no-match-at-all");
  await page.locator("#program-clear").click();
  await expect(page.locator("#program-list > details")).toHaveCount(100);
  await expect(page.locator("#program-style")).toHaveValue("");
  await page.locator("#program-list > details").first().locator("img").evaluate((img:HTMLImageElement)=>img.decode());
  mkdirSync("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/focus-library-fixture-1440.png"});
  await page.locator("#station-shelf").evaluate(e=>e.scrollTop=e.scrollHeight);
  await page.locator("#station-close").click();
  await expect(page.locator("#station-shelf")).toBeHidden();
  expect(app.store.read().sessions.at(-1)!.deadline).toBe(deadline);
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});

test("the actual bundled hundred are discoverable by all seven styles",async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-focus-actual-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 try {
  app.store.update(s=>{s.settings.language="en"});
  const collection=bundled.filter(p=>["first-light","focus-library"].includes((p as any).collection));
  expect(collection).toHaveLength(100);
  await page.goto(app.issueLink());
  await page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.muted=true);
  await expect(page.locator("#clock")).toHaveAccessibleName("Start");
  await page.locator("#clock").click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe("running");
  await expect.poll(()=>page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
  const deadline=app.store.read().sessions.at(-1)!.deadline;
  const source=await page.locator("#local-player").getAttribute("src");
  await page.locator("#station-open").click();
  await page.locator("#prepared-programs > summary").click();
  await expect(page.locator("#program-heading")).toHaveText("Selections · 335");
  await expect(page.locator("#program-list > details")).toHaveCount(bundled.length);
  for(const style of ["ambient","piano","acoustic","jazz","electronic","beats","game"]) {
   const expected=bundled.filter(p=>(p as any).style===style);
   expect(expected.length).toBeGreaterThan(0);
   await page.locator("#program-style").selectOption(style);
   await expect(page.locator("#program-list > details")).toHaveCount(expected.length);
   await expect(page.locator("#program-count")).toHaveText(`${expected.length} of ${bundled.length} programmes`);
  }
  await page.locator("#program-style").selectOption("jazz");
  const jazz=collection.find(p=>(p as any).style==="jazz")!;
  await page.locator("#program-search").fill(jazz.title);
  const row=page.locator(`[data-program="${jazz.id}"]`);
  await expect(row).toBeVisible();
  await row.locator(":scope > summary").click();
  await row.getByRole("button",{name:"Next Pomodoro",exact:true}).click();
  await expect.poll(()=>app.store.read().nextProgram).toBe(jazz.id);
  await expect(page.locator("#local-player")).toHaveAttribute("src",source!);
  expect(app.store.read().sessions.at(-1)!.deadline).toBe(deadline);
  expect(app.store.read().ledger).toHaveLength(0);
  await page.locator("#program-clear").click();
  await expect(page.locator("#program-list > details")).toHaveCount(bundled.length);
  await page.locator("#program-list > details img").first().evaluate((i:HTMLImageElement)=>i.decode());
  mkdirSync("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/focus-library-actual-1440.png"});
  await page.locator("#station-shelf").evaluate(e=>e.scrollTop=e.scrollHeight);
  await page.locator("#station-close").click();
  await expect(page.locator("#station-shelf")).toBeHidden();
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
