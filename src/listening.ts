import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rm,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codexBinary, configOverrides } from "./codex.ts";
import { listeningTranslationPrompt } from "./prompts.ts";
import lessons from "../web/listening/ten.json" with { type: "json" };
import facts from "../web/listening/facts.json" with { type: "json" };
const active = new Map<string, Promise<Record<string, string>>>();
const keys = [
  "title",
  "fact",
  "pair",
  "heading",
  "aside",
  "gloss",
  "factLabel",
  "pairLabel",
  "asideLabel",
  "chatLabel",
  "sourceLabel",
  "audioLabel",
];
const schema = {
  type: "object",
  properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
  required: keys,
  additionalProperties: false,
};
export async function listeningText(
  dir: string,
  index: number,
  requested: string,
  connected: boolean,
  onModelCall: () => void = () => {},
) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= lessons.length ||
    typeof requested !== "string" ||
    requested.length > 40
  )
    throw Error("Invalid reading request");
  const [lang] = Intl.getCanonicalLocales(requested);
  if (!lang) throw Error("Invalid language");
  const n = lessons[index];
  const artwork = facts[n.art as keyof typeof facts];
  const base = {
    title: artwork.title,
    fact: artwork.fact,
    ...n.text,
    gloss: n.extra?.zh ?? "",
    factLabel: "这件作品从哪来？",
    pairLabel: "为什么配这段声音？",
    asideLabel: "旁注",
    chatLabel: "和 Codex 聊",
    sourceLabel: "馆藏原页",
    audioLabel: "录音出处",
  };
  if (/^zh(?:-Hans|-CN|-SG|$)/i.test(lang)) return base;
  const version = createHash("sha256")
    .update(JSON.stringify([n, base, "v2"]))
    .digest("hex")
    .slice(0, 16);
  const cache = join(dir, "translations");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const path = join(cache, version + "-" + lang + ".json");
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (!connected) throw Error("Codex offline");
  const existing = active.get(path);
  if (existing) return existing;
  if (active.size >= 2) throw Error("Translation busy; retry.");
  onModelCall();
  const work = translate(lang, base, artwork.original, n.extra?.original ?? "")
    .then(async (text) => {
      const temp = path + ".tmp";
      await writeFile(temp, JSON.stringify(text), { mode: 0o600 });
      await rename(temp, path);
      return text;
    })
    .finally(() => active.delete(path));
  active.set(path, work);
  return work;
}
async function translate(
  lang: string,
  base: Record<string, string>,
  original: string,
  quotation: string,
) {
  const prompt = listeningTranslationPrompt(lang, { base, original, quotation });
  const text = await structuredCodex(prompt, schema);
  if (
    !keys.every(
      (k) =>
        typeof text[k] === "string" &&
        text[k].length <= 4000 &&
        (k === "gloss" || text[k].trim()),
    )
  )
    throw Error("Incomplete translation");
  return Object.fromEntries(keys.map((k) => [k, text[k]]));
}
export async function structuredCodex(
  prompt: string,
  schema: unknown,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "fm-editor-"));
  try {
    const shape = join(dir, "shape.json"),
      output = join(dir, "translation.json");
    await writeFile(shape, JSON.stringify(schema));
    await new Promise<void>((ok, fail) => {
      const child = execFile(
        codexBinary(),
        [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          ...configOverrides().flatMap((c) => ["-c", c]),
          "--output-schema",
          shape,
          "-o",
          output,
          "-",
        ],
        { signal, cwd: dir, timeout: 100000, maxBuffer: 512 * 1024 },
        (err) => (err ? fail(Error("Codex unavailable")) : ok()),
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(prompt);
    });
    const text = JSON.parse(await readFile(output, "utf8")) as Record<
      string,
      string
    >;
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
