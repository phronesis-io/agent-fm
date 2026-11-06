import {ui, setUiLanguage} from "./i18n.js";
import { programShelf, programText } from "./programs.js";
import { musicTrace } from "./wave.js";
const [editions, sounds] = await Promise.all(
  ["/editions.json", "/sounds.json"].map((url) =>
    fetch(url).then((r) => r.json()),
  ),
);
function contentFor(key) {
  const [id, chosen] = key.split("@");
  const work = editions[id] ?? editions.field;
  const audio = chosen && sounds[chosen] ? chosen : work.audio;
  return {
    ...work,
    ...sounds[audio],
    visual: work,
    audio,
    image: work.image ?? "/" + id + ".jpg",
  };
}
let catalogue = [];
let editionId = "";
const selection = {
  title: "Debussy — Arabesque No. 1 · Patrizia Prati",
  url: "https://commons.wikimedia.org/wiki/File:Claude_Debussy_-_Premi%C3%A8re_Arabesque_-_Patrizia_Prati.ogg",
};
const audioChannel = new BroadcastChannel("agent-fm-audio");
let followTimer = false;
function releaseAudio() {
  followTimer = false;
  pausePlayback();
}
audioChannel.onmessage = (e) => {
  if (e.data === "claim") releaseAudio();
};
const claimAudio = () => audioChannel.postMessage("claim");
const $ = (s) => document.querySelector(s);
let state = null,
  events = null,
  privateMode = false,
  clockOffset = 0,
  lastMessages = "",
  lastHistory = "",
  localUrl = null;
const labels = {
  queued: "已收，正在排队",
  submitting: "正在发送",
  running: "Codex 正在回复",
  completed: "",
  failed: "回复未完成",
  interrupted: "已停止",
  uncertain: "结果待核实，不会自动重发",
};
async function api(path, body, method = "POST") {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || ui("连接失败"));
  return data;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 6500);
}
function panel(id) {
  if (privateMode) return;
  closeShelf(false);
  for (const other of ["chat", "history", "settings"])
    if (other !== id) $("#" + other).hidden = true;
  $("#" + id).hidden = !$("#" + id).hidden;
  if (id === "chat" && !$("#chat").hidden) $("#message").focus();
}
for (const id of ["chat", "history", "settings"])
  $("#" + id + "-toggle").onclick = () => panel(id);
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => ($("#" + b.dataset.close).hidden = true);

$("#clear-records").onclick = async () => {
  if (
    !confirm(
      isChinese(currentLanguage()) ? "永久清空 FM 本机的番茄、音乐、留言和聊天记录？当前番茄也会结束。Codex 会话中的内容会保留。" : "Permanently clear local timer, music, note and chat records? The current timer will end. The Codex conversation will remain.",
    )
  )
    return;
  const button = $("#clear-records");
  button.disabled = true;
  try {
    await api("/api/records", { confirm: "clear-all" }, "DELETE");
    $("#send-state").textContent = "";
    toast(ui("记录已清空"));
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
  }
};
$("#read-note").onclick = () => panel("history");
$("#private-toggle").onclick = () => {
  closeShelf(false);
  privateMode = !privateMode;
  document.body.classList.toggle("private", privateMode);
  syncArtworkAccessibility();
  $("#private-toggle").setAttribute("aria-pressed", String(privateMode));
  $("#private-toggle span").textContent = privateMode ? ui("回到房间") : ui("看画");
  if (privateMode)
    for (const id of ["chat", "history", "settings"]) $("#" + id).hidden = true;
};
$("#fullscreen").onclick = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else
    void document.documentElement
      .requestFullscreen()
      .catch(() => toast(ui("当前浏览器无法进入全屏")));
};
document.addEventListener("fullscreenchange", () => {
  const button = $("#fullscreen");
  const active = Boolean(document.fullscreenElement);
  button.setAttribute("aria-pressed", String(active));
  button.querySelector("span").textContent = active ? ui("退出全屏") : ui("全屏");
});
const audio = $("#local-player");
const enableTrace = musicTrace(audio, $("#wave"), "keys");
let trackTitle = selection.title;
let radio;
try {
  const saved = JSON.parse(localStorage.getItem("agent-fm-radio"));
  if (saved && /^[\w-]{11}$/.test(saved.id) && typeof saved.title === "string") radio = saved;
} catch {}
let radioLookup = 0;
let radioMounted = false;
const shelf = $("#station-shelf");
const stationOpen = $("#station-open");
const radioForm = $("#radio-form");
const radioStatus = $("#radio-status");

function cancelLookup() {
  radioLookup++;
  radioForm.removeAttribute("aria-busy");
  radioStatus.textContent = "";
}
function closeShelf(restoreFocus = true) {
  cancelLookup();
  if (shelf.hidden) return;
  shelf.hidden = true;
  stationOpen.setAttribute("aria-expanded", "false");
  if (restoreFocus) stationOpen.focus();
}
stationOpen.onclick = () => {
  if (!shelf.hidden) return closeShelf();
  for (const id of ["chat", "history", "settings"]) $("#" + id).hidden = true;
  shelf.hidden = false;
  stationOpen.setAttribute("aria-expanded", "true");
  (shelf.querySelector('button[aria-pressed="true"]') || $("#station-close")).focus();
};
$("#station-close").onclick = () => closeShelf();
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !shelf.hidden) {
    event.preventDefault();
    closeShelf();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!shelf.hidden && !shelf.contains(event.target) && !stationOpen.contains(event.target))
    closeShelf(false);
});
function updateTransport(label, glyph) {
  const button = $("#music-toggle");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.glyph = glyph;
}
function stopRadio() {
  $("#radio-frame").replaceChildren();
  $("#radio-tune-in").hidden = false;
  radioMounted = false;
  if (radio) updateTransport(ui("打开电台播放器"), "play");
}
function pausePlayback() {
  audio.pause();
  stopRadio();
}
function playbackRequested() {
  return radio ? radioMounted : !audio.paused;
}
function showSource() {
  const item = contentFor(editionId || "field");
  const title = radio?.title || (localUrl ? trackTitle : ui(item.track));
  document.body.classList.toggle("broadcast", Boolean(radio));
  $("#radio-screen").hidden = !radio;
  $("#keep-edition").hidden = Boolean((radio || localUrl) && !state?.program);
  $("#radio-original").hidden = !radio;
  if (radio) {
    $("#radio-name").textContent = radio.title;
    $("#radio-original").href = "https://www.youtube.com/watch?v=" + radio.id;
  }
  $("#station-caption").textContent = title;
  stationOpen.title = (isChinese(currentLanguage()) ? "选台 · " : "Stations · ") + title;
  const nextLabel = radio || localUrl ? ui("换一幅画") : ui("换一组");
  $("#next-edition").setAttribute("aria-label", nextLabel);
  $("#next-edition").title = nextLabel;
  $("#restore-track").setAttribute("aria-pressed", String(!radio && !localUrl));
  for (const station of shelf.querySelectorAll("[data-station]")) {
    station.setAttribute("aria-pressed", String(radio?.id === station.dataset.station));
  }
  const localLabel = $("#local-music").closest("label");
  if (localLabel) localLabel.toggleAttribute("data-selected", !!localUrl);
  if (radio) updateTransport(radioMounted ? ui("关闭电台播放器") : ui("打开电台播放器"), radioMounted ? "stop" : "play");
  else updateTransport(audio.paused ? ui("播放音乐") : ui("暂停音乐"), audio.paused ? "play" : "pause");
}
function resetSource() {
  pausePlayback();
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = null;
  $("#local-music").value = "";
  radio = null;
  localStorage.removeItem("agent-fm-radio");
}
function useSelectedSource() {
  if (state) state.program = null;
  showSource();
  void api("/api/record", {kind:"source-selected", detail: radio ? "YouTube · " + radio.title : localUrl ? ui("本机音频") : selection.title}).catch(() => {});
  const item = contentFor(editionId || "field");
  showSoundLabel(item);
  closeShelf();
  followTimer = true;
  if (session()?.state !== "paused") void playTrack();
}
function selectRadio(station) {
  resetSource();
  radio = station;
  localStorage.setItem("agent-fm-radio", JSON.stringify(station));
  useSelectedSource();
}
for (const button of shelf.querySelectorAll("button[data-station]")) {
  button.onclick = () => selectRadio({id:button.dataset.station, title:button.dataset.title});
}
$("#radio-url").oninput = cancelLookup;
radioForm.onsubmit = async (event) => {
  event.preventDefault();
  const request = ++radioLookup;
  radioForm.setAttribute("aria-busy", "true");
  radioStatus.textContent = ui("正在查找电台…");
  try {
    const station = await api("/api/radio", {url:$("#radio-url").value.trim()});
    if (request !== radioLookup) return;
    $("#radio-url").value = "";
    selectRadio(station);
  } catch (error) {
    if (request === radioLookup) {
      radioStatus.textContent = /Invalid URL|请输入 YouTube/.test(error.message)
        ? ui("请贴 YouTube 视频、频道链接或 @频道名。")
        : error.message;
    }
  } finally {
    if (request === radioLookup) radioForm.removeAttribute("aria-busy");
  }
};
async function playTrack() {
  if (radio) {
    if (radioMounted) return;
    const frame = document.createElement("iframe");
    frame.title = radio.title;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "autoplay; encrypted-media; fullscreen";
    frame.src = "https://www.youtube-nocookie.com/embed/" + radio.id + "?autoplay=1&playsinline=1" + (radio.loop ? "&loop=1&playlist="+radio.id : "");
    $("#radio-original").href = "https://www.youtube.com/watch?v=" + radio.id;
    $("#radio-tune-in").hidden = true;
    $("#radio-frame").append(frame);
    radioMounted = true;
    // YouTube controls playback. Mounting its player only confirms it is open.
    updateTransport(ui("关闭电台播放器"), "stop");
    claimAudio();
    return;
  }
  try {
    await Promise.all([enableTrace(), audio.play()]);
  } catch (error) {
    if (error.name === "AbortError") return;
    toast(ui("无法播放，请在音源中重新选择。"));
  }
}
function playSelectedTrack() {
  if (session()?.state === "paused") return changeClock("resume");
  followTimer = true;
  return playTrack();
}
$("#radio-tune-in").onclick = playSelectedTrack;
$("#music-toggle").onclick = () => {
  if (!playbackRequested()) return playSelectedTrack();
  if (session()?.state === "running") return changeClock("pause");
  pausePlayback();
};
let pendingNext = 0;
let advancingNext = false;
$("#next-edition").onclick = async () => {
  if (!state || pendingNext >= 20) return;
  pendingNext++;
  if (advancingNext) return;
  advancingNext = true;
  const button = $("#next-edition");
  button.setAttribute("aria-busy", "true");
  try {
    while (pendingNext > 0) {
      pendingNext--;
      await api("/api/next-edition", {});
    }
  } catch (e) {
    pendingNext = 0;
    toast(e.message);
  } finally {
    advancingNext = false;
    button.removeAttribute("aria-busy");
  }
};
const readerCards = await Promise.all(
  ["ten", "facts", "en", "ko"].map((name) =>
    fetch("/listening/" + name + ".json").then((r) => r.json()),
  ),
);
/** A set is curated when one of the ten handwritten listening notes covers it. */
function curated(key) {
  const [id, chosen] = key.split("@");
  const sound = chosen || editions[id]?.audio;
  return readerCards[0].some((n) => n.art === id && n.sound === sound);
}
/** A browser language is only a suggestion until explicitly confirmed. */
function currentLanguage() {
  return state?.settings.language === "auto" ? navigator.language || "en" : state?.settings.language || "en";
}
const languageOptions = {
  "auto":"Follow my messages",
  "en":"English", "zh-CN":"简体中文", "zh-TW":"繁體中文", "ja":"日本語",
  "ko":"한국어", "fr":"Français", "de":"Deutsch", "es":"Español",
  "pt":"Português", "it":"Italiano", "ar":"العربية", "hi":"हिन्दी",
};
for (const id of ["language-choice", "language-suggestion"]) {
  const select = $("#" + id);
  for (const [value, text] of Object.entries(languageOptions)) select.add(new Option(text, value));
}
function chooseLanguage(select, code) {
  if (![...select.options].some(option => option.value === code)) {
    let label = code;
    try { label = new Intl.DisplayNames([code], {type:"language"}).of(code) || code; } catch {}
    select.add(new Option(label, code));
  }
  select.value = code;
}
chooseLanguage($("#language-suggestion"), navigator.language || "en");
let shownLanguage = null;
let shownVisualLibrary = null;
function renderLanguage(settings) {
  const library = settings.visualLibrary ?? "contemporary";
  if (shownVisualLibrary !== library) {
    shownVisualLibrary = library;
    $("#visual-library-choice").value = library;
  }
  $("#language-confirmation").hidden = Boolean(settings.language);
  if (shownLanguage === settings.language) return;
  shownLanguage = settings.language;
  chooseLanguage($("#language-choice"), settings.language || "en");
  if (editionId) { showLabel(contentFor(editionId)); showSoundLabel(contentFor(editionId)); showSource(); }
}
for (const [formId, selectId, statusId] of [
  ["language-confirm", "language-suggestion", "language-confirm-status"],
  ["language-settings", "language-choice", "language-settings-status"],
]) {
  $("#" + formId).onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    const status = $("#" + statusId);
    status.textContent = "";
    try {
      await api("/api/settings", {version:state.settings.version, language:$("#" + selectId).value});
      render(await api("/api/state", null, "GET"));
      status.textContent = isChinese(currentLanguage()) ? "已保存" : "Saved";
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
}
$("#visual-library-settings").onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const status = $("#visual-library-status");
  button.disabled = true;
  status.textContent = "";
  try {
    await api("/api/settings", {version:state.settings.version, visualLibrary:$("#visual-library-choice").value});
    render(await api("/api/state", null, "GET"));
    status.textContent = isChinese(currentLanguage()) ? "已保存" : "Saved";
  } catch(error) { status.textContent = error.message; }
  finally {button.disabled = false;}
};
const isChinese = (lang) => /^zh(?:-Hans|-CN|-SG|$)/i.test(lang);
const languageName = (code) => {
  const zh = isChinese(currentLanguage());
  if (isChinese(code)) return zh ? "简体中文" : "Simplified Chinese";
  if (/^zh/i.test(code)) return zh ? "繁体中文" : "Traditional Chinese";
  try {
    return new Intl.DisplayNames([zh ? "zh-CN" : "en"], { type: "language" })
      .of(new Intl.Locale(code).language) || code;
  } catch { return code; }
};
function syncArtworkAccessibility() {
  $(".artwork").alt = privateMode ? $("#label-title").textContent : "";
}
function describeTranslation(text) {
  $("#label-translate").title = text;
  $("#label-translate-description").textContent = text;
}
let labelRequest = 0;
/**
 * Fact layer. Source-language museum text is always shown. Current-language
 * text is either our signed editorial Chinese, or a translation by the user's
 * own Codex made only after an explicit click. No other model text appears.
 */
function visualSource(item) {
  const art = item.visual ?? item;
  const museum = Boolean(art.museum || /(?:clevelandart\.org|metmuseum\.org)/i.test(art.source ?? ""));
  const name = art.sourceName ?? (art.museum ? "The Met" : /clevelandart\.org/i.test(art.source ?? "") ? "Cleveland Museum of Art" : "Source");
  return {art, museum, name, caption: art.caption ?? art.sourceCaption ?? art.description ?? art.museumExcerpt,
    url: art.source ?? (art.museum ? "https://www.metmuseum.org/art/collection/search/" + art.museum : "")};
}
function distinctOriginalTitle(item) {
  const normalize = text => (text ?? "").replace(/\.(?:jpe?g|png|webp)$/i, "").replace(/\s+/g," ").trim().toLocaleLowerCase();
  return normalize(item.originalTitle) === normalize(item.museumTitle ?? item.art) ? "" : item.originalTitle ?? "";
}
function originalDescription(item, zh) {
  return visualSource(item).museum ? (zh ? "查看馆方原文" : "Show the museum’s original text") : (zh ? "查看来源原文" : "Show the source text");
}
function showSourcedSummary(item, work, lang) {
  const matches = catalogue.filter(p => p.media?.kind === "edition" && p.media.edition.split("@")[0] === work);
  const info = visualSource(item), art = info.art;
  const localFact = art.fact || info.caption;
  const localProgram = localFact && info.url ? {language:art.language ?? "en",facts:[{text:localFact,source:info.url}],translations:Object.fromEntries(Object.entries(art.translations ?? {}).filter(([,t]) => t.fact).map(([locale,t]) => [locale,{facts:[t.fact]}]))} : null;
  const program = matches.find(p => p.id === state?.program?.id) ?? matches[0] ?? localProgram;
  if (!program?.facts?.[0]?.source) return false;
  const zh = isChinese(lang);
  const exact = Object.keys(program.translations ?? {}).find(key => key.toLowerCase() === lang.toLowerCase());
  const translated = program.translations?.[exact] ?? (zh ? program.translations?.["zh-CN"] ?? program.translations?.["zh-Hans"] ?? program.translations?.zh : undefined);
  // Without a matching bundled translation, retain the existing opt-in Codex path.
  if (!translated && !/^en(?:-|$)/i.test(lang)) return false;
  const visualKey = Object.keys(art.translations ?? {}).find(key => key.toLowerCase() === lang.toLowerCase());
  const visualTranslation = art.translations?.[visualKey] ?? (zh ? art.translations?.["zh-CN"] ?? art.translations?.["zh-Hans"] ?? art.translations?.zh : undefined);
  const originalTitle = item.museumTitle ?? item.art;
  const translatedTitle = visualTranslation?.title ?? (zh ? readerCards[1][work]?.title ?? (item.museumTitle ? item.art : undefined) : undefined);
  const native = distinctOriginalTitle(item);
  const button = $("#label-translate");
  let showingTranslation = false;
  const display = () => {
    $("#label-title").textContent = showingTranslation && translatedTitle ? translatedTitle : originalTitle;
    $("#label-title").lang = showingTranslation && translatedTitle ? lang : (art.language ?? "en");
    $("#label-original").textContent = native;
    $("#label-original").hidden = showingTranslation || !native;
    $("#label-fact").textContent = showingTranslation ? translated.facts[0] : program.facts[0].text;
    $("#label-fact").lang = showingTranslation ? lang : program.language;
    $("#label-fact").hidden = false;
    $("#label-quote").hidden = true;
    $("#label-lang-note").textContent = zh ? "资料摘要" : "Sourced summary";
    $("#label-summary-source").hidden = true;
    $("#label-source").href = program.facts[0].source;
    button.hidden = !translated || translated.facts[0] === program.facts[0].text;
    button.textContent = showingTranslation ? (zh ? "原文" : "Original") : (zh ? "译文" : "Translation");
    button.setAttribute("aria-pressed", String(showingTranslation));
    describeTranslation(showingTranslation ? (zh ? "查看原文" : "Show original text") : (zh ? "查看" + languageName(lang) + "译文" : "Show translation in " + languageName(lang)));
    syncArtworkAccessibility();
  };
  button.onclick = () => {showingTranslation = !showingTranslation;display();};
  display();
  return true;
}
function showLabel(item) {
  const request = ++labelRequest;
  const [notes, facts] = readerCards;
  const work = editionId.split("@")[0];
  const index = notes.findIndex((n) => n.art === work && n.sound === item.audio);
  const fact = facts[work];
  const lang = currentLanguage();
  const zh = isChinese(lang);
  const info = visualSource(item);
  const museum = info.name;
  const sourceTitle = item.museumTitle ?? (item.source ? item.art : undefined);
  // Editorial Chinese exists for the curated ten and the Met works.
  const exactVisualLocale = Object.keys(info.art.translations ?? {}).find(key => key.toLowerCase() === lang.toLowerCase());
  const visualTranslation = zh ? info.art.translations?.[exactVisualLocale] ?? info.art.translations?.["zh-CN"] ?? info.art.translations?.["zh-Hans"] ?? info.art.translations?.zh : undefined;
  const editorialTitle = visualTranslation?.title ?? fact?.title ?? (item.museumTitle ? item.art : undefined);
  const native = fact?.original && fact.language !== "en" ? fact.original : distinctOriginalTitle(item);
  $("#label-title").textContent = sourceTitle ?? item.art;
  $("#label-title").lang = info.art.language ?? "en";
  const second = [native].filter(Boolean);
  $("#label-original").textContent = [...new Set(second)].join(" · ");
  $("#label-original").hidden = !second.length;
  $("#label-meta").textContent = [info.art.creator, item.culture, item.date, item.collection, museum]
    .filter(Boolean)
    .join(" · ");
  $("#label-meta").lang = "en";
  $("#label-meta-source").hidden = true;
  const editorialFact = undefined;
  $("#label-fact").textContent = editorialFact ?? "";
  $("#label-fact").hidden = !editorialFact;
  // Quote: van Gogh's letter excerpt (our labelled translation) or the museum's own words.
  const quote = $("#label-quote");
  const excerpt = info.caption;
  quote.hidden = !excerpt;
  quote.querySelector(".quote-current").hidden = true;
  quote.querySelector(".quote-source").hidden = false;
  quote.querySelector("cite").hidden = false;
  if (excerpt) {
    const p = quote.querySelector(".quote-source");
    p.textContent = item.letter ? "“" + excerpt + "”" : excerpt;
    p.lang = item.letter && zh ? "zh-CN" : "en";
    const cite = quote.querySelector("a");
    cite.href = item.letter
      ? "https://vangoghletters.org/vg/letters/let" + item.letter + "/translation.html"
      : item.source;
    cite.textContent = item.letter
      ? (zh ? "梵高致提奥，第 " + item.letter + " 封信（编辑节译）" : "Van Gogh to Theo, letter " + item.letter + " · editorial Chinese excerpt")
      : museum + (info.museum ? (zh ? " · 馆藏说明原文" : " · museum text") : (zh ? " · 来源原文" : " · source text"));
  }
  $("#label-source").href = info.url;
  $("#label-source").hidden = !info.url;
  $("#label-source").textContent = info.museum ? (zh ? "馆藏原页 ↗" : "Museum source ↗") : (zh ? "来源 ↗" : "Source ↗");
  const visualCredit = $("#label-visual-credit");
  visualCredit.hidden = info.museum || !(info.art.credit || info.art.license);
  $("#label-visual-attribution").textContent = info.art.credit ?? info.art.creator ?? "";
  const visualLicense = $("#label-visual-license");
  visualLicense.textContent = info.art.license ?? "";
  visualLicense.hidden = !info.art.license;
  if (info.art.licenseUrl) visualLicense.href = info.art.licenseUrl;
  else visualLicense.removeAttribute("href");
  $("#label-notes").hidden = index < 0;
  if (index >= 0) $("#label-notes").href = "/listening.html?n=" + (index + 1);
  const note = $("#label-lang-note");
  const button = $("#label-translate");
  button.hidden = true;
  button.setAttribute("aria-pressed", "false");
  button.disabled = false;
  describeTranslation("");
  syncArtworkAccessibility();
  $("#label-summary-source").hidden = true;
  if (showSourcedSummary(item, work, lang)) return;
  const sourceName = languageName("en");

  if (lang.startsWith("en")) {
    note.textContent = "Source: " + museum;
    return;
  }
  note.textContent = (zh ? "原文：" : "Source: ") + sourceName;
  void api("/api/label", { id: work, language: lang })
    .then((r) => {
      if (request !== labelRequest) return;
      if (r.translation) return applyTranslation(r, item, lang);
      const online = state?.settings.connected && state?.agentOnline;
      button.hidden = !online;
      button.textContent = zh ? "翻译" : "Translate";
      describeTranslation(zh ? "用 Codex 翻译为" + languageName(lang)
        : "Translate into " + languageName(lang) + " with Codex");
      button.onclick = async () => {
        button.disabled = true;
        button.textContent = zh ? "翻译中…" : "Translating…";
        try {
          const done = await api("/api/label", { id: work, language: lang, translate: true });
          if (request === labelRequest) applyTranslation(done, item, lang, true);
        } catch (e) {
          if (request === labelRequest) {
            toast(e.message);
            button.textContent = zh ? "重试" : "Retry";
          }
        } finally {
          if (request === labelRequest) button.disabled = false;
        }
      };
    })
    .catch(() => {});
}
function applyTranslation(r, item, lang, showImmediately = false) {
  const fields = ["#label-title", "#label-original", "#label-meta", "#label-meta-source", "#label-quote .quote-current", "#label-quote .quote-source", "#label-quote cite", "#label-lang-note"];
  const snapshot = () => fields.map(selector => {
    const node = $(selector);
    return { node, text: node.textContent, lang: node.lang, hidden: node.hidden };
  });
  const original = snapshot();
  const t = r.translation;
  const zh = isChinese(lang);
  $("#label-title").textContent = t.title;
  $("#label-title").lang = lang;
  $("#label-original").hidden = true;
  const info = visualSource(item);
  const museum = info.name;
  if (t.culture || t.collection) {
    $("#label-meta-source").textContent = $("#label-meta").textContent;
    $("#label-meta-source").lang = "en";
    $("#label-meta-source").hidden = true;
    $("#label-meta").textContent = [t.culture, item.date, t.collection, museum]
      .filter(Boolean)
      .join(" · ");
    $("#label-meta").lang = lang;
  }
  if (t.excerpt && !$("#label-quote").hidden) {
    const p = $("#label-quote .quote-current");
    p.textContent = t.excerpt;
    $("#label-quote .quote-source").hidden = true;
    $("#label-quote cite").hidden = true;
    p.lang = lang;
    p.hidden = false;
  }
  $("#label-lang-note").textContent = zh
    ? "Codex 译文" : "Translated by Codex";
  const translated = snapshot();
  let showingTranslation = showImmediately;
  const button = $("#label-translate");
  button.hidden = false;
  const display = () => {
    for (const { node, text, lang, hidden } of showingTranslation ? translated : original) {
      node.textContent = text; node.lang = lang; node.hidden = hidden;
    }
    button.textContent = showingTranslation ? (zh ? "原文" : "Original") : (zh ? "译文" : "Translation");
    button.setAttribute("aria-pressed", String(showingTranslation));
    describeTranslation(showingTranslation ? (zh ? "查看原文" : "Show original text") : (zh ? "查看 Codex 译文" : "Show the Codex translation"));
    syncArtworkAccessibility();
  };
  button.onclick = () => {showingTranslation = !showingTranslation;display();};
  display();
}
function showSoundLabel(item) {
  const external = radio || localUrl;
  $("#label-track").textContent = radio?.title || (localUrl ? trackTitle : ui(item.track));
  $("#label-credit").textContent = radio
    ? ui("YouTube 外链电台 · 曲目由播放器提供")
    : localUrl
      ? ui("本机音频")
      : ui(item.credit ?? "");
  $("#label-license").hidden = external || !item.file;
  if (!external && item.file) {
    $("#label-location").textContent = item.location || "";
    const license = $("#label-license a");
    license.href = item.licenseUrl;
    license.textContent = item.license;
    $("#label-recording").href = selection.url;
  }
}
function useEdition(id) {
  if (id === editionId) return;
  editionId = id;
  const item = contentFor(id);
  const resume = !radio && !localUrl && !audio.paused;
  if (resume) audio.pause();
  const credit = item.credit ?? "Debussy · Patrizia Prati";
  selection.title = item.track + " · " + credit;
  selection.url = item.recordingSource || (item.file
    ? "https://commons.wikimedia.org/wiki/File:" +
      encodeURIComponent(item.file.replaceAll(" ", "_"))
    : "");
  $(".artwork").src = item.image;
  showLabel(item);
  if (!radio && !localUrl) restoreEditionAudio();
  showSource();
  showSoundLabel(item);
  if (resume) void playTrack();
}
function restoreEditionAudio() {
  const item = contentFor(editionId || "field");
  audio.src = "/" + item.audio + ".mp3";
  trackTitle = selection.title;
}
$("#restore-track").onclick = () => {
  resetSource();
  restoreEditionAudio();
  useSelectedSource();
};
$("#local-music").onchange = () => {
  const file = $("#local-music").files[0];
  if (!file) return;
  resetSource();
  localUrl = URL.createObjectURL(file);
  audio.src = localUrl;
  trackTitle = file.name;
  useSelectedSource();
};
for (const name of ["play", "pause"])
  audio.addEventListener(name, () => {
    if (radio) return;
    if (name === "play") claimAudio();
    updateTransport(audio.paused ? ui("播放音乐") : ui("暂停音乐"), audio.paused ? "play" : "pause");
    void api("/api/record", { kind: name, detail: trackTitle }).catch(() => {});
  });
function timerAction(action, minutes) {
  return api("/api/timer", { action, minutes }).catch((e) => toast(e.message));
}
$("#timer-extend").onclick = () => timerAction("extend", 5);
const renderPrograms = programShelf({api, language:currentLanguage, status:toast, editions});
let appliedProgram = null;
function useProgram(program) {
  resetSource();
  if (program.media.kind === "youtube") {
    radio = {id:program.playback.id,title:programText(program,currentLanguage()).title,loop:program.media.loop};
    localStorage.setItem("agent-fm-radio",JSON.stringify(radio));
  } else {
    useEdition(program.media.edition);
    restoreEditionAudio();
  }
  showSource();
  showSoundLabel(contentFor(editionId || "field"));
}
let clockBusy = false;
async function changeClock(action) {
  if (clockBusy) return;
  clockBusy = true;
  $("#clock").disabled = $("#music-toggle").disabled = true;
  const wasPlaying = playbackRequested();
  try {
    if (action === "pause") pausePlayback();
    else {
      if(action === "start" && state?.nextProgram) useProgram(state.nextProgram);
      followTimer = true;
      void playTrack();
    }
    if (session()?.state === "elapsed" && action === "start")
      await api("/api/timer", { action: "end" });
    await api("/api/timer", { action, minutes: 25 });
  } catch (e) {
    if (!wasPlaying) pausePlayback();
    else if (!playbackRequested()) void playTrack();
    toast(e.message);
  } finally {
    clockBusy = false;
    $("#clock").disabled = $("#music-toggle").disabled = false;
  }
}
$("#clock").onclick = () => {
  const phase = session()?.state;
  return changeClock(
    phase === "running" ? "pause" : phase === "paused" ? "resume" : "start",
  );
};
$("#timer-end").onclick = () => timerAction("end");
function session() {
  return state?.sessions.findLast((s) => !s.ended);
}
function renderTimer() {
  const s = session();
  const started = s && s.state !== "open";
  const today = new Date(Date.now() + clockOffset).toLocaleDateString();
  const completed =
    state?.events.filter(
      (e) =>
        e.kind === "completed" && new Date(e.at).toLocaleDateString() === today,
    ).length ?? 0;
  $("#today-count").textContent = isChinese(currentLanguage()) ? `今天完成 ${completed} 个` : `${completed} completed today`;
  renderWeek();
  const ms = !started
    ? 1500000
    : s.state === "paused"
      ? s.remaining
      : Math.max(0, (s.deadline ?? 0) - Date.now() - clockOffset);
  const sec = Math.ceil(ms / 1000);
  const label = !started
    ? ui("开始")
    : s.state === "paused"
      ? ui("继续")
      : s.state === "elapsed"
        ? ui("下一个")
        : ui("暂停");
  $("#clock").setAttribute("aria-label", label);
  $("#clock-action").textContent = (label === ui("暂停") ? "Ⅱ " : "▷ ") + label;
  $("#clock-detail").textContent =
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0");
  $("#remaining").textContent = String(Math.ceil(ms / 60000));
  const planned = started
    ? state.events.reduce(
        (n, e) =>
          n +
          (e.sessionId === s.id && ["start", "extend"].includes(e.kind)
            ? Number(e.detail) * 60000
            : 0),
        0,
      )
    : 1500000;
  const fraction = Math.min(1, ms / (planned || 1500000));
  $("#arc").setAttribute("stroke-dasharray", 100 * fraction + " 100");
  $("#arc").style.visibility = ms ? "visible" : "hidden";
  $("#timer-extend").hidden = $("#timer-end").hidden = !started;
  // During a Pomodoro the clock is the single playback control.
  $("#music-toggle").hidden = Boolean(started && s.state !== "elapsed");
}
setInterval(renderTimer, 250);
const element = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
function render(s) {
  const previous = session()?.state;
  state = s;
  $("#clock").disabled = $("#music-toggle").disabled = clockBusy;
  setUiLanguage(currentLanguage());
  renderLanguage(s.settings);
  renderPrograms(s);
  const programKey = s.program ? session()?.id + ":" + s.program.id : null;
  if(programKey !== appliedProgram) {
    appliedProgram = programKey;
    if(s.program && (!(radio || localUrl) || session()?.editionSource === "queued")) {
      const resume = followTimer && session()?.state === "running";
      useProgram(s.program);
      if (editionId) showLabel(contentFor(editionId));
      if(resume) void playTrack();
    }
  }
  const phase = session()?.state;
  if (previous === "running" && phase === "elapsed") toast(ui("番茄完成，可以休息一下。"));
  if (phase !== previous) {
    if (
      phase === "paused" ||
      phase === "elapsed" ||
      (previous === "running" && !phase)
    )
      pausePlayback();
    if (phase === "running" && followTimer && !playbackRequested() && !clockBusy)
      void playTrack();
  }
  const playing = s.sessions.findLast((t) => t.edition);
  useEdition(playing?.edition ?? "field");
  const selectedProgram = s.program?.provider === "editorial" && Boolean(s.program.collection);
  const source = { codex: ui("Codex 选曲"), random: ui("随机选曲"), queued: ui("你选的") }[playing?.editionSource];
  const shelf = (s.program ? selectedProgram : curated(playing?.edition ?? "field")) ? ui("精选") : ui("漫游");
  $("#label-shelf").textContent = source ? shelf + " · " + source : shelf;
  const saved = s.events.some(e => e.kind === "keep" && (s.program
    ? e.program?.id === s.program.id && e.program?.revision === s.program.revision
    : !e.program && e.detail === currentEdition()));
  const saveButton = $("#keep-edition");
  saveButton.textContent = saved ? ui("已收藏") : ui("收藏");
  saveButton.disabled = saved;
  saveButton.title = s.program ? (isChinese(currentLanguage()) ? "收藏当前节目" : "Save this programme") : ui("收藏当前画作与音乐");
  saveButton.hidden = Boolean(localUrl || (radio && !(s.program?.media.kind === "youtube" && s.program?.playback?.id === radio.id)));
  const reason = playing?.editionSource === "codex" ? playing.editionReason : "";
  $("#label-reason").textContent = reason ? (isChinese(currentLanguage()) ? "Codex 选这组的理由：" : "Why Codex chose this: ") + reason : "";
  $("#label-reason").hidden = !reason;
  clockOffset = s.now - Date.now();
  document.body.classList.toggle("night", s.settings.theme === "night");
  $("#connection").textContent = !s.settings.connected
    ? ui("Codex 已断开")
    : s.agentOnline
      ? ""
      : ui("Codex 离线");
  $("#connection-error").textContent = s.connectionError || "";
  $("#session-info").textContent = s.settings.threadId
    ? (isChinese(currentLanguage()) ? "已绑定专属长期会话" : "Bound to your lasting conversation") + (s.model ? " · " + s.model : "")
    : ui("正在准备专属会话");
  for (const [id, key] of [
    ["curate-next", "curateNext"],
    ["day-close", "dayClose"],
    ["completion-companion", "completionCompanion"],
    ["connected", "connected"],
  ])
    $("#" + id).checked = Boolean(s.settings[key]);
  renderLedger(s.ledger ?? []);
  $("#night").checked = s.settings.theme === "night";
  $("#note-peek").hidden = !s.notes.length || privateMode;
  renderTimer();
  const key = JSON.stringify(s.runs) + currentLanguage();
  if (key !== lastMessages) {
    lastMessages = key;
    const list = $("#messages");
    const nearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 70;
    list.replaceChildren();
    if (!s.runs.length) list.append(element("p", "", "muted"));
    for (const r of s.runs) {
      const user = element("div", undefined, "message user");
      let visible = r.text,
        source = "";
      for (const marker of [
        "\n\n[Agent FM · listening card]\n",
        "\n\n[Agent FM · context]\n",
      ]) {
        const boundary = r.text.lastIndexOf(marker);
        if (boundary < 0) continue;
        try {
          const ref = JSON.parse(r.text.slice(boundary + marker.length));
          visible = r.text.slice(0, boundary);
          source = ref.label || ref.original || "";
        } catch {}
      }
      if (r.source === "completion") visible = ui("番茄完成");
      user.append(element("small", r.source === "completion" ? "FM" : ui("你")), element("div", visible));
      if (source) user.append(element("small", source));
      list.append(user);
      if (r.reply || labels[r.status]) {
        const reply = element("div", undefined, "message");
        reply.append(
          element("small", "Codex"),
          element("div", r.reply),
          element("p", r.error || ui(labels[r.status]), "status"),
        );
        list.append(reply);
      }
    }
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }
  const active = s.runs.findLast((r) =>
    ["running", "submitting", "queued"].includes(r.status),
  );
  $("#cancel").hidden = !active;
  if (active && s.agentOnline)
    $("#connection").textContent = labels[active.status];
  const log = $("#pomodoro-log");
  log.replaceChildren(element("h3", ui("番茄记录")));
  const starts = s.events
    .filter((e) => e.kind === "start")
    .slice()
    .reverse();
  if (!starts.length)
    log.append(
      element("p", ui("开始一个 25 分钟的番茄，结束后记录会留在这里。"), "muted"),
    );
  for (const start of starts) {
    const t = s.sessions.find((t) => t.id === start.sessionId);
    if (!t) continue;
    const completed = s.events.find(
      (e) => e.sessionId === t.id && e.kind === "completed",
    );
    const label = completed
      ? ui("已完成")
      : t.ended
        ? ui("提前结束")
        : t.state === "paused"
          ? ui("已暂停")
          : ui("进行中");
    const row = element("div", undefined, "tomato-row");
    row.append(
      element(
        "span",
        new Date(start.at).toLocaleString(currentLanguage(), {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
      element("span", start.detail + (isChinese(currentLanguage()) ? " 分钟" : " min")),
      element("span", label),
    );
    log.append(row);
  }
  const history = JSON.stringify([s.sessions, s.notes, s.events]) + currentLanguage();
  if (history !== lastHistory) {
    lastHistory = history;
    const list = $("#history-items");
    list.replaceChildren();
    for (const t of [...s.sessions].reverse()) {
      const section = element("section", undefined, "history-session");
      section.append(
        element(
          "h3",
          new Date(t.started).toLocaleString(currentLanguage(), {
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
      );
      for (const e of s.events.filter(
        (e) =>
          e.sessionId === t.id &&
          ["favorite-source", "source-open", "play", "keep"].includes(e.kind),
      )) {
        if (e.kind !== "keep") {
          section.append(
            element(
              "p",
              (e.kind === "favorite-source" ? (isChinese(currentLanguage()) ? "收藏：" : "Saved: ") : "") + e.detail,
            ),
          );
          continue;
        }
        const kept = element("div", undefined, "kept");
        const item = contentFor(e.detail);
        const savedTitle = e.program ? programText(e.program,currentLanguage()).title : item.art + " · " + item.track;
        kept.append(element("p", (isChinese(currentLanguage()) ? "收藏：" : "Saved: ") + savedTitle));
        const talk = element("button", ui("带去聊"));
        talk.onclick = () => e.program
          ? stage(isChinese(currentLanguage()) ? "想聊聊我收藏的这期节目。" : "Let’s return to this programme I saved.",
              {kind:"saved programme",program:e.program},savedTitle)
          : discuss(e.detail, (isChinese(currentLanguage()) ? "想聊聊我收藏的这组画作和音乐。" : "Let’s return to this set I saved."));
        kept.append(talk);
        section.append(kept);
      }
      for (const note of s.notes.filter((n) => n.sessionId === t.id)) {
        const n = element("div", undefined, "note");
        n.append(element("p", note.text));
        const fav = element("button", note.favorite ? ui("已收藏") : ui("收藏"));
        fav.onclick = () =>
          api("/api/note", { id: note.id, action: "favorite" }).catch((e) =>
            toast(e.message),
          );
        const del = element("button", ui("删除留言"));
        del.onclick = () =>
          api("/api/note", { id: note.id, action: "delete" }).catch((e) =>
            toast(e.message),
          );
        const talk = element("button", ui("带去聊"));
        talk.onclick = () =>
          stage(
            (isChinese(currentLanguage()) ? "想接着聊你留下的这句话。" : "Let’s return to this note you left."),
            { kind: "note", original: note.source, note: note.text, at: note.created },
            (isChinese(currentLanguage()) ? "留言 · " : "Note · ") + note.source,
          );
        n.append(fav, talk, del);
        section.append(n);
      }
      const recall = element("button", ui("带去聊这段时间"));
      recall.onclick = () =>
        stage(
          (isChinese(currentLanguage()) ? "想接着聊这段时间：" : "Let’s return to this interval: ") + new Date(t.started).toLocaleString(currentLanguage()),
          { kind: "session", original: isChinese(currentLanguage()) ? "时段记录" : "Session record", session: t.id, edition: t.edition ?? "" },
          (isChinese(currentLanguage()) ? "时段 · " : "Session · ") + new Date(t.started).toLocaleString(currentLanguage(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        );
      const del = element("button", ui("删除这段记录"));
      del.onclick = () => {
        if (confirm(isChinese(currentLanguage()) ? "删除 App 中这段记录？Codex 已收到的聊天不会一并删除。" : "Delete this local record? Messages already received by Codex remain in its conversation."))
          void api("/api/session", { id: t.id }, "DELETE").catch((e) =>
            toast(e.message),
          );
      };
      section.append(recall, del);
      list.append(section);
    }
  }
}
for (const [id, key] of [
  ["curate-next", "curateNext"],
  ["day-close", "dayClose"],
  ["completion-companion", "completionCompanion"],
  ["connected", "connected"],
  ["night", "theme"],
])
  $("#" + id).onchange = () => {
    if (!state) return;
    api("/api/settings", {
      version: state.settings.version,
      [key]:
        id === "night"
          ? $("#night").checked
            ? "night"
            : "lake"
          : $("#" + id).checked,
    }).catch((e) => toast(e.message));
  };
let pending = null;
let reading = null;
function dropReading() {
  reading = null;
  $("#reading-context").hidden = true;
  $("#attach-edition").hidden = false;
}
$("#reading-context").onclick = dropReading;
$("#chat-form").onsubmit = async (e) => {
  e.preventDefault();
  const question = $("#message").value.trim();
  if (!question) return;
  const text = reading
    ? question +
      (reading.kind ? "\n\n[Agent FM · context]\n" : "\n\n[Agent FM · listening card]\n") +
      JSON.stringify(reading)
    : question;
  if (!pending || pending.text !== text)
    pending = { id: crypto.randomUUID(), text };
  const b = $("#chat-form button[type=submit]");
  b.disabled = true;
  try {
    await api("/api/messages", pending);
    $("#message").value = "";
    pending = null;
    dropReading();
    $("#send-state").textContent = ui("已收");
  } catch (e) {
    toast(e.message);
    $("#send-state").textContent = ui("还没确认收到，可重试");
  } finally {
    b.disabled = false;
  }
};
$("#message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing)
    $("#chat-form").requestSubmit();
});
$("#cancel").onclick = () => api("/api/cancel").catch((e) => toast(e.message));
/** Put a draft and its sourced context into the chat; nothing is sent. */
function stage(prompt, context, label) {
  reading = { ...context, label };
  panel("chat");
  if ($("#chat").hidden) panel("chat");
  $("#message").value = prompt;
  $("#reading-context").textContent = label + " ×";
  $("#reading-context").title = ui("移除附带资料");
  $("#reading-context").hidden = false;
  $("#attach-edition").hidden = true;
  $("#message").focus();
}
function discuss(key, prompt) {
  const item = contentFor(key);
  stage(
    prompt,
    {
      kind: "edition",
      original: item.originalTitle || item.art,
      edition: key,
      work: item.art,
      date: item.date ?? "",
      culture: item.culture ?? "",
      source: item.source ?? "https://www.metmuseum.org/art/collection/search/" + item.museum,
      track: item.track,
      recordingCredit: item.credit ?? "",
      shelf: curated(key) ? ui("精选") : ui("漫游"),
    },
    item.art + " · " + item.track,
  );
}
function currentEdition() {
  return state?.sessions.findLast((t) => t.edition)?.edition ?? "field";
}
$("#keep-edition").onclick = async () => {
  try {
    await api("/api/keep", {});
    toast(ui("已收藏，可在记录中查看。"));
  } catch (e) {
    toast(e.message);
  }
};
$("#attach-edition").onclick = () =>
  discuss(currentEdition(), $("#message").value.trim() || (isChinese(currentLanguage()) ? "想聊聊这一组。" : "Let’s talk about this set."));
$("#label-hide").onclick = () => setLabel(!document.body.classList.contains("label-off"));
function setLabel(off) {
  document.body.classList.toggle("label-off", off);
  $("#label-hide").setAttribute("aria-expanded", String(!off));
  const text = off ? ui("展开说明") : ui("收起说明");
  $("#label-hide").title = text;
  $("#label-hide .sr-only").textContent = text;
  try {
    localStorage.setItem("fm-label-off", off ? "1" : "");
  } catch {}
}
try {
  if (localStorage.getItem("fm-label-off")) setLabel(true);
} catch {}
const ledgerLabels = {
  curate: "选下一组",
  dayclose: "一天收尾",
  completion: "到点陪伴",
  chat: "聊天",
  translate: "翻译",
};
let lastLedger = "";
function renderLedger(entries) {
  const key = JSON.stringify(entries) + currentLanguage();
  if (key === lastLedger) return;
  lastLedger = key;
  const calls = entries.filter((e) => !e.outcome.startsWith("已达上限"));
  const curate = calls.filter((e) => e.kind === "curate").length;
  $("#ledger-summary").textContent = calls.length
    ? (isChinese(currentLanguage()) ? `今天调用 ${calls.length} 次 · 选下一组 ${curate}/12` : `${calls.length} calls today · Next selection ${curate}/12`)
    : ui("今天还没有调用 Codex。");
  const list = $("#ledger-items");
  list.replaceChildren();
  for (const e of [...entries].reverse().slice(0, 30)) {
    const li = element("li");
    li.append(
      element(
        "time",
        new Date(e.at).toLocaleTimeString(currentLanguage(), { hour: "2-digit", minute: "2-digit" }),
      ),
      element("span", ui(ledgerLabels[e.kind] ?? e.kind)),
      element("span", ui(e.outcome), "muted"),
    );
    list.append(li);
  }
}
let lastWeek = "";
function renderWeek() {
  if (!state) return;
  const now = Date.now() + clockOffset;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    days.push({ key: d.toLocaleDateString(), label: isChinese(currentLanguage()) ? "日一二三四五六"[d.getDay()] : d.toLocaleDateString(currentLanguage(), {weekday:"short"}) });
  }
  const counts = days.map(
    (d) =>
      state.events.filter(
        (e) => e.kind === "completed" && new Date(e.at).toLocaleDateString() === d.key,
      ).length,
  );
  const key = JSON.stringify(counts) + days[6].key + currentLanguage();
  if (key === lastWeek) return;
  lastWeek = key;
  const peak = Math.max(4, ...counts);
  const list = $("#week");
  list.replaceChildren();
  days.forEach((d, i) => {
    const li = element("li");
    li.setAttribute("aria-label", isChinese(currentLanguage()) ? `周${d.label} ${counts[i]} 个` : `${d.label}: ${counts[i]} completed`);
    const bar = element("span", undefined, "bar");
    bar.style.setProperty("--fill", String(counts[i] / peak));
    li.append(element("span", String(counts[i] || ""), "count"), bar, element("span", d.label, "day"));
    if (i === 6) li.classList.add("today");
    list.append(li);
  });
}
async function loadSourcedCatalogue() {
  try {
    const result = await api("/api/programs", undefined, "GET");
    catalogue = result.programs.filter(p => p.provider === "editorial");
  } catch { catalogue = []; }
}
async function start() {
  const key = new URLSearchParams(location.hash.slice(1)).get("pair");
  history.replaceState(null, "", location.pathname);
  const storageKey = "fm-browser-pairing";
  if (key) {
    const paired = await api("/api/pair", { key });
    try {
      localStorage.setItem(storageKey, paired.proof);
    } catch {}
  }
  const response = await fetch("/api/state");
  if (response.status === 401) {
    const proof = localStorage.getItem(storageKey);
    if (!proof) throw Error(ui("请在 Codex 中打开 Agent FM 完成配对"));
    await api("/api/browser-resume", { proof });
    await loadSourcedCatalogue();
    render(await api("/api/state", null, "GET"));
  } else {
    if (!response.ok) throw Error(ui("无法读取空间"));
    await loadSourcedCatalogue();
    render(await response.json());
  }
  const draft = sessionStorage.getItem("fm-reading-draft");
  if (draft) {
    sessionStorage.removeItem("fm-reading-draft");
    try {
      reading = JSON.parse(draft);
      $("#message").value = reading.prompt || "";
      delete reading.prompt;
      $("#reading-context").textContent = reading.original + " ×";
      $("#reading-context").title = ui("移除作品资料");
      $("#reading-context").hidden = false;
      $("#attach-edition").hidden = true;
      panel("chat");
    } catch {
      dropReading();
    }
  }
  events = new EventSource("/api/events");
  events.addEventListener("state", (e) => render(JSON.parse(e.data)));
  events.onerror = () => ($("#connection").textContent = ui("连接中断，正在重连"));
  const beat = () => {
    if (!document.hidden)
      void api("/api/heartbeat", { visible: true }).catch(() => {});
  };
  beat();
  setInterval(beat, 5000);
  document.addEventListener("visibilitychange", beat);
}
start().catch((e) => {
  toast(e.message);
  $("#connection").textContent = ui("请在 Codex 中重新打开 Agent FM");
});

let explanation = null;
$("#chat-toggle").onclick = async () => {
  const button = $("#chat-toggle");
  if ($("#chat").hidden) panel("chat");
  $("#message").focus();
  if (!state?.agentOnline || !state?.settings.connected) return;
  if (state.runs.some(r => ["queued", "submitting", "running"].includes(r.status))) return;
  if (button.disabled) return;
  const key = currentEdition();
  const item = contentFor(key);
  const context = state?.program && !localUrl && (!radio || (state.program.media.kind === "youtube" && state.program.playback?.id === radio.id))
    ? {kind:"prepared programme", title:state.program.title, originalTitle:state.program.originalTitle,
        facts:state.program.facts, editorialInterpretation:state.program.note, media:state.program.media}
    : radio
    ? { kind:"YouTube station", title:radio.title, url:"https://www.youtube.com/watch?v="+radio.id }
    : { kind:"artwork", title:item.originalTitle || item.art, date:item.date, culture:item.culture,
        excerpt:item.museumExcerpt, source:item.source || "https://www.metmuseum.org/art/collection/search/"+item.museum,
        sound: localUrl ? "User-selected local audio; contents unknown" : item.track, recordingCredit:localUrl ? undefined : item.credit };
  const text = (isChinese(currentLanguage()) ? "陪我聊两句。" : "Keep me company for a moment.") + "\n\n[Agent FM · context]\n" + JSON.stringify({
    instruction:"Respond to the listener calling you over, "+(state?.settings.language && state.settings.language !== "auto" ? "in their confirmed language ("+state.settings.language+")" : "following the language of their most recent message")+", in one or two natural sentences. Use the existing conversation and current FM context to choose a relevant opening. A concrete observation about the artwork or sound, or picking up something the listener said, can be enough. Do not force a lesson, question, greeting, or recap. Keep sourced facts distinct from your interpretation. Use the FM activity context only when relevant. Do not invent the contents of a live broadcast, infer their work or mood, or turn this into an activity report.",
    selection:context
  });
  if (!explanation || explanation.text !== text) explanation = {id:crypto.randomUUID(),text};
  button.disabled = true;
  try {
    await api("/api/messages", explanation);
    explanation = null;
    $("#send-state").textContent = ui("已收");
  } catch(e) { toast(e.message); }
  finally { button.disabled = false; }
};
