const $ = (s) => document.querySelector(s);
const offline = Boolean(document.querySelector("#offline-data"));
const paths = [
  "listening/ten",
  "editions",
  "sounds",
  "listening/facts",
  "listening/en",
  "listening/ko",
];
const [notes, art, sounds, facts, en, ko] = offline
  ? JSON.parse(document.querySelector("#offline-data").textContent)
  : await Promise.all(
      paths.map((path) => fetch("/" + path + ".json").then((r) => r.json())),
    );
const readPref = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const savePref = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const english = {
  factLabel: "Where does this work come from?",
  pairLabel: "Why this soundtrack?",
  asideLabel: "In the margin",
  chatLabel: "Explore with Codex",
  sourceLabel: "Museum record",
  audioLabel: "Recording",
};
const cards = notes.map((n) => ({
  ...n,
  ...facts[n.art],
  text: { ...n.text, title: facts[n.art].title, fact: facts[n.art].fact },
}));
const params = new URLSearchParams(location.search);
let index = Math.max(
    0,
    Math.min(9, Math.trunc(Number(params.get("n") || 1)) - 1 || 0),
  ),
  epoch = 0,
  connected = false,
  requested,
  confirmedLanguage;
const lang = $("#lang");
lang.value = readPref("fm-reader-language") || "auto";
const set = (id, value) => {
  $("#" + id).textContent = value;
};
function language() {
  return lang.value === "auto"
    ? confirmedLanguage === "auto" ? navigator.languages?.[0] || navigator.language || "en" : confirmedLanguage || "en"
    : lang.value;
}
async function post(path, data) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw Error(String(r.status));
  return r.json();
}
async function authorize() {
  if (offline) return;
  let r = await fetch("/api/state");
  if (r.status === 401) {
    const proof = readPref("fm-browser-pairing");
    if (proof) {
      await post("/api/browser-resume", { proof });
      r = await fetch("/api/state");
    }
  }
  if (r.ok) {
    const s = await r.json();
    connected = s.agentOnline && s.settings.connected;
    confirmedLanguage = s.settings.language;
  }
  $("#explore").hidden = !connected;
}
const ready = authorize().catch(() => {});
function promptFor(locale) {
  if (locale.startsWith("zh"))
    return [
      "我的提问 · 可改",
      "选一个我可能错过的细节，说说配上这段声音，你会怎样看它。一两句就好。",
    ];
  if (locale.startsWith("ko"))
    return [
      "내 질문 · 편집 가능",
      "내가 놓쳤을 만한 세부 하나를 골라 줘. 이 소리와 함께 보면 무엇이 달라지는지 한두 문장으로 이야기해 줘.",
    ];
  return [
    "My question · editable",
    "Pick one detail I may have missed. In a sentence or two, tell me how you see it when this sound is playing.",
  ];
}
function display(t, locale) {
  const n = cards[index];
  const [label, question] = promptFor(locale);
  set("voice-label", label);
  $("#voice").value = readPref("fm-reader-voice:" + requested) ?? question;
  const article = $("article");
  article.lang = locale;

  article.dir = "auto";
  set("title",t.title);
  set("fact",t.fact);
  set("source", t.sourceLabel + " ↗");
  set("explore-label", t.chatLabel);
  set("chat", t.chatLabel + " ↗");
  set("audio-source", t.audioLabel + " ↗");
}
async function open(i) {
  const generation = ++epoch;
  index = i;
  await ready;
  if (generation !== epoch) return;
  requested = language();
  const n = cards[i],
    w = art[n.art],
    s = sounds[n.sound];
  if (!offline) history.replaceState(null, "", "?n=" + (i + 1));
  $("details").open = false;
  for (const [j, b] of [...$("#index").children].entries())
    b.setAttribute("aria-current", String(i === j));
  $("#art").src = offline
    ? "assets/" + n.art + (w.image ? ".webp" : ".jpg")
    : w.image || "/" + n.art + ".jpg";
  $("#art").alt = w.art;
  const url =
    w.source || "https://www.metmuseum.org/art/collection/search/" + w.museum;
  $("#source").href = $("#picture").href = url;
  set("where", [w.culture, w.date].filter(Boolean).join(" · "));
  set("original", n.original);
  $("#original").lang = n.language;
  set(
    "original-label",
    n.originalKind === "museumEnglish"
      ? w.source
        ? "Cleveland Museum of Art · EN"
        : "The Met · EN"
      : new Intl.DisplayNames([n.language], { type: "language" }).of(
          n.language,
        ),
  );
  set("track", s.track);
  set("credit", s.credit);
  $("#audio").pause();
  $("#audio").src = (offline ? "assets/" : "/") + n.sound + ".mp3";
  $("#audio-source").hidden = !s.file;
  if (s.file)
    $("#audio-source").href =
      "https://commons.wikimedia.org/wiki/File:" +
      encodeURIComponent(s.file.replaceAll(" ", "_"));
  $("#license").hidden = !s.license;
  if (s.license) {
    $("#license").href = s.licenseUrl;
    set("license", s.license + " · MP3");
  }
  display(
    {
      ...n.text,
      gloss: n.extra?.zh || "",
      factLabel: "这件作品从哪来？",
      pairLabel: "为什么配这段声音？",
      asideLabel: "旁注",
      chatLabel: "和 Codex 聊",
      sourceLabel: "馆藏原页",
      audioLabel: "录音出处",
    },
    "zh-CN",
  );
  const isChinese = /^zh(?:-Hans|-CN|-SG|$)/i.test(requested);
  if (isChinese) {
    set("status", "");
    return;
  }
  if (requested.startsWith("ko")) {
    display(ko[i], "ko");
    set("status", "");
    return;
  }
  display({ ...english, ...en[i] }, "en");
  set("status", "");
  if (requested.startsWith("en") || offline) return;
  await ready;
  if (generation !== epoch) return;
  async function localized(generate) {
    // Only an explicit click can authorize a new model turn.
    if (generate) set("status", "Codex · " + requested + " …");
    try {
      const t = await post("/api/listening-language", {
        index: i,
        language: requested,
        generate,
      });
      if (generation !== epoch) return;
      display(t, requested);
      set("status", "");
    } catch {
      if (generation !== epoch) return;
      if (!connected) {
        set("status", "English");
        return;
      }
      $("#status").replaceChildren(
        Object.assign(document.createElement("button"), {
          textContent:
            "English → " +
            new Intl.DisplayNames([requested], { type: "language" }).of(
              requested,
            ) +
            " · Codex",
          onclick: () => localized(true),
        }),
      );
    }
  }
  await localized(false);
}
cards.forEach((_, i) => {
  const b = document.createElement("button");
  b.textContent = String(i + 1).padStart(2, "0");
  b.onclick = () => open(i);
  $("#index").append(b);
});
lang.onchange = () => {
  savePref("fm-reader-language", lang.value);
  open(index);
};
$("#voice").oninput = () =>
  savePref("fm-reader-voice:" + requested, $("#voice").value);
$("#chat").onclick = () => {
  const n = cards[index],
    w = art[n.art];
  sessionStorage.setItem(
    "fm-reading-draft",
    JSON.stringify({
      prompt: $("#voice").value.trim(),
      original: n.original,
      work: w.art,
      source: $("#source").href,
      fact: n.text.fact,
      recordingCredit: sounds[n.sound].credit,
      track: sounds[n.sound].track,
      language: requested,
    }),
  );
  location.href = "/";
};
const channel = new BroadcastChannel("agent-fm-audio");
channel.onmessage = (e) => {
  if (e.data === "claim") $("#audio").pause();
};
$("#audio").onplay = () => channel.postMessage("claim");
open(index);
