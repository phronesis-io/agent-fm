import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import works from "../web/editions.json" with { type: "json" };
import { structuredCodex } from "./listening.ts";
import { labelTranslationPrompt } from "./prompts.ts";

type Work = {
  art: string;
  museumTitle?: string;
  originalTitle?: string;
  culture?: string;
  collection?: string;
  date?: string;
  museumExcerpt?: string;
  source?: string;
  museum?: number;
};
const catalogue: Record<string, Work> = works;
/** Source-language label fields as the museum publishes them. */
export function sourceLabel(id: string) {
  const w = catalogue[id];
  if (!w) throw Error("未知作品");
  // Met entries carry an editorial Chinese art name; its museum title is the source.
  const title = w.museumTitle ?? w.art;
  const fields: Record<string, string> = { title };
  if (w.culture) fields.culture = w.culture;
  if (w.collection) fields.collection = w.collection;
  if (w.museumExcerpt) fields.excerpt = w.museumExcerpt;
  return { language: "en", fields };
}
const pending = new Map<string, Promise<Record<string, string>>>();
function cachePath(dir: string, id: string, lang: string) {
  const version = createHash("sha256")
    .update(JSON.stringify([id, sourceLabel(id), "label-v2"]))
    .digest("hex")
    .slice(0, 16);
  return join(dir, "translations", `label-${version}-${lang}.json`);
}
export function canonicalLanguage(requested: unknown) {
  if (typeof requested !== "string" || requested.length > 40)
    throw Error("无效语言");
  const [lang] = Intl.getCanonicalLocales(requested);
  if (!lang) throw Error("无效语言");
  return lang;
}
/** Cached translation or null. Never calls a model. */
export async function cachedLabel(dir: string, id: string, lang: string) {
  try {
    return JSON.parse(await readFile(cachePath(dir, id, lang), "utf8")) as Record<string, string>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
/**
 * Translate museum label fields with the user's Codex. Only called after an
 * explicit click; the caller reserves budget first.
 */
export async function translateLabel(
  dir: string,
  id: string,
  lang: string,
  choose = structuredCodex,
) {
  const path = cachePath(dir, id, lang);
  const existing = pending.get(path);
  if (existing) return existing;
  const { fields } = sourceLabel(id);
  const keys = Object.keys(fields);
  const work = (async () => {
    const text = await choose(
      labelTranslationPrompt(lang, fields),
      {
        type: "object",
        properties: Object.fromEntries(keys.map((k) => [k, { type: "string", maxLength: 1200 }])),
        required: keys,
        additionalProperties: false,
      },
    );
    if (!keys.every((k) => typeof text[k] === "string" && text[k].trim()))
      throw Error("译文不完整");
    const result = Object.fromEntries(keys.map((k) => [k, text[k].trim()]));
    await mkdir(join(dir, "translations"), { recursive: true, mode: 0o700 });
    await writeFile(path + ".tmp", JSON.stringify(result), { mode: 0o600 });
    await rename(path + ".tmp", path);
    return result;
  })().finally(() => pending.delete(path));
  pending.set(path, work);
  return work;
}
