import {test,expect} from "@playwright/test";
import {serve} from "../../src/server.ts";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
test("explanation retries the same request and describes the chosen station",async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-explain-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 try {
  await page.route("https://www.youtube-nocookie.com/**",r=>r.fulfill({body:"player"}));
  const requests:any[]=[];
  await page.route("**/api/messages",async r=>{
   requests.push(r.request().postDataJSON());
   await r.fulfill(requests.length===1?{status:503,json:{error:"请重试"}}:{status:202,json:{status:"queued"}});
  });
  (app.engine as any).online = true;
  app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
  await page.locator("#station-open").click();
  await page.getByRole("button",{name:"Claude FM",exact:true}).click();
  await page.locator("#chat-toggle").click();
  await expect(page.locator("#toast")).toHaveText("请重试");
  await page.locator("#chat-toggle").click();
  await expect(page.locator("#send-state")).toHaveText("已收");
  expect(requests).toHaveLength(2);
  expect(requests[0].id).toBe(requests[1].id);
  expect(requests[0].text).toContain("Claude FM");
  expect(requests[0].text).not.toContain("Arabesque");
  const s=app.store.read();
  expect(s.events.some(e=>e.kind==="source-selected"&&e.detail.includes("Claude FM"))).toBe(true);
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});
