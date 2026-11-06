import {test,expect} from '@playwright/test';
import {serve} from '../../src/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
test('English is the default and confirmed Chinese can be switched live',async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'fm-en-'));const app=await serve(dir,resolve('web'),{connect:false});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.issueLink());
  await expect(page.locator('#clock')).toHaveAccessibleName('Start');
  await expect(page.locator('#fullscreen')).toHaveText('Fullscreen');
  await page.locator('#language-suggestion').selectOption('zh-CN');
  await page.locator('#language-confirm button').click();
  await expect(page.locator('#clock')).toHaveAccessibleName('开始');
  await expect(page.locator('#label-title')).toHaveText('Wheat Field with Cypresses');
  await page.locator('#label-translate').click();
  await expect(page.locator('#label-title')).toHaveText('麦田与柏树');
  await expect(page.locator('#fullscreen')).toHaveText('全屏');
  await page.locator('#settings-toggle').click();
  await page.locator('#language-choice').selectOption('en');
  await page.locator('#language-settings button').click();
  await expect(page.locator('#clock')).toHaveAccessibleName('Start');
  await expect(page.locator('#fullscreen')).toHaveText('Fullscreen');
  expect(errors).toEqual([]);
 }finally{await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});
