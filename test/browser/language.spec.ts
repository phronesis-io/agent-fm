import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../../src/server.ts";
import { current } from "../../src/domain.ts";

test("curated labels show source and editorial Chinese; others offer a Codex translation on click only", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-lang-"));
  const app = await serve(dir, resolve("web"), { connect: false });
  let translateCalls = 0, cached = false;
  try {
    app.store.update(s => { s.settings.language = "zh-CN"; });
    await page.goto(app.issueLink());
    // Original is the default even when the working language is Chinese.
    await expect(page.locator("#label-title")).toHaveText("Wheat Field with Cypresses");
    await expect(page.locator("#label-translate")).toHaveText("译文");
    await page.locator("#label-translate").click();
    await expect(page.locator("#label-title")).toHaveText("麦田与柏树");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator(".artwork")).toHaveAttribute("alt", "");
    await page.locator("#private-toggle").click();
    await expect(page.locator(".artwork")).toHaveAttribute("alt", "麦田与柏树");
    await page.locator("#private-toggle").click();
    await expect(page.locator(".artwork")).toHaveAttribute("alt", "");
    await expect(page.locator("#label-original")).toBeHidden();
    await expect(page.locator("#label-lang-note")).toContainText("资料摘要");
    await expect(page.locator("#label-translate")).toHaveText("原文");

    // A roaming CMA work in English, with Codex reported online.
    await page.route("**/api/label", async (route) => {
      const b = route.request().postDataJSON();
      if (b.translate) {translateCalls++;cached=true;}
      await route.fulfill({
        json: {
          language: "zh-CN",
          source: { language: "en", fields: { title: "SRC" } },
          translation: cached
            ? { title: "译名", culture: "译文化", collection: "译部门", excerpt: "译说明" }
            : null,
        },
      });
    });
    app.store.update((s) => {
      s.settings.connected = true;
    });
    (app.engine as any).online = true;
    app.store.update(s => { current(s).edition = "cma-93014@reading"; });
    await page.reload();
    await expect(page.locator("#label-title")).toContainText("View of Schroon Mountain");
    const sourceTitle = await page.locator("#label-title").innerText();
    await expect(page.locator("#label-translate")).toBeVisible();
    await expect(page.locator("#label-translate")).toHaveText("翻译");
    await expect(page.locator("#label-translate")).toHaveAccessibleDescription("用 Codex 翻译为简体中文");
    await expect(page.locator("#label-translate")).toHaveAttribute("title", "用 Codex 翻译为简体中文");
    expect(translateCalls).toBe(0);
    await page.locator("#label-translate").click();
    await expect(page.locator("#label-title")).toHaveText("译名");
    await expect(page.locator("#label-original")).toBeHidden();
    await expect(page.locator("#label-meta-source")).toBeHidden();
    await expect(page.locator("#label-lang-note")).toHaveText("Codex 译文");
    expect(translateCalls).toBe(1);
    expect(sourceTitle).not.toBe("译名");
    await page.getByRole("button", { name: "原文", exact: true }).click();
    await expect(page.locator("#label-title")).toHaveText(sourceTitle);
    await page.getByRole("button", { name: "译文", exact: true }).click();
    await expect(page.locator("#label-title")).toHaveText("译名");
    expect(translateCalls).toBe(1);
    await page.reload();
    await expect(page.locator("#label-title")).toHaveText(sourceTitle);
    await expect(page.locator("#label-translate")).toHaveText("译文");
    await page.locator("#label-translate").click();
    await expect(page.locator("#label-title")).toHaveText("译名");
    expect(translateCalls).toBe(1);
  } finally {
    await page.close();
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("language is suggested, explicitly saved, survives reload and rejects invalid settings", async ({browser}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-language-"));
  const app = await serve(dir, resolve("web"), {connect:false});
  const context = await browser.newContext({locale:"ko-KR"});
  const page = await context.newPage();
  try {
    await page.goto(app.issueLink());
    await expect(page.locator("#language-suggestion")).toHaveValue("ko-KR");
    await page.locator("#fullscreen").click({trial:true});
    await page.locator("#history-toggle").click({trial:true});
    expect(await page.evaluate(async () => (await (await fetch("/api/state")).json()).settings.language)).toBeUndefined();
    await page.locator("#language-confirm button").click();
    await expect(page.locator("#language-confirmation")).toBeHidden();
    await page.reload();
    await expect(page.locator("#language-confirmation")).toBeHidden();
    await page.locator("#settings-toggle").click();
    await page.locator("#language-choice").selectOption("fr");
    await page.locator("#language-settings button").click();
    await expect(page.locator("#language-settings-status")).toHaveText(/Saved|已保存/);
    const result = await page.evaluate(async () => {
      const s = await (await fetch("/api/state")).json();
      const result = await fetch("/api/settings", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:s.settings.version,language:"not a locale"})});
      return {status:result.status, language:(await (await fetch("/api/state")).json()).settings.language};
    });
    expect(result.status).toBe(400);
    expect(result.language).toBe("fr");
    await page.locator("#language-choice").selectOption("auto");
    await page.locator("#language-settings button").click();
    await expect.poll(() => page.evaluate(async () => (await (await fetch("/api/state")).json()).settings.language)).toBe("auto");
    await page.reload();
    await expect(page.locator("#language-confirmation")).toBeHidden();
  } finally { await context.close(); await app.stop(); rmSync(dir,{recursive:true,force:true}); }
});

test("translation uses one reading layer and toggles without another model request", async ({page}) => {
  const {current} = await import("../../src/domain.ts");
  const dir=mkdtempSync(join(tmpdir(),"fm-reading-view-"));
  const app=await serve(dir,resolve("web"),{connect:false});
  let calls=0;
  try {
    app.store.update(s=>{s.settings.language="zh-CN";current(s).edition="cma-93014@reading";});
    (app.engine as any).online=true;
    await page.route("**/api/label",async route=>{
      const b=route.request().postDataJSON();if(b.translate)calls++;
      await route.fulfill({json:{source:{language:"en",fields:{title:"View of Schroon Mountain, Essex County, New York, After a Storm"}},translation:b.translate?{
        title:"纽约州埃塞克斯县斯克伦山雨后景象",culture:"美国",collection:"美国绘画与雕塑",
        excerpt:"画家称它为“斯克伦山”，这座山峰的正式名称是霍夫曼山。"
      }:null}});
    });
    await page.goto(app.issueLink());
    await page.locator("#label-translate").click();
    await expect(page.locator("#label-title")).toHaveText("纽约州埃塞克斯县斯克伦山雨后景象");
    await expect(page.locator("#label-quote .quote-current")).toBeVisible();
    await expect(page.locator("#label-quote .quote-source")).toBeHidden();
    await expect(page.locator("#label-original")).toBeHidden();
    await expect(page.locator("#label-meta-source")).toBeHidden();
    for(const [width,height] of [[1440,960],[1280,720]]) {
      await page.setViewportSize({width,height});
      await page.locator("#clock").click({trial:true});
      await page.screenshot({path:`artifacts/translation-${width}.png`});
    }
    await page.getByRole("button",{name:"原文",exact:true}).click();
    await expect(page.locator("#label-quote .quote-current")).toBeHidden();
    await expect(page.locator("#label-quote .quote-source")).toBeVisible();
    await expect(page.locator("#label-title")).toContainText("View of Schroon Mountain");
    await page.getByRole("button",{name:"译文",exact:true}).click();
    await expect(page.locator("#label-quote .quote-current")).toBeVisible();
    expect(calls).toBe(1);
  } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});


for (const [language, name] of [["ja-JP", "Japanese"], ["zh-TW", "Traditional Chinese"]]) {
test(`${language} uses English controls and cached translations without a model call`, async ({page}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-language-fallback-"));
  const app = await serve(dir, resolve("web"), {connect:false});
  let cached = false;
  let modelCalls = 0;
  try {
    app.store.update(s => { s.settings.language = language; s.settings.connected = true; });
    (app.engine as any).online = true;
    await page.route("**/api/label", async route => {
      const body = route.request().postDataJSON();
      expect(body.language).toBe(language);
      if (body.translate) modelCalls++;
      await route.fulfill({json: {translation: cached ? {title: "糸杉のある麦畑"} : null}});
    });
    await page.goto(app.issueLink());
    const button = page.locator("#label-translate");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(button).toHaveText("Translate");
    await expect(button).toHaveAccessibleDescription(`Translate into ${name} with Codex`);
    await page.locator("#station-open").click();
    await page.locator("#prepared-programs > summary").click();
    await expect(page.locator("#program-heading")).toContainText("Selections");
    const original = await page.locator("#label-title").innerText();
    cached = true;
    await page.reload();
    await expect(page.locator("#label-title")).toHaveText(original);
    await expect(button).toHaveText("Translation");
    await button.click();
    await expect(page.locator("#label-title")).toHaveText("糸杉のある麦畑");
    await expect(button).toHaveText("Original");
    await button.click();
    await expect(page.locator("#label-title")).toHaveText(original);
    expect(modelCalls).toBe(0);
  } finally { await page.close(); await app.stop(); rmSync(dir, {recursive:true, force:true}); }
});
}


test("programme translations preserve exact locales without borrowing Simplified Chinese for Traditional Chinese", async ({page}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-program-language-"));
  const app = await serve(dir, resolve("web"), {connect:false});
  try {
    await page.goto(app.issueLink());
    const text = await page.evaluate(async () => {
      const moduleUrl = "/programs.js";
      const {programText} = await import(moduleUrl);
      const program: {title:string;note:string;facts:{text:string;sources:string[]}[];translations:Record<string,{title:string;note:string;facts:string[]}>} = {title:"Original title", note:"Original note", facts:[{text:"Original fact",sources:[]}], translations:{
        "zh-CN":{title:"简体标题",note:"简体说明",facts:["简体事实"]},
      }};
      const absent = programText(program,"zh-TW");
      const simplified = programText(program,"zh-Hans");
      program.translations["zh-TW"] = {title:"繁體題名",note:"繁體說明",facts:["繁體事實"]};
      return {absent,simplified,exact:programText(program,"zh-TW")};
    });
    expect(text.absent.title).toBe("Original title");
    expect(text.absent.note).toBe("Original note");
    expect(text.absent.facts[0].text).toBe("Original fact");
    expect(text.simplified.title).toBe("简体标题");
    expect(text.exact.title).toBe("繁體題名");
    expect(text.exact.note).toBe("繁體說明");
    expect(text.exact.facts[0].text).toBe("繁體事實");
  } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});


test("roaming art uses a sourced local summary, retains artwork titles and offers museum text without model calls", async ({page}) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-summary-"));
  const app = await serve(dir, resolve("web"), {connect:false});
  let requests = 0;
  try {
    app.store.update(s => {s.settings.language="zh-CN";current(s).edition="cma-106015@tide";});
    await page.route("**/api/label", async route => {requests++;await route.fulfill({json:{translation:null}});});
    await page.goto(app.issueLink());
    await expect(page.locator("#label-title")).toHaveText("Bowl with Cloud Design in Relief");
    await expect(page.locator("#label-original")).toContainText("청자");
    await expect(page.locator("#label-fact")).toContainText("date 1100s");
    const originalFact=await page.locator("#label-fact").textContent();
    await expect(page.locator("#label-lang-note")).toHaveText("资料摘要");
    await expect(page.locator("#label-quote")).toBeHidden();
    await expect(page.locator("#label-source")).toHaveAttribute("href","https://www.clevelandart.org/art/1924.137");
    await expect(page.locator("#label-summary-source")).toBeHidden();
    await page.getByRole("button",{name:"译文",exact:true}).click();
    await expect(page.locator("#label-fact")).toContainText("十二世纪");
    await expect(page.locator("#label-quote")).toBeHidden();
    await page.getByRole("button",{name:"原文",exact:true}).click();
    await expect(page.locator("#label-fact")).toHaveText(originalFact!);
    app.store.update(s => {s.settings.language="en";});
    await page.reload();
    await expect(page.locator("#label-fact")).toContainText("date 1100s");
    await expect(page.locator("#label-lang-note")).toHaveText("Sourced summary");
    await expect(page.locator("#label-translate")).toBeHidden();
    expect(requests).toBe(0);
  } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});

test("non-museum images show local Chinese facts, original captions and independent visual attribution", async ({page}) => {
  const dir=mkdtempSync(join(tmpdir(),"fm-photo-label-"));
  const app=await serve(dir,resolve("web"),{connect:false});
  let requests=0;
  try {
    app.store.update(s=>{s.settings.language="zh-CN";current(s).edition="photo-test@reading";});
    await page.route("**/editions.json",async route=>{
      const response=await route.fetch();const editions=await response.json();
      editions["photo-test"]={art:"Clouds above a ridge",image:"/field.jpg",audio:"reading",source:"https://example.org/photo/1",sourceName:"Example Photo Archive",creator:"Sample Photographer",credit:"Photo: Sample Photographer",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/",caption:"Clouds cross the ridge in this photograph.",fact:"The source describes clouds above a ridge.",translations:{"zh-CN":{title:"山脊上的云",fact:"来源说明：山脊上方有云。"}}};
      await route.fulfill({json:editions});
    });
    await page.route("**/api/label",async route=>{requests++;await route.fulfill({json:{translation:null}});});
    await page.goto(app.issueLink());
    await expect(page.locator("#label-title")).toHaveText("Clouds above a ridge");
    await expect(page.locator("#label-fact")).toHaveText("The source describes clouds above a ridge.");
    await expect(page.locator("#label-original")).toBeHidden();
    await expect(page.locator("#label-meta")).toContainText("Sample Photographer");
    await expect(page.locator("#label-meta")).not.toContainText(/Cleveland|The Met/);
    await expect(page.locator("#label-visual-attribution")).toHaveText("Photo: Sample Photographer");
    await expect(page.locator("#label-visual-license")).toHaveAttribute("href","https://creativecommons.org/licenses/by/4.0/");
    await page.getByRole("button",{name:"译文",exact:true}).click();
    await expect(page.locator("#label-title")).toHaveText("山脊上的云");
    await expect(page.locator("#label-fact")).toHaveText("来源说明：山脊上方有云。");
    await expect(page.locator("#label-original")).toBeHidden();
    await expect(page.locator("#label-quote")).toBeHidden();
    await expect(page.locator("#label-translate")).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button",{name:"原文",exact:true}).click();
    await expect(page.locator("#label-title")).toHaveText("Clouds above a ridge");
    await expect(page.locator("#label-fact")).toHaveText("The source describes clouds above a ridge.");
    app.store.update(s=>{s.settings.language="en";});await page.reload();
    await expect(page.locator("#label-title")).toHaveText("Clouds above a ridge");
    await expect(page.locator("#label-fact")).toHaveText("The source describes clouds above a ridge.");
    await expect(page.locator("#label-source")).toHaveText("Source ↗");
    expect(requests).toBe(0);
  } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});

test("visual library setting sends a versioned preference without changing the active session or source", async ({page}) => {
  const dir=mkdtempSync(join(tmpdir(),"fm-visual-setting-"));
  const app=await serve(dir,resolve("web"),{connect:false});
  const requests:{version:number;visualLibrary:string}[]=[];
  try {
    app.store.update(s=>{s.settings.language="en";});
    // Observe the versioned request while exercising the real settings endpoint.
    await page.route("**/api/settings",async route=>{
      const body=route.request().postDataJSON();requests.push(body);
      expect(Object.keys(body).sort()).toEqual(["version","visualLibrary"]);
      expect(body.version).toBe(app.store.read().settings.version);
      await route.continue();
    });
    await page.goto(app.issueLink());
    await page.locator("#local-player").evaluate((a:HTMLAudioElement)=>a.muted=true);
    await expect(page.locator("#clock")).toHaveAccessibleName("Start");
    await page.locator("#clock").click();
    await expect.poll(()=>app.store.read().sessions.at(-1)?.state).toBe("running");
    const before=app.store.read();
    const active=before.sessions.at(-1)!;
    const expectedSource = await page.evaluate(async edition => {
      const [art, sound] = edition.split("@");
      const audio = sound ?? (await (await fetch("/editions.json")).json())[art].audio;
      return "/" + audio + ".mp3";
    }, active.edition!);
    // The timer POST can complete before its SSE update has reached the player.
    await expect(page.locator("#local-player")).toHaveAttribute("src", expectedSource);
    const source=await page.locator("#local-player").getAttribute("src");
    await page.locator("#settings-toggle").click();
    const choice=page.locator("#visual-library-choice");
    await expect(choice).toHaveAccessibleName("Visuals");
    await expect(choice).toHaveValue("contemporary");
    await expect(choice.locator("option")).toHaveText(["Photography & illustration","Museum","All"]);
    await expect(page.locator("#visual-library-hint")).toHaveText("Applies on the next change");
    await choice.selectOption("museum");
    await page.locator("#visual-library-settings button").click();
    await expect(page.locator("#visual-library-status")).toHaveText("Saved");
    expect(requests).toHaveLength(1);
    const after=app.store.read();
    expect(after.settings.visualLibrary).toBe("museum");
    expect(after.sessions.at(-1)?.deadline).toBe(active.deadline);
    expect(after.sessions.at(-1)?.edition).toBe(active.edition);
    expect(after.sessions.at(-1)?.state).toBe("running");
    expect(after.nextProgram).toBe(before.nextProgram);
    await expect(page.locator("#local-player")).toHaveAttribute("src",source!);
    app.store.update(s=>{s.settings.language="zh-CN";});
    await page.reload();await page.locator("#settings-toggle").click();
    await expect(choice).toHaveAccessibleName("画面");
    await expect(choice).toHaveValue("museum");
    await expect(choice.locator("option")).toHaveText(["影像与插画","馆藏","全部"]);
    await expect(page.locator("#visual-library-hint")).toHaveText("下次切换生效");
  } finally {await page.close();await app.stop();rmSync(dir,{recursive:true,force:true});}
});
