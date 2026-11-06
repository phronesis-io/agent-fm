import {test,expect} from "@playwright/test";
import {serve} from "../../src/server.ts";
import {mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

test("programme browsing translates facts and keeps editorial notes folded; saves the programme",async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-library-ui-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 try {
  app.store.update(s=>{
   s.settings.language="zh-CN";
   s.programs=[{
    id:"saved-test",title:"Quiet water",originalTitle:"Original water",language:"en",tags:["piano"],
    facts:[{text:"The recording is a piano performance.",source:"https://example.org/recording"}],
    note:"An editorial interpretation.",media:{kind:"edition",edition:"field@arabesque"},provider:"agent",preparedAt:0,
    translations:{"zh-CN":{title:"静水",facts:["这是一段钢琴录音。"],note:"编选者的个人理解。"}}
   } as any];
  });
  await page.goto(app.issueLink());
  await page.locator("#station-open").click();
  await page.locator("#prepared-programs > summary").click();
  await page.locator("#program-search").fill("静水");
  await expect(page.locator("#program-list > details")).toHaveCount(1);
  const row=page.locator("#program-list > details");
  await row.locator(":scope > summary").click();
  await expect(row.getByText("The recording is a piano performance.",{exact:false})).toBeVisible();
  await expect(row.getByText("Original water",{exact:true})).toBeVisible();
  await row.getByRole("button",{name:"译文",exact:true}).click();
  await expect(row.getByText("这是一段钢琴录音。",{exact:false})).toBeVisible();
  await expect(row.getByText("The recording is a piano performance.",{exact:false})).toHaveCount(0);
  await expect(row.getByText("Original water",{exact:true})).toHaveCount(0);
  await expect(row.getByText("编选者的个人理解。",{exact:true})).not.toBeVisible();
  await row.getByRole("button",{name:"原文",exact:true}).click();
  await expect(row.getByText("The recording is a piano performance.",{exact:false})).toBeVisible();
  await row.getByRole("button",{name:"下一钟听",exact:true}).click();
  await expect(page.locator("#program-queue")).toContainText("静水");
  expect(app.store.read().sessions.at(-1)?.programId).toBeUndefined();
  await page.locator("#station-close").click();
  await page.locator("#clock").click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.programId).toBe("saved-test");
  await page.locator("#keep-edition").click();
  await expect(page.locator("#keep-edition")).toBeDisabled();
  const saved=app.store.read().events.find(e=>e.kind==="keep")!;
  expect(saved.program?.id).toBe("saved-test");
  expect(saved.program?.title).toBe("Quiet water");
  await page.locator("#history-toggle").click();
  await expect(page.locator("#history-items")).toContainText("静水");
  await page.locator("#history-items").getByRole("button",{name:"带去聊",exact:true}).click();
  await expect(page.locator("#reading-context")).toContainText("静水");
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
