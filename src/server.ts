import { programCommand } from "./programs.ts";
import { agentRequest } from "./agent-interface.ts";
import { completionReminder, macReminder } from "./reminder.ts";
import { radioVideo } from "./radio.ts";
import { makeCurator } from "./curation.ts";
import listeningCards from "../web/listening/ten.json" with { type: "json" };
import { listeningText } from "./listening.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import art from "../web/editions.json" with { type: "json" };
import sounds from "../web/sounds.json" with { type: "json" };
import { Store } from "./store.ts";
import { Engine } from "./engine.ts";
import {
  current,
  enqueue,
  event,
  publicState,
  removeSession,
  nextEdition,
  keep,
  timer,
} from "./domain.ts";
import { localDay, record, settle, spend } from "./budget.ts";
import { cachedLabel, canonicalLanguage, sourceLabel, translateLabel } from "./label.ts";
import { metrics } from "./metrics.ts";
const catalogueFiles = new Set<string>([
  "/sounds.json",
  ...Object.keys(sounds).map((key) => "/" + key + ".mp3"),
  ...Object.values(art).flatMap((entry) =>
    "image" in entry ? [String(entry.image)] : [],
  ),
]);
const token = () => randomBytes(32).toString("hex");
function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Error("请求过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
export async function serve(
  dataDir: string,
  webDir: string,
  options: { engine?: Engine; port?: number; connect?: boolean } = {},
) {
  const store =
    options.engine?.store ?? new Store(join(dataDir, "space.sqlite"));
  const engine = options.engine ?? new Engine(store);
  const curator = makeCurator(store);
  const secretPath = join(dataDir, "control.secret");
  if (!existsSync(secretPath))
    writeFileSync(secretPath, token(), { mode: 0o600 });
  const control = readFileSync(secretPath, "utf8");
  const browserProof = () =>
    createHmac("sha256", control)
      .update("fm-browser-v1:" + origin)
      .digest("hex");
  const pairings = new Map<string, number>();
  const cookies = new Set<string>();
  const streams = new Set<ServerResponse>();
  let origin = "";
  let lastError = "";
  let closing = false;
  const remind = completionReminder(store.read().events, options.connect === false ? () => {} : () => macReminder(store.read().settings.language));
  const publish = () => {
    remind(store.read().events);
    const frame = `event: state\ndata: ${JSON.stringify({ ...engine.view(), connectionError: lastError })}\n\n`;
    for (const res of streams) res.write(frame);
  };
  engine.on("change", publish);
  engine.on("connection-error", (e) => {
    lastError = e;
    publish();
  });
  function respond(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  }
  function issueLink() {
    for (const [k, t] of pairings) if (t < Date.now()) pairings.delete(k);
    const key = token();
    pairings.set(key, Date.now() + 60000);
    return `${origin}/#pair=${key}`;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (req.headers.host !== new URL(origin).host)
      return respond(res, 403, { error: "请求来源不受支持" });
    if (req.headers.origin && req.headers.origin !== origin)
      return respond(res, 403, { error: "请求来源不受支持" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return respond(res, 403, { error: "不接受跨站请求" });
    const path = new URL(req.url ?? "/", origin).pathname;
    const auth =
      typeof req.headers.authorization === "string" &&
      equal(req.headers.authorization, `Bearer ${control}`);
    const session = (req.headers.cookie ?? "")
      .split("; ")
      .find((x) => x.startsWith("fm_session="))
      ?.slice(11);
    const browser = !!session && cookies.has(session);
    try {
      if (
        ["/api/pair", "/api/browser-resume"].includes(path) &&
        req.method === "POST"
      ) {
        if (req.headers.origin !== origin) throw Error("请从本机页面连接");
        const b = await body(req);
        const pairing = path === "/api/pair";
        if (pairing) {
          const expires = pairings.get(b.key);
          pairings.delete(b.key);
          if (!expires || expires < Date.now())
            return respond(res, 401, { error: "连接已过期，请重新打开空间" });
        } else if (
          typeof b.proof !== "string" ||
          !/^[0-9a-f]{64}$/.test(b.proof) ||
          !equal(b.proof, browserProof())
        ) {
          return respond(res, 401, {
            error: "请在 Codex 中打开 Agent FM 重新配对",
          });
        }
        const key = token();
        cookies.add(key);
        res.setHeader(
          "Set-Cookie",
          `fm_session=${key}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return respond(
          res,
          200,
          pairing ? { ok: true, proof: browserProof() } : { ok: true },
        );
      }
      if (path.startsWith("/api/") && !auth && !browser)
        return respond(res, 401, { error: "请通过安装器重新打开空间" });
      if (
        path.startsWith("/api/") &&
        req.method !== "GET" &&
        !auth &&
        req.headers.origin !== origin
      )
        return respond(res, 403, { error: "需要同源请求" });
      if (path === "/api/radio" && req.method === "POST")
        return respond(res, 200, await radioVideo((await body(req)).url));
      if (path === "/api/listening-language" && req.method === "POST") {
        const b = await body(req);
        const generate = store.read().settings.connected && b.generate === true;
        let called = false;
        try {
          const text = await listeningText(dataDir, b.index, b.language, generate, () => {
            called = true;
          });
          if (called) store.update((s) => record(s, "translate", "完成"));
          return respond(res, 200, text);
        } catch (e) {
          if (called) store.update((s) => record(s, "translate", "失败"));
          throw e;
        }
      }
      if (path === "/api/label" && req.method === "POST") {
        const b = await body(req);
        const lang = canonicalLanguage(b.language);
        if (typeof b.id !== "string") throw Error("未知作品");
        const source = sourceLabel(b.id);
        const cached = await cachedLabel(dataDir, b.id, lang);
        if (cached || b.translate !== true)
          return respond(res, 200, { source, translation: cached, language: lang });
        // An explicit click: the user's own Codex translates, within today's budget.
        const ticket = store.update((s) => {
          if (!s.settings.connected) throw Error("Codex 已断开，无法翻译");
          if (!spend(s, "translate")) throw Error("今天的翻译额度已用完，明天再试");
          return record(s, "translate", "进行中");
        });
        engine.changed();
        try {
          const translation = await translateLabel(dataDir, b.id, lang);
          store.update((s) => settle(s, ticket, "完成"));
          engine.changed();
          return respond(res, 200, { source, translation, language: lang });
        } catch (e) {
          store.update((s) => settle(s, ticket, "失败"));
          engine.changed();
          throw e;
        }
      }
      if (path === "/api/metrics" && req.method === "GET")
        return respond(res, 200, metrics(store.read()));
      if (path === "/api/keep" && req.method === "POST") {
        const edition = store.update((s) => keep(s));
        engine.changed();
        return respond(res, 200, { edition });
      }
      if (path === "/api/state" && req.method === "GET")
        return respond(res, 200, {
          ...engine.view(),
          connectionError: lastError,
        });
      if (path === "/api/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
        });
        streams.add(res);
        req.on("close", () => streams.delete(res));
        publish();
        return;
      }
      if (path === "/api/export" && req.method === "GET") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="agent-fm-export.json"',
        );
        return respond(res, 200, publicState(store.read()));
      }
      if (path === "/api/open" && req.method === "POST" && auth)
        return respond(res, 200, { url: issueLink() });
      if (path === "/api/stop" && req.method === "POST" && auth) {
        respond(res, 200, { ok: true });
        setTimeout(() => void stop(), 30);
        return;
      }
      if (path === "/api/programs" && req.method === "GET")
        return respond(res, 200, await programCommand(store, "list"));
      if (["/api/programs/validate", "/api/programs/prepare", "/api/programs/select"].includes(path) && req.method === "POST") {
        const result = await programCommand(store, path.split("/").at(-1)!, await body(req));
        engine.changed();
        return respond(res, 200, result);
      }
      if (path === "/api/agent" && req.method === "POST" && auth) {
        const result = agentRequest(store, await body(req));
        engine.changed();
        return respond(res, 200, result);
      }
      if (path === "/api/messages" && req.method === "POST") {
        const b = await body(req);
        if (
          typeof b.id !== "string" ||
          !/^[a-zA-Z0-9-]{8,80}$/.test(b.id) ||
          typeof b.text !== "string"
        )
          throw Error("无效消息");
        const r = store.update((s) => enqueue(s, b.id, b.text));
        respond(res, 202, { id: r.id, status: r.status });
        engine.changed();
        return;
      }
      if (path === "/api/heartbeat" && req.method === "POST") {
        const b = await body(req);
        if (b.visible === true) {
          engine.lastVisible = Date.now();
          const day = localDay();
          if (!store.read().openDays?.includes(day))
            store.update((s) => {
              s.openDays ??= [];
              if (!s.openDays.includes(day)) s.openDays.push(day);
              if (s.openDays.length > 400) s.openDays.shift();
            });
          if (engine.online && !engine.active)
            void curator.prepare().catch(() => {});
        }
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/next-edition" && req.method === "POST") {
        store.update(nextEdition);
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/queue-listening" && req.method === "POST" && auth) {
        const b = await body(req);
        if (
          !Number.isInteger(b.index) ||
          b.index < 0 ||
          b.index >= listeningCards.length
        )
          throw Error("未知手记");
        const card = listeningCards[b.index];
        const edition = card.art + "@" + card.sound;
        store.update((s) => {
          s.nextListeningEdition = edition;
          delete s.nextProgram;
        });
        engine.changed();
        return respond(res, 200, { edition });
      }
      if (path === "/api/timer" && req.method === "POST") {
        const b = await body(req);
        store.update((s) => timer(s, b.action, b.minutes ?? 25));
        engine.clockUncertain = false;
        engine.lastTick = Date.now();
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/settings" && req.method === "POST") {
        const b = await body(req);
        store.update((s) => {
          if (b.version !== s.settings.version)
            throw Error("设置已变化，请重试");
          for (const key of [
            "present",
            "connected",
            "curateNext",
            "dayClose",
            "completionCompanion",
          ] as const)
            if (typeof b[key] === "boolean") s.settings[key] = b[key];
          if (b.language !== undefined) s.settings.language = b.language === "auto" ? "auto" : canonicalLanguage(b.language);
          if (b.visualLibrary !== undefined) {
            if (!["contemporary", "museum", "all"].includes(b.visualLibrary)) throw Error("Unknown visual library");
            s.settings.visualLibrary = b.visualLibrary;
          }
          if (b.theme !== undefined) {
            if (!["lake", "night"].includes(b.theme)) throw Error("未知场景");
            s.settings.theme = b.theme;
          }
          s.settings.version++;
          delete s.curatorPick;
          if (b.connected === false) {
            s.settings.epoch++;
            for (const r of s.runs)
              if (r.status === "queued") r.status = "interrupted";
          }
        });
        if (b.curateNext === false || b.connected === false) curator.cancel();
        const r = store.read().runs.find((x) => x.id === engine.active);
        if (
          b.connected === false ||
          (b.dayClose === false && r?.source === "dayclose") ||
          (b.completionCompanion === false && r?.source === "completion")
        )
          void engine.interrupt();
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/cancel" && req.method === "POST") {
        await engine.interrupt();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/record" && req.method === "POST") {
        const b = await body(req);
        if (
          !["source-open", "favorite-source", "play", "pause", "source-selected"].includes(
            b.kind,
          ) ||
          typeof b.detail !== "string" ||
          b.detail.length > 1000
        )
          throw Error("无效记录");
        store.update((s) => {
          const t = current(s);
          if (b.kind === "source-selected") delete t.programId;
          event(s, t.id, b.kind, b.detail);
        });
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/notes" && req.method === "POST" && auth) {
        const b = await body(req);
        if (
          typeof b.text !== "string" ||
          !b.text.trim() ||
          b.text.length > 2000
        )
          throw Error("留言须为 1 到 2000 字");
        store.update((s) => {
          if (!s.settings.connected) throw Error("Agent 已断开");
          s.notes.push({
            id: randomUUID(),
            sessionId: current(s).id,
            text: b.text,
            created: Date.now(),
            source: "原 Agent 明确交接",
            favorite: false,
          });
        });
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/note" && req.method === "POST") {
        const b = await body(req);
        store.update((s) => {
          if (b.action === "delete") {
            if (typeof b.id !== "string") throw Error("无效留言");
            s.deletedNoteIds ??= [];
            s.deletedNoteIds.push(b.id);
            s.notes = s.notes.filter((x) => x.id !== b.id);
          } else {
            const n = s.notes.find((x) => x.id === b.id);
            if (!n) throw Error("留言不存在");
            n.favorite = !n.favorite;
          }
        });
        store.purge();
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/records" && req.method === "DELETE") {
        const b = await body(req);
        if (b.confirm !== "clear-all") throw Error("需要确认清空记录");
        if (engine.active)
          return respond(res, 409, { error: "请在当前回复结束后再清空。" });
        store.update((s) => {
          delete s.curatorPick;
          delete s.rotation;
          delete s.nextListeningEdition;
          s.sessions = [];
          s.programs = [];
          delete s.nextProgram;
          s.events = [];
          s.runs = [];
          s.notes = [];
          s.candidates = [];
          s.deletedNoteIds = [];
          s.ledger = [];
          s.openDays = [];
          s.settings.epoch++;
        });
        store.purge();
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/session" && req.method === "DELETE") {
        const b = await body(req);
        const r = store.read().runs.find((x) => x.id === engine.active);
        store.update((s) => removeSession(s, b.id));
        store.purge();
        if (r?.sessionId === b.id) void engine.interrupt();
        engine.changed();
        return respond(res, 200, { ok: true });
      }
      if (path === "/api/reconnect" && req.method === "POST") {
        if (engine.online) return respond(res, 200, { ok: true });
        throw Error(
          "请通过 agent-fm stop 后 start 重建连接；已保存的会话不会重置。",
        );
      }
      if (
        req.method === "GET" &&
        (catalogueFiles.has(path) ||
          [
            "/",
            "/app.js",
            "/i18n.js",
            "/programs.js",
            "/listening.html",
            "/listening.js",
            "/listening.css",
            "/listening/ten.json",
            "/listening/facts.json",
            "/listening/en.json",
            "/listening/ko.json",
            "/style.css",
            "/lake.svg",
            "/field.jpg",
            "/wave.js",
            "/arabesque.mp3",
            "/arabesque2.mp3",
            "/delphes.mp3",
            "/reading.mp3",
            "/drift.mp3",
            "/reading.jpg",
            "/drift.jpg",
            "/roses.jpg",
            "/irises.jpg",
            "/editions.json",
          ].includes(path))
      ) {
        const file = join(webDir, path === "/" ? "index.html" : path.slice(1));
        res.setHeader(
          "Content-Type",
          (
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".png": "image/png",
              ".webp": "image/webp",
              ".mp3": "audio/mpeg",
              ".json": "application/json",
            } as Record<string, string>
          )[extname(file)],
        );
        res.end(readFileSync(file));
        return;
      }
      respond(res, 404, { error: "没有这个入口" });
    } catch (e) {
      respond(res, 400, { error: e instanceof Error ? e.message : "操作失败" });
    }
  });
  const portFile = join(dataDir, "port");
  const savedPort = existsSync(portFile)
    ? Number(readFileSync(portFile, "utf8").trim())
    : undefined;
  if (
    savedPort !== undefined &&
    (!Number.isInteger(savedPort) || savedPort < 1 || savedPort > 65535)
  )
    throw Error("Agent FM 保存的端口无效");
  const port = options.port ?? savedPort ?? 0;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    engine.close();
    store.close();
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw Error("Agent FM 端口 " + port + " 已被占用。释放后重试。");
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw Error("无法监听本机");
  origin = `http://127.0.0.1:${address.port}`;
  if (options.port === undefined && savedPort === undefined)
    writeFileSync(portFile, String(address.port), { mode: 0o600, flag: "wx" });
  writeFileSync(
    join(dataDir, "runtime.json"),
    JSON.stringify({ pid: process.pid, origin }),
    { mode: 0o600 },
  );
  const interval = setInterval(() => engine.step(), 1000);
  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(": heartbeat\n\n");
  }, 10000);
  async function stop() {
    if (closing) return;
    closing = true;
    curator.close();
    clearInterval(interval);
    clearInterval(heartbeat);
    engine.close();
    for (const res of streams) res.end();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    try {
      unlinkSync(join(dataDir, "runtime.json"));
    } catch {}
  }
  if (options.connect !== false) await engine.connect(dataDir).catch(() => {});
  return { origin, engine, store, stop, issueLink, server };
}
