import {test,expect} from "@playwright/test";
import {serve} from "../../src/server.ts";
import {mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

test("programme queue rejects stale responses and agent collections cannot claim editorial selection",async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),"fm-program-races-"));
 const app=await serve(dir,resolve("web"),{connect:false});
 try {
  await page.route("**/app.js",r=>r.fulfill({contentType:"text/javascript",body:""}));
  await page.goto(app.origin);
  await page.setContent('<details id="prepared-programs"><summary id="program-heading"></summary><div id="program-list"></div></details><p id="program-queue"></p>');
  await page.evaluate(async()=>{
   const w=window as any;
   const moduleUrl='/programs.js';
   const {programShelf}=await import(moduleUrl);
   const base={originalTitle:"Source title",language:"en",tags:[],facts:[{text:"Source fact",source:"https://example.org"}],note:"An opinion",media:{kind:"edition",edition:"field@arabesque"},collection:"first-light"};
   w.specimens=[{...base,id:"a",title:"Programme A",provider:"editorial"},{...base,id:"b",title:"Programme B",provider:"agent"}];
   w.pending=[];
   w.updateShelf=programShelf({language:()=>"en",status:()=>{},api:(path:string,body:unknown,method:string)=>new Promise(resolve=>w.pending.push({path,body,method,resolve}))});
   w.updateShelf({nextProgram:null});
  });
  const resolveRequest=async(index:number,value:unknown)=>page.evaluate(({index,value})=>(window as any).pending[index].resolve(value),{index,value});
  const list=await page.evaluate(()=>(window as any).specimens);
  await page.locator('#prepared-programs > summary').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).pending.length)).toBe(1);
  await resolveRequest(0,{programs:list,queuedId:null});
  await expect(page.locator('#program-heading')).toHaveText('Selections · 1');
  await expect(page.locator('.program-group')).toHaveText(['First collection','More programmes']);
  const a=page.locator('[data-program="a"]');
  const b=page.locator('[data-program="b"]');
  await a.locator('summary').first().click();
  await b.locator('summary').first().click();
  // Start an old GET, then select A before that read returns.
  await page.locator('#prepared-programs > summary').click();
  await page.locator('#prepared-programs > summary').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).pending.length)).toBe(2);
  await a.getByRole('button',{name:'Next Pomodoro'}).click();
  await expect(b.getByRole('button',{name:'Next Pomodoro'})).toBeDisabled();
  await resolveRequest(2,{queuedId:'a'});
  await resolveRequest(1,{programs:list,queuedId:null});
  await expect(page.locator('#program-queue')).toContainText('Programme A');
  // A later server event wins even if an earlier cancellation response arrives last.
  await page.locator('#program-queue').getByRole('button',{name:'Cancel'}).click();
  await expect(b.getByRole('button',{name:'Next Pomodoro'})).toBeDisabled();
  await page.evaluate(()=>(window as any).updateShelf({nextProgram:(window as any).specimens[1]}));
  await resolveRequest(3,{queuedId:null});
  await expect(page.locator('#program-queue')).toContainText('Programme B');
  await expect(b.getByRole('button',{name:'Queued next'})).toBeDisabled();
  await page.locator('#program-queue').getByRole('button',{name:'Cancel'}).click();
  await resolveRequest(4,{queuedId:null});
  await expect(page.locator('#program-queue')).toBeEmpty();
  // The timer may consume A before its POST response, without ever exposing a queued state.
  await a.getByRole('button',{name:'Next Pomodoro'}).click();
  await page.evaluate(()=>(window as any).updateShelf({nextProgram:null}));
  await resolveRequest(5,{queuedId:'a'});
  await expect(page.locator('#program-queue')).toBeEmpty();
 } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true})}
});
