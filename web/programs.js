const isSimplifiedChinese = language => /^zh(?:-Hans|-CN|-SG|$)/i.test(language);

/** Display translations never replace the source title or sourced original text. */
export function programText(program, language = "en") {
  const translations = program.translations ?? {};
  const key = Object.keys(translations).find(k => k.toLowerCase() === language.toLowerCase());
  const translated = translations[key] ?? (isSimplifiedChinese(language)
    ? translations["zh-CN"] ?? translations["zh-Hans"] ?? translations.zh
    : /^zh/i.test(language) ? undefined : translations[language.split("-")[0]]);
  return {
    title: translated?.title ?? program.title,
    note: translated?.note ?? program.note,
    facts: program.facts.map((f, i) => ({...f, text: translated?.facts?.[i] ?? f.text})),
  };
}

/** Prepared programmes are queued explicitly, never started by preparation. */
const collectionLabels = {
  "contemporary-pairings": ["Elsewhere", "别处"],
  "first-light": ["First collection", "首批编选"],
  "focus-library": ["Work & study", "工作与学习"],
};
const styles = {
  ambient: ["Ambient", "氛围"], piano: ["Piano", "钢琴"], acoustic: ["Acoustic", "原声器乐"],
  jazz: ["Jazz", "爵士"], electronic: ["Electronic", "电子"], beats: ["Beats", "节拍"], game: ["Game scores", "游戏配乐"],
};
const isSelected = p => p.provider === "editorial" && Object.hasOwn(collectionLabels,p.collection);
const collectionRank = p => !isSelected(p) ? 3 : p.collection === "contemporary-pairings" ? 0 : p.collection === "first-light" ? 1 : 2;

export function programShelf({api, language, status, editions = {}}) {
  const container = document.querySelector("#prepared-programs");
  const list = document.querySelector("#program-list");
  const queue = document.querySelector("#program-queue");
  const title = document.querySelector("#program-heading");
  const zh = () => isSimplifiedChinese(language());
  let queued = null;
  let queuedProgram = null;
  let queueVersion = 0;
  let queueBusy = false;
  let lastLanguage = language();
  let loading = false;
  let programs = [];
  const translatedPrograms = new Set();
  const el = (tag,text) => {
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const search = el("input");
  search.type="search"; search.id="program-search";
  const style = el("select"); style.id="program-style";
  for(const slug of ["",...Object.keys(styles)]) {
    const option=el("option"); option.value=slug; style.append(option);
  }
  const controls=el("div"); controls.className="program-controls"; controls.append(style,search);
  const count = el("p"); count.id="program-count"; count.setAttribute("role","status");
  const clear=el("button"); clear.type="button"; clear.id="program-clear"; clear.hidden=true;
  clear.onclick=()=>{style.value="";search.value="";renderList();search.focus()};
  const results=el("div"); results.className="program-results";results.append(count,clear);
  list.before(controls,results);
  search.oninput=renderList;
  style.onchange=renderList;
  function renderList() {
    const opened = new Set([...list.querySelectorAll(":scope > details[open]")].map(n=>n.dataset.program));
    const term=search.value.trim().toLocaleLowerCase();
    const visible=programs.filter(p=>(!style.value || p.style===style.value) &&
      [programText(p,language()).title,p.title,p.originalTitle,...p.tags,...(collectionLabels[p.collection] ?? [])].join(" ").toLocaleLowerCase().includes(term));
    style.setAttribute("aria-label",zh()?"声音风格":"Sound style");
    for(const option of style.options) option.textContent=option.value ? styles[option.value][zh()?1:0] : (zh()?"全部风格":"All styles");
    clear.textContent=zh()?"清除":"Clear";clear.hidden=!style.value && !term;
    search.placeholder=zh()?"查找节目":"Find a programme";
    search.setAttribute("aria-label",search.placeholder);
    count.textContent=style.value || term
      ? (zh()?`${visible.length} / ${programs.length} 个节目`:`${visible.length} of ${programs.length} programmes`)
      : (zh()?`${visible.length} 个节目`:`${visible.length} programmes`);
    list.replaceChildren();
    if(!visible.length)list.append(el("p",zh()?"换个风格或关键词试试。":"Try another style or search."));
    let lastGroup = null;
    let thumbnailIndex = 0;
    for(const p of visible) {
      const group=isSelected(p) ? p.collection : "other";
      if(group !== lastGroup && programs.some(p=>isSelected(p))) {
        const heading=el("h3",collectionLabels[group]?.[zh()?1:0] ?? (zh()?"其他节目":"More programmes"));
        heading.className="program-group"; list.append(heading); lastGroup=group;
      }
      const translated=programText(p,language());
      const display=translatedPrograms.has(p.id) ? translated : {title:p.title,note:p.note,facts:p.facts};
      const row=el("details"); row.dataset.program=p.id; row.open=opened.has(p.id);
      const summary=el("summary"); summary.className="program-summary";
      if(p.media.kind === "edition") {
        const workId=p.media.edition.split("@")[0];
        const work=editions[workId];
        if(work) {
          const thumbnail=el("img");
          thumbnail.src=work.image ?? "/"+workId+".jpg";
          // Paint the visible row together with its image; async decoding can leave a
          // loaded thumbnail blank during details expansion and list reconstruction.
          thumbnail.alt=""; thumbnail.loading=thumbnailIndex++ < 4 ? "eager" : "lazy";
          thumbnail.decoding="sync";
          thumbnail.width=64; thumbnail.height=56;
          summary.append(thumbnail); summary.classList.add("has-art");
        }
      }
      summary.append(el("span",display.title));
      row.append(summary);
      if(!translatedPrograms.has(p.id) && p.originalTitle !== display.title) {
        const original=el("p",p.originalTitle);
        row.append(original);
      }
      if(translated.title !== p.title || translated.note !== p.note || translated.facts.some((f,i)=>f.text!==p.facts[i].text)) {
        const toggle=el("button",translatedPrograms.has(p.id) ? (zh()?"原文":"Original") : (zh()?"译文":"Translation"));
        toggle.type="button"; toggle.className="program-language";
        toggle.onclick=()=>{translatedPrograms.has(p.id)?translatedPrograms.delete(p.id):translatedPrograms.add(p.id);renderList();
          list.querySelector(`[data-program="${p.id}"] .program-language`)?.focus()};
        row.append(toggle);
      }
      for(const fact of display.facts) {
        const text=el("p",fact.text);
        const link=el("a",zh()?"出处":"Source");
        link.href=fact.source;link.target="_blank";link.rel="noopener noreferrer";
        text.append(" ",link);row.append(text);
      }
      if(display.note) {
        const note=el("details"); note.className="program-editorial";
        note.append(el("summary",zh()?"编选理由":"Why this pairing"),el("p",display.note));
        if(p.curator)note.append(el("p",p.curator));
        row.append(note);
      }
      const button=el("button",queued===p.id ? (zh()?"已排入下一钟":"Queued next") : (zh()?"下一钟听":"Next Pomodoro"));
      button.type="button"; button.disabled=queueBusy || queued===p.id;
      button.onclick=()=>changeQueue(p.id);
      row.append(button);list.append(row);
    }
  }
  async function refresh() {
    if(loading) return;
    loading=true;
    const version=queueVersion;
    try {
      const result=await api("/api/programs",undefined,"GET");
      programs=[...result.programs].sort((a,b)=>collectionRank(a)-collectionRank(b));
      // A delayed read must not undo a newer selection, cancellation or server event.
      if(version===queueVersion && !queueBusy) {
        queued=result.queuedId;
        queuedProgram=programs.find(p=>p.id===queued) ?? null;
      }
      const selected=programs.filter(p=>isSelected(p)).length;
      title.textContent=selected ? (zh()?`编选 · ${selected}`:`Selections · ${selected}`) : (zh()?"节目":"Programmes");
      renderList(); showQueue(queuedProgram);
    } catch(error){status(error.message)}
    finally {loading=false}
  }
  async function changeQueue(id) {
    if(queueBusy)return;
    queueBusy=true;
    const version=++queueVersion;
    renderList(); showQueue(queuedProgram);
    try {
      const result=await api("/api/programs/select",{id});
      // A newer SSE event may already have consumed or replaced this queue entry.
      if(queueVersion===version) {
        queued=result.queuedId;
        queuedProgram=programs.find(p=>p.id===queued) ?? null;
        queueVersion++;
      }
    } catch(error){status(error.message)}
    finally {queueBusy=false;renderList();showQueue(queuedProgram)}
  }
  function showQueue(program) {
    queue.replaceChildren();
    if(!program)return;
    queue.append(el("span",(zh()?"下一钟 · ":"Next · ")+programText(program,language()).title));
    const cancel=el("button",zh()?"取消":"Cancel");
    cancel.type="button"; cancel.disabled=queueBusy;
    cancel.onclick=()=>changeQueue(null);
    queue.append(cancel);
  }
  container.addEventListener("toggle",()=>{if(container.open)void refresh()});
  return (state)=>{
    // Even an unchanged null queue can mean the server already consumed a pending selection.
    queueVersion++;
    const currentLanguage=language();
    const languageChanged=currentLanguage!==lastLanguage;
    lastLanguage=currentLanguage;
    const selected=programs.filter(p=>isSelected(p)).length;
    title.textContent=selected ? (zh()?`编选 · ${selected}`:`Selections · ${selected}`) : (zh()?"节目":"Programmes");
    const id=state.nextProgram?.id ?? null;
    if(id!==queued || languageChanged){
      queued=id; queuedProgram=state.nextProgram ?? null; showQueue(queuedProgram);
      if(container.open)renderList();
    }
  };
}
