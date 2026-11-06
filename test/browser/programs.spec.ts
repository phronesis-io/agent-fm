import {test,expect} from "@playwright/test";
import {serve} from "../../src/server.ts";
import {programCommand} from "../../src/programs.ts";
import {mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
test("a prepared programme waits for the next clock and follows the actual source",async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-program-ui-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 try{
  app.store.update(s=>{s.settings.language="en"});
  await programCommand(app.store,"prepare",{program:{
   id:"my-game-selection",title:"My Minecraft selection",originalTitle:"Minecraft",language:"en",
   tags:["game soundtrack"],facts:[{text:"C418 published this track on Volume Alpha.",source:"https://c418.bandcamp.com/album/minecraft-volume-alpha"}],
   note:"My interpretation",media:{kind:"youtube",url:"https://www.youtube.com/watch?v=2S54N2mFV_A",loop:true}
  }},async()=>({id:"2S54N2mFV_A",title:"Minecraft"}));
  await page.route("https://www.youtube-nocookie.com/**",r=>r.fulfill({body:"test player"}));
  await page.goto(app.issueLink());
  await expect(page.locator("#clock")).toHaveAccessibleName("Start");
  await page.locator("#clock").click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe("running");
  const deadline=app.store.read().sessions.at(-1)!.deadline;
  await page.locator("#station-open").click();
  await page.locator("#prepared-programs > summary").click();
  const program=page.locator("#program-list > details").filter({has:page.getByText("My Minecraft selection",{exact:true})});
  await program.locator(":scope > summary").click();
  await program.getByRole("button",{name:"Next Pomodoro",exact:true}).click();
  await expect(page.locator("#program-queue")).toContainText("My Minecraft selection");
  expect(app.store.read().sessions.at(-1)!.deadline).toBe(deadline);
  await expect(page.locator("#radio-frame iframe")).toHaveCount(0);
  await page.locator("#station-close").click();
  await page.evaluate(()=>fetch("/api/timer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"end"})}));
  await expect(page.locator("#clock")).toHaveAccessibleName("Start");
  await page.locator("#clock").click();
  await expect(page.locator("#radio-frame iframe")).toHaveAttribute("src",/2S54N2mFV_A.*loop=1/);
  await expect(page.locator("#station-caption")).toHaveText("My Minecraft selection");
  expect(app.store.read().nextProgram).toBeUndefined();
  (app.engine as any).online=true;app.engine.changed();
  const messages:any[]=[];
  await page.route("**/api/messages",async r=>{messages.push(r.request().postDataJSON());await r.fulfill({status:202,json:{status:"queued"}})});
  await page.locator("#chat-toggle").click();
  await expect.poll(()=>messages.length).toBe(1);
  expect(messages[0].text).toContain("C418 published this track");
  await page.getByRole("button",{name:"Close chat"}).click();
  await page.locator("#station-open").click();
  await page.getByRole("button",{name:"Lofi Girl",exact:true}).click();
  await expect.poll(()=>app.store.read().sessions.at(-1)?.programId).toBeUndefined();
  await page.locator("#chat-toggle").click();
  await expect.poll(()=>messages.length).toBe(2);
  expect(messages[1].text).toContain("Lofi Girl");
  expect(messages[1].text).not.toContain("C418 published this track");
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
