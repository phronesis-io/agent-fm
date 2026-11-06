import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "smol-toml";
import {
  COMPANION_DEVELOPER,
  COMPANION_INSTRUCTIONS,
  TOOL_LEAVE_NOTE,
  TOOL_READ_SPACE,
} from "./prompts.ts";
export const supportedCodex = [
  "0.149.1",
  "0.164.0-alpha.11.1",
  "0.166.0-alpha.5.1",
  "0.166.0-alpha.6",
];
export function codexBinary() {
  const bundled =
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";
  return (
    process.env.AGENT_FM_CODEX_BINARY ||
    (existsSync(bundled) ? bundled : "codex")
  );
}
export const instructions = COMPANION_INSTRUCTIONS;
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const dynamicTools = [
  {
    type: "function",
    name: "fm_read_space",
    description: TOOL_READ_SPACE,
    inputSchema: object({}, []),
  },
  {
    type: "function",
    name: "fm_leave_note",
    description: TOOL_LEAVE_NOTE,
    inputSchema: object({ text: { type: "string", maxLength: 2000 } }, [
      "text",
    ]),
  },
];
export function configOverrides() {
  const root = process.env.CODEX_HOME || join(homedir(), ".codex");
  const path = join(root, "config.toml");
  const config = existsSync(path) ? parse(readFileSync(path, "utf8")) : {};
  const overrides: string[] = [];
  const mcp = config.mcp_servers as Record<string, unknown> | undefined;
  for (const name of Object.keys(mcp ?? {})) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      throw Error("MCP 名称需要人工核验后才能安全隔离");
    overrides.push(`mcp_servers.${name}.enabled=false`);
  }
  for (const name of [
    "apps",
    "plugins",
    "hooks",
    "plugin_hooks",
    "multi_agent",
    "multi_agent_v2",
    "shell_tool",
    "unified_exec",
    "browser_use",
    "browser_use_external",
    "computer_use",
    "image_generation",
    "view_image",
    "memories",
    "skill_search",
    "goals",
    "workspace_dependencies",
  ])
    overrides.push(`features.${name}=false`);
  overrides.push(
    'web_search="disabled"',
    "project_doc_max_bytes=0",
    'model_reasoning_effort="low"',
  );
  return overrides;
}
export class Codex extends EventEmitter {
  proc: ChildProcessWithoutNullStreams | null = null;
  seq = 0;
  pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  toolHandler: ((p: any) => Promise<unknown>) | null = null;
  model: string | null = null;
  async open() {
    this.proc = spawn(
      codexBinary(),
      [
        "app-server",
        "--listen",
        "stdio://",
        ...configOverrides().flatMap((x) => ["-c", x]),
      ],
      { stdio: "pipe" },
    );
    this.proc.stderr.on("data", () => {}); // Diagnostics must not copy host transcripts or credentials.
    this.proc.on("error", (e) => this.fail(e));
    this.proc.on("exit", () => this.fail(Error("Codex 连接已关闭")));
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.emit("diagnostic", "invalid_protocol_frame");
      }
    });
    await this.request("initialize", {
      clientInfo: { name: "agent_fm", title: "Agent FM", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
    const account = await this.request("account/read", { refreshToken: false });
    if (account.requiresOpenaiAuth && !account.account)
      throw Error("请先在 Codex 登录，再运行安装");
    const models = await this.request("model/list", {});
    this.model =
      process.env.AGENT_FM_MODEL ||
      models.data.find((m: any) => m.isDefault)?.model;
    if (!this.model || !models.data.some((m: any) => m.model === this.model))
      throw Error("所选模型不在当前 Codex 提供的可用列表中");
  }
  send(v: unknown) {
    if (!this.proc || this.proc.stdin.destroyed) throw Error("Codex 不在线");
    this.proc.stdin.write(JSON.stringify(v) + "\n");
  }
  request(method: string, params: unknown): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Codex 请求超时：${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  receive(msg: any) {
    if (msg.method && msg.id !== undefined) {
      void this.handleRequest(msg);
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result);
      }
      return;
    }
    if (msg.method) this.emit("notification", msg.method, msg.params);
  }
  async handleRequest(msg: any) {
    if (msg.method === "item/tool/call") {
      try {
        if (!this.toolHandler) throw Error("工具尚未就绪");
        const result = await this.toolHandler(msg.params);
        this.send({
          id: msg.id,
          result: {
            success: true,
            contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
          },
        });
      } catch (e) {
        this.send({
          id: msg.id,
          result: {
            success: false,
            contentItems: [{ type: "inputText", text: String(e) }],
          },
        });
      }
    } else {
      this.send({
        id: msg.id,
        error: {
          code: -32601,
          message:
            "This companion does not grant external tools or permission escalation.",
        },
      });
      this.emit("diagnostic", `unsupported_request:${msg.method}`);
    }
  }
  fail(e: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.emit("offline", e.message);
  }
  async bind(cwd: string, id: string | null) {
    const params = {
      cwd,
      model: this.model,
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      baseInstructions: instructions,
      developerInstructions: COMPANION_DEVELOPER,
      config: {},
    };
    const r = id
      ? await this.request("thread/resume", {
          ...params,
          threadId: id,
          excludeTurns: true,
        })
      : await this.request("thread/start", {
          ...params,
          dynamicTools,
          environments: [],
          selectedCapabilityRoots: [],
          serviceName: "agent_fm",
        });
    return r.thread.id as string;
  }
  close() {
    this.proc?.stdin.end();
    const proc = this.proc;
    const timeout = setTimeout(() => proc?.kill("SIGTERM"), 2000);
    timeout.unref();
  }
}
