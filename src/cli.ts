import { capabilities, commands } from "./agent-interface.ts";
import * as autostart from "./autostart.ts";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  cpSync,
  openSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { serve } from "./server.ts";
import { supportedCodex, codexBinary } from "./codex.ts";
const base = dirname(fileURLToPath(import.meta.url));
const data = resolve(
  process.env.AGENT_FM_DATA_DIR || join(homedir(), ".local/share/agent-fm"),
);
mkdirSync(data, { recursive: true, mode: 0o700 });
const command = process.argv[2] || "start";
const commandPath = join(homedir(), ".local/bin/agent-fm");
const ownedCommand = "# Agent FM managed launcher";
function installCommand() {
  if (existsSync(commandPath) && !readFileSync(commandPath,"utf8").includes(ownedCommand))
    throw Error("~/.local/bin/agent-fm 已存在且不属于本安装器");
  mkdirSync(dirname(commandPath),{recursive:true});
  const quote = (s:string) => "'" + s.replaceAll("'", "'\\''") + "'";
  writeFileSync(commandPath, "#!/bin/sh\n" + ownedCommand + "\nexec " + quote(autostart.runtimeNode()) + " " + quote(fileURLToPath(import.meta.url)) + ' "$@"\n', {mode:0o755});
}
async function api(path: string, payload: unknown = {}, method = path === "/api/state" ? "GET" : "POST") {
  const runtime = JSON.parse(readFileSync(join(data, "runtime.json"), "utf8"));
  const secret = readFileSync(join(data, "control.secret"), "utf8");
  const result = await fetch(runtime.origin + path, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(["/api/programs/validate", "/api/programs/prepare"].includes(path) ? 20000 : 3000),
  });
  const body = (await result.json()) as any;
  if (!result.ok) throw Error(body.error);
  return body;
}
async function running() {
  try {
    await api("/api/state");
    return true;
  } catch {
    return false;
  }
}
function check() {
  const node = Number(process.versions.node.split(".")[0]);
  if (node < 24 || node > 25)
    throw Error(
      "需要 Node.js 24 LTS（或已测试的 25）；安装器不改动系统运行时。",
    );
  const version = execFileSync(codexBinary(), ["--version"], {
    encoding: "utf8",
  }).trim();
  if (!supportedCodex.some((v) => version === `codex-cli ${v}`))
    throw Error(
      `当前仅验证 Codex ${supportedCodex}，实际为 ${version}。请先验证适配，不自动升级宿主。`,
    );
  return version;
}
async function start() {
  check();
  if (await running()) return;
  if (autostart.enabled(data)) autostart.launch();
  else {
  const log = openSync(join(data, "bridge.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "serve"],
    { detached: true, stdio: ["ignore", log, log], env: process.env },
  );
  child.unref();
  closeSync(log);
  }
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await running()) return;
  }
  throw Error("启动未就绪；运行 doctor 查看状态。");
}
async function stopBridge() {
  if (autostart.enabled(data)) autostart.unload();
  if (await running()) await api("/api/stop");
  for (let i=0; i<80 && await running(); i++) await new Promise(r=>setTimeout(r,100));
  if (await running()) throw Error("服务仍在停止，请重试");
}
async function main() {
  if (["capabilities", "schema", "--help", "help"].includes(command)) {
    const key = process.argv.slice(3).join(" ") as keyof typeof commands;
    if (command === "schema" && !commands[key]) throw Error("UNKNOWN_COMMAND");
    console.log(JSON.stringify(command === "schema" ? {version:1,...commands[key]} : capabilities(),null,2));
    return;
  }
  if (command === "program") {
    const action=process.argv[3];
    let result;
    if(action === "list") result=await api("/api/programs",{}, "GET");
    else if(action === "select") result=await api("/api/programs/select",{id:process.argv[4]});
    else if(action === "validate" || action === "prepare") {
      const chunks=[];for await (const chunk of process.stdin) chunks.push(chunk);
      const program=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      result=await api("/api/programs/"+action,{program});
    } else throw Error("Use program list / validate / prepare / select <id>");
    console.log(JSON.stringify({version:1,...result},null,2));return;
  }
  if (["context", "events", "invitation", "companion", "language"].includes(command)) {
    const action = process.argv[3];
    let result;
    if (command === "language") {
      const s = await api("/api/state");
      if (action === "set") {
        if (!process.argv[4]) throw Error("INVALID_LANGUAGE: provide a BCP 47 language tag");
        await api("/api/settings", {version:s.settings.version,language:process.argv[4]});
        result = {version:1,language:(await api("/api/state")).settings.language};
      } else if (action === "get") result = {version:1,language:s.settings.language??null};
      else throw Error("Use language get or language set <BCP47>");
    } else {
      let payload: Record<string,unknown> = {command:command+" "+action};
      if (command === "invitation" && action === "create") {
        const chunks=[];for await (const chunk of process.stdin) chunks.push(chunk);
        payload={...JSON.parse(Buffer.concat(chunks).toString("utf8")),command:"invitation create"};
      } else if (command === "invitation") payload.id=process.argv[4];
      if(command === "events" && process.argv[4]) {
        if(process.argv[4]!=="--after"||!process.argv[5])throw Error("Use events read [--after <cursor>]");
        payload.after=process.argv[5];
      }
      result=await api("/api/agent",payload);
    }
    console.log(JSON.stringify(result,null,2));
    return;
  }
  if (command === "autostart") {
    if (process.argv[3] === "disable") {
      autostart.disable(data);
      console.log("登录自动启动已关闭。");
      return;
    }
    if (process.argv[3] !== "enable") throw Error("使用 autostart enable 或 disable");
    check();
    await stopBridge();
    autostart.configure(data, fileURLToPath(import.meta.url));
    await start();
    console.log("登录自动启动已启用。");
    return;
  }
  if (command === "serve") {
    const lockPath = join(data, "bridge.lock");
    if (existsSync(lockPath)) {
      const pid = Number(readFileSync(lockPath, "utf8"));
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {}
      if (alive) throw Error("已有桥接进程持有运行锁");
      unlinkSync(lockPath);
    }
    const lock = openSync(lockPath, "wx", 0o600);
    writeFileSync(lock, String(process.pid));
    closeSync(lock);
    try {
      const service = await serve(data, join(base, "web"));
      let exiting = false;
      const stop = async () => {
        if (exiting) return;
        exiting = true;
        await service.stop();
        try {
          unlinkSync(lockPath);
        } catch {}
        process.exit(0);
      };
      process.on("SIGTERM", () => void stop());
      process.on("SIGINT", () => void stop());
      service.server.on("close", () => {
        try {
          unlinkSync(lockPath);
        } catch {}
      });
    } catch (e) {
      try {
        unlinkSync(lockPath);
      } catch {}
      throw e;
    }
    return;
  }
  if (command === "install") {
    check();
    const target = join(
      process.env.AGENT_FM_SKILLS_DIR ||
        join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"),
      "agent-fm",
    );
    const marker = join(target, ".agent-fm-owned");
    if (existsSync(target) && !existsSync(marker))
      throw Error("同名 Skill 已存在且不属于此安装器，不覆盖。");
    mkdirSync(target, { recursive: true });
    cpSync(join(base, "../skill/agent-fm"), target, { recursive: true });
    writeFileSync(marker, "agent-fm\n");
    writeFileSync(
      join(target, "location.json"),
      JSON.stringify({
        launcher: join(base, "cli.mjs"),
        node: process.execPath,
      }),
      { mode: 0o600 },
    );
    if (autostart.enabled(data)) {
      await stopBridge();
      autostart.configure(data, fileURLToPath(import.meta.url));
    }
    installCommand();
    await start();
    let s = await api("/api/state");
    for (let i = 0; i < 120 && !s.agentOnline && !s.connectionError; i++) {
      await new Promise((r) => setTimeout(r, 250));
      s = await api("/api/state");
    }
    if (!s.agentOnline)
      throw Error(
        s.connectionError || "会话尚未就绪；安装文件已保留，可重试。",
      );
    const result = await api("/api/open");
    console.log(
      JSON.stringify({
        installed: true,
        threadId: s.settings.threadId,
        url: result.url,
      }),
    );
    return;
  }
  if (command === "start" || command === "open") {
    await start();
    const result = await api("/api/open");
    if (!process.argv.includes("--no-open") && process.platform === "darwin")
      spawn("open", [result.url], { stdio: "ignore" }).unref();
    console.log(JSON.stringify(result));
    return;
  }
  if (command === "status" || command === "doctor") {
    const version = check();
    let s: any;
    try {
      s = await api("/api/state");
    } catch {}
    console.log(
      JSON.stringify(
        {
          codex: version,
          node: process.version,
          dataDir: data,
          running: !!s,
          agentOnline: s?.agentOnline ?? false,
          threadId: s?.settings.threadId ?? null,
          error: s?.connectionError ?? null,
          uncertain:
            s?.runs
              ?.filter((r: any) => r.status === "uncertain")
              .map((r: any) => r.id) ?? [],
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "stop") {
    await stopBridge();
    console.log("已停止；会话和个人记录保留。");
    return;
  }
  if (command === "note") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    console.log(JSON.stringify(await api("/api/notes", { text })));
    return;
  }
  if (command === "metrics") {
    // Read-only: works whether or not the bridge is running.
    const { Store } = await import("./store.ts");
    const { metrics } = await import("./metrics.ts");
    const store = new Store(join(data, "space.sqlite"));
    try {
      console.log(JSON.stringify(metrics(store.read()), null, 2));
    } finally {
      store.close();
    }
    return;
  }
  if (command === "prune") {
    // Keep the running release, the one before it, and the newest 3 backups.
    const { readdirSync, statSync, rmSync, realpathSync } = await import("node:fs");
    const apply = process.argv.includes("--apply");
    const releases = join(data, "releases");
    const current = realpathSync(base);
    const byAge = (dir: string, prefix = "") =>
      (existsSync(dir) ? readdirSync(dir) : [])
        .filter((n) => n.startsWith(prefix))
        .map((n) => ({ path: join(dir, n), at: statSync(join(dir, n)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
    const owned = byAge(releases);
    // Only a directory with a launcher can be rolled back to.
    const launchable = (path: string) =>
      existsSync(join(path, "agent-fm/dist/cli.mjs"));
    const keepRel = new Set<string>();
    const running = owned.find((r) => current.startsWith(realpathSync(r.path) + "/"));
    if (running) keepRel.add(running.path);
    // Prefer the launcher recorded before the latest upgrade, then the newest full release.
    const recorded = byAge(data, "upgrade-backup.")
      .map((b) => join(b.path, "location.json.prev"))
      .filter((f) => existsSync(f))
      .map((f) => {
        try {
          return String(JSON.parse(readFileSync(f, "utf8")).launcher);
        } catch {
          return "";
        }
      })
      .map((launcher) => owned.find((r) => launcher.startsWith(r.path + "/")))
      .find((r) => r && !keepRel.has(r.path) && launchable(r.path));
    const previous =
      recorded ?? owned.find((r) => !keepRel.has(r.path) && launchable(r.path));
    if (previous) keepRel.add(previous.path);
    const backups = byAge(data, "upgrade-backup.");
    const remove = [
      ...owned.filter((r) => !keepRel.has(r.path)),
      ...backups.slice(3),
    ].map((r) => r.path);
    if (apply) for (const path of remove) rmSync(path, { recursive: true, force: true });
    console.log(
      JSON.stringify(
        { kept: [...keepRel, ...backups.slice(0, 3).map((b) => b.path)], [apply ? "removed" : "wouldRemove"]: remove },
        null,
        2,
      ),
    );
    if (!running) console.error("当前程序不在 releases 目录内，只保留最新一个版本。");
    return;
  }
  if (command === "uninstall") {
    await stopBridge();
    autostart.disable(data);
    if (existsSync(commandPath) && readFileSync(commandPath,"utf8").includes(ownedCommand)) unlinkSync(commandPath);
    const target = join(
      process.env.AGENT_FM_SKILLS_DIR ||
        join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"),
      "agent-fm",
    );
    if (existsSync(join(target, ".agent-fm-owned"))) {
      const { rmSync } = await import("node:fs");
      rmSync(target, { recursive: true });
    }
    console.log(
      "Skill 已卸载。个人记录和 Codex 会话保留，程序目录可自行移除。",
    );
    return;
  }
  throw Error(
    "支持 install / start / open / status / doctor / stop / note / metrics / prune [--apply] / uninstall",
  );
}
main().catch((e) => {
  console.error(JSON.stringify({version:1,error:{code:String(e.message).split(":")[0],message:e.message}}));
  process.exitCode = 1;
});
