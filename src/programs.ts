import art from "../web/editions.json" with { type: "json" };
import sounds from "../web/sounds.json" with { type: "json" };
import seeds from "../web/programs.json" with { type: "json" };
import type { State } from "./types.ts";
import type { Store } from "./store.ts";
import { radioVideo } from "./radio.ts";

export const programStyles = ["ambient","piano","acoustic","jazz","electronic","beats","game"] as const;
export type ProgramDraft = {
  id: string;
  title: string;
  originalTitle: string;
  language: string;
  tags: string[];
  facts: { text: string; source: string }[];
  note: string;
  style?: (typeof programStyles)[number];
  revision?: number;
  curator?: string;
  collection?: string;
  translations?: Record<string, {title:string; facts:string[]; note:string}>;
  media: {kind:"youtube"; url:string; loop?:boolean} | {kind:"edition"; edition:string};
};
export type Program = ProgramDraft & {
  preparedAt: number;
  provider: "editorial" | "agent";
  playback?: { id: string; title: string };
};
export const programSchema = {
  id: "1–80 letters, digits, dots, underscores or hyphens; immutable",
  title: "display title, 1–160 characters",
  originalTitle: "source-language title, 1–240 characters",
  language: "BCP-47 language code for the supplied text",
  tags: "1–8 culture, era or medium labels",
  facts: "1–8 {text, source} items; source is an HTTPS reference",
  note: "editorial interpretation, at most 600 characters",
  style: "optional primary listening style: ambient, piano, acoustic, jazz, electronic, beats, game",
  revision: "optional positive integer; immutable programme revision",
  curator: "optional editor attribution, not a verification badge",
  collection: "optional collection ID",
  translations: "optional BCP-47 keyed {title,facts:string[],note}; facts align with original sources",
  media: "either {kind:youtube,url:YouTube URL,loop?:boolean} or {kind:edition,edition:art@sound}",
};
function short(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error("Invalid program " + name);
  return value.trim();
}
function source(value: unknown) {
  const text = short(value, "source", 1000);
  const u = new URL(text);
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("Program sources must be HTTPS links");
  return u.href;
}
export function normalizeProgram(input: unknown): ProgramDraft {
  if (!input || typeof input !== "object") throw Error("Expected a program object");
  const p = input as Record<string, any>;
  const id = short(p.id,"id",80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) throw Error("Invalid program id");
  const language = Intl.getCanonicalLocales(short(p.language,"language",50))[0];
  if (!Array.isArray(p.tags) || !p.tags.length || p.tags.length > 8) throw Error("Expected 1–8 tags");
  if (!Array.isArray(p.facts) || !p.facts.length || p.facts.length > 8) throw Error("Expected 1–8 sourced facts");
  const facts = p.facts.map((f: any) => ({text:short(f?.text,"fact",800),source:source(f?.source)}));
  let media: ProgramDraft["media"];
  if (p.media?.kind === "edition") {
    const edition = short(p.media.edition,"edition",180);
    const [work,sound,...extra] = edition.split("@");
    if (extra.length || !Object.hasOwn(art,work) || !sound || !Object.hasOwn(sounds,sound))
      throw Error("Unknown artwork or sound");
    media = {kind:"edition",edition};
  } else if (p.media?.kind === "youtube") {
    const url = source(p.media.url);
    const u = new URL(url);
    if (!["youtube.com","www.youtube.com","m.youtube.com","youtu.be"].includes(u.hostname))
      throw Error("Use a YouTube video or channel URL");
    if (p.media.loop !== undefined && typeof p.media.loop !== "boolean") throw Error("loop must be boolean");
    media = {kind:"youtube",url,...(p.media.loop ? {loop:true} : {})};
  } else throw Error("Unsupported program media");
  const metadata: Pick<ProgramDraft,"revision"|"curator"|"collection"|"translations"|"style"> = {};
  if(p.style !== undefined) {
    if(!programStyles.includes(p.style)) throw Error("Unknown programme style");
    metadata.style=p.style;
  }
  if (p.revision !== undefined) {
    if (!Number.isSafeInteger(p.revision) || p.revision < 1) throw Error("Invalid program revision");
    metadata.revision=p.revision;
  }
  if(p.curator !== undefined) metadata.curator=short(p.curator,"curator",160);
  if(p.collection !== undefined) metadata.collection=short(p.collection,"collection",80);
  if(p.translations !== undefined) {
    if(!p.translations || typeof p.translations !== "object" || Array.isArray(p.translations) || Object.keys(p.translations).length>20)
      throw Error("Invalid program translations");
    metadata.translations={};
    for(const [locale,value] of Object.entries(p.translations)) {
      const key=Intl.getCanonicalLocales(locale)[0];
      const t=value as Record<string,unknown>;
      if(!t || !Array.isArray(t.facts) || t.facts.length!==facts.length) throw Error("Translation facts must match original sources");
      if(Object.hasOwn(metadata.translations,key)) throw Error("Duplicate translation language");
      metadata.translations[key]={title:short(t.title,"translated title",160),facts:t.facts.map(f=>short(f,"translated fact",800)),note:short(t.note,"translated note",600)};
    }
  }
  return {...metadata,id,title:short(p.title,"title",160),originalTitle:short(p.originalTitle,"originalTitle",240),
    language,tags:[...new Set(p.tags.map((t:unknown)=>short(t,"tag",60)))],
    facts,note:short(p.note,"note",600),media};
}
export function listPrograms(s: State): Program[] {
  const builtins = seeds.map(p=>({...p,provider:"editorial",preparedAt:0})) as Program[];
  return [...builtins,...(s.programs ?? [])];
}
export function findProgram(s: State, id: string) {
  const p = listPrograms(s).find(p=>p.id === id);
  if (!p) throw Error("Unknown program");
  return p;
}
export async function validateProgram(input: unknown, resolve = radioVideo) {
  const program = normalizeProgram(input);
  const playback = program.media.kind === "youtube" ? await resolve(program.media.url) : undefined;
  return { program, playback, checks: {structure:true,mediaReference:true,factsVerified:false},
    notice:"References supplied; factual accuracy and actual player availability require review."};
}
export async function programCommand(store: Store, action: string, body: any = {}, resolve = radioVideo) {
  if (action === "list") {
    const s = store.read();
    return {programs:listPrograms(s),queuedId:s.nextProgram ?? null};
  }
  if (action === "select") {
    if (body.id === null) {
      store.update(s=>{delete s.nextProgram});
      return {queuedId:null};
    }
    const id = short(body.id,"id",80);
    store.update(s=>{findProgram(s,id);s.nextProgram=id;delete s.nextListeningEdition});
    return {queuedId:id,applies:"next-pomodoro"};
  }
  if (!["prepare","validate"].includes(action)) throw Error("Unknown program command");
  const program = normalizeProgram(body.program);
  const existing = listPrograms(store.read()).find(p=>p.id===program.id);
  if (existing && JSON.stringify(normalizeProgram(existing)) !== JSON.stringify(program))
    throw Error("Program id already holds different content; use a new id");
  if (!existing && ["first-light","focus-library","contemporary-pairings"].includes(program.collection ?? ""))
    throw Error("This collection is reserved for bundled editorial programmes");
  if (action==="prepare" && existing) return {program:existing,reused:true};
  const epoch = store.read().settings.epoch;
  const checked = await validateProgram(program,resolve);
  if (action==="validate") return checked;
  const prepared:Program = {...program,playback:checked.playback,provider:"agent",preparedAt:Date.now()};
  return store.update(s=>{
    if (s.settings.epoch !== epoch) throw Error("FM state changed during preparation; retry explicitly");
    // The network lookup above can overlap another preparation.
    const raced = listPrograms(s).find(p=>p.id===program.id);
    if (raced) {
      if (JSON.stringify(normalizeProgram(raced))!==JSON.stringify(program))
        throw Error("Program id already holds different content; use a new id");
      return {program:raced,reused:true};
    }
    s.programs ??= [];
    if(s.programs.length>=500) throw Error("Program library is full");
    s.programs.push(prepared);
    return {program:prepared,reused:false};
  });
}
