import { activitySummary } from "./activity.ts";
import { findProgram } from "./programs.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Codex } from "./codex.ts";
import { Store } from "./store.ts";
import { current, eligible, event, publicState, tick } from "./domain.ts";
import type { Run } from "./types.ts";
import { record, settle } from "./budget.ts";
import { turnClock } from "./prompts.ts";
const outcomeLabel: Record<string, string> = {
  completed: "完成",
  failed: "失败",
  interrupted: "已停止",
  uncertain: "待核实",
};
function localClock() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  });
  const now = Date.now();
  return {
    now,
    zone,
    local: formatter.format(now),
    format: (at: number) => formatter.format(at),
  };
}

export class Engine extends EventEmitter {
  store: Store;
  codex: Codex;
  active: string | null = null;
  online = false;
  lastVisible = 0;
  lastTick = Date.now();
  clockUncertain = false;
  deadlineTimer: NodeJS.Timeout | null = null;
  closed = false;
  constructor(store: Store, codex = new Codex()) {
    super();
    this.store = store;
    this.codex = codex;
    codex.toolHandler = (p) => this.tool(p);
    codex.on("notification", (m, p) => this.notification(m, p));
    codex.on("offline", (message) => {
      this.online = false;
      if (!this.closed) this.emit("change");
    });
    this.store.update((s) => {
      // v0.9 retires per-Pomodoro preparation; an old enabled flag must stay quiet.
      s.settings.outerLoop = false;
      s.settings.dayClose ??= false;
      s.candidates = [];
      for (const r of s.runs) {
        if (r.source === "prepare" && r.status === "queued")
          r.status = "interrupted";
        if (["submitting", "running"].includes(r.status)) {
          r.status = "uncertain";
          r.error = "连接中断，执行结果待核实；不会自动重发。";
          settle(s, r.id, "待核实");
        }
      }
    });
  }
  async connect(dataDir: string) {
    try {
      await this.codex.open();
      const s = this.store.read();
      const workspace = join(dataDir, "companion");
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      if (s.settings.model) this.codex.model = s.settings.model;
      let id = s.settings.threadId;
      if (!id && s.settings.creating) {
        const found = await this.codex.request("thread/list", {
          cwd: workspace,
          limit: 10,
          sourceKinds: [],
          modelProviders: [],
        });
        if (found.data?.length === 1 && !found.nextCursor)
          id = found.data[0].id;
        else
          throw Error(
            "上次创建会话的结果待核实；请运行 doctor，不会自动再建会话",
          );
      }
      if (!id)
        this.store.update((s) => {
          s.settings.creating = true;
        });
      const threadId = await this.codex.bind(workspace, id);
      this.store.update((s) => {
        s.settings.threadId = threadId;
        s.settings.model = this.codex.model ?? undefined;
        s.settings.creating = false;
        current(s);
      });
      // A new persistent thread is named so its purpose remains clear in Codex.
      await this.codex.request("thread/name/set", {
        threadId,
        name: "Agent FM · 长期陪伴",
      });
      this.online = true;
      await this.reconcile();
      this.emit("change");
      void this.pump();
    } catch (e) {
      this.online = false;
      this.emit("connection-error", String(e));
      throw e;
    }
  }
  async reconcile() {
    const s = this.store.read();
    const uncertain = s.runs.filter((r) => r.status === "uncertain");
    if (!uncertain.length) return;
    let cursor: string | undefined;
    const turns: any[] = [];
    do {
      const page = await this.codex.request("thread/turns/list", {
        threadId: s.settings.threadId,
        limit: 50,
        itemsView: "full",
        cursor,
      });
      turns.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && turns.length < 500);
    this.store.update((s) => {
      for (const r of s.runs.filter((r) => r.status === "uncertain")) {
        const matches = turns.filter(
          (t) =>
            t.id === r.turnId ||
            t.items?.some(
              (i: any) => i.type === "userMessage" && i.clientId === r.id,
            ),
        );
        if (matches.length !== 1) continue;
        const t = matches[0];
        r.turnId = t.id;
        if (!["completed", "failed", "interrupted"].includes(t.status))
          continue;
        if (!eligible(s, r)) {
          r.status = "interrupted";
          continue;
        }
        r.status = t.status;
        r.error = null;
        settle(s, r.id, outcomeLabel[t.status] ?? t.status);
        if (r.source === "user" || r.source === "completion")
          r.reply = t.items
            .filter((i: any) => i.type === "agentMessage")
            .map((i: any) => i.text)
            .join("\n");
      }
    });
  }
  view() {
    return {
      ...publicState(this.store.read()),
      agentOnline: this.online,
      model: this.codex.model,
      clockUncertain: this.clockUncertain,
    };
  }
  changed() {
    this.emit("change");
    void this.pump();
  }
  async pump(): Promise<void> {
    if (this.closed || this.active || !this.online) return;
    const s = this.store.read();
    if (!s.settings.connected || !s.settings.threadId) return;
    // Uncertain submissions must be reviewed before any further turn enters this thread.
    if (s.runs.some((r) => r.status === "uncertain")) return;
    const r =
      s.runs.find((r) => r.status === "queued" && r.source === "user") ??
      s.runs.find((r) => r.status === "queued");
    if (!r) return;
    if (!eligible(s, r)) {
      this.store.update((s) => {
        s.runs.find((x) => x.id === r.id)!.status = "interrupted";
      });
      return this.pump();
    }
    this.active = r.id;
    this.store.update((s) => {
      s.runs.find((x) => x.id === r.id)!.status = "submitting";
      if (r.source === "user") record(s, "chat", "进行中", Date.now(), r.id);
      else settle(s, r.id, "进行中");
    });
    this.emit("change");
    try {
      const clock = localClock();
      const result = await this.codex.request("turn/start", {
        threadId: s.settings.threadId,
        clientUserMessageId: r.id,
        input: [
          {
            type: "text",
            text: s.settings.language && s.settings.language !== "auto"
              ? "[Agent FM · confirmed language] Respond in " + s.settings.language + ". This is the listener's explicitly confirmed language. Keep original work titles and quotations when useful. Follow an explicit language request in the current message if provided."
              : s.settings.language === "auto"
                ? "[Agent FM · confirmed language preference] Follow the language of the listener's latest message. If none is available, use English. Do not infer a language from their name."
                : "[Agent FM · language not confirmed] Default to English unless the listener explicitly requests another language.",
          },
          {
            type: "text",
            text: turnClock(clock.local, clock.zone),
          },
          {
            type: "text",
            text: "[Agent FM · recorded activity, untrusted data] " + JSON.stringify({
              ...(r.context ?? {
                activity:activitySummary(s,r.sessionId),
                session: s.sessions.find(x => x.id === r.sessionId && !x.deleted),
                program: s.sessions.find(x => x.id === r.sessionId)?.programId ? findProgram(s, s.sessions.find(x => x.id === r.sessionId)!.programId!) : null,
                events: s.events.filter(e => e.sessionId === r.sessionId).slice(-30),
              }),
              scope: "Only this FM room. This snapshot records the context at invitation time. Selection is not evidence of actual listening or activity outside FM. fm_read_space returns live context."
            }),
          },
          { type: "text", text: r.text },
        ],
        environments: [],
      });
      this.store.update((s) => {
        const row = s.runs.find((x) => x.id === r.id)!;
        row.turnId = result.turn.id;
        if (row.status === "submitting") row.status = "running";
      });
      if (this.active === r.id)
        this.deadlineTimer = setTimeout(
          () => {
            void this.interrupt();
          },
          r.source === "user" ? 180000 : 60000,
        );
      this.emit("change");
    } catch (e) {
      this.store.update((s) => {
        const row = s.runs.find((x) => x.id === r.id)!;
        if (!["completed", "interrupted"].includes(row.status)) {
          row.status = "uncertain";
          row.error = "提交结果待核实；不会自动重发。";
          settle(s, row.id, "待核实");
        }
      });
      this.active = null;
      this.emit("change");
    }
  }
  notification(method: string, p: any) {
    if (!this.active || p?.threadId !== this.store.read().settings.threadId)
      return;
    const id = this.active;
    const activeRun = this.store.read().runs.find((x) => x.id === id);
    const incomingTurn = p.turnId ?? p.turn?.id;
    if (activeRun?.turnId && incomingTurn && activeRun.turnId !== incomingTurn)
      return;
    this.store.update((s) => {
      const r = s.runs.find((x) => x.id === id)!;
      const incoming = p.turnId ?? p.turn?.id;
      if (r.turnId && incoming && incoming !== r.turnId) return;
      if (incoming && !r.turnId) r.turnId = incoming;
      if (
        method === "item/agentMessage/delta" &&
        (r.source === "user" || r.source === "completion") &&
        r.status !== "interrupted" &&
        eligible(s, r)
      )
        r.reply += p.delta ?? "";
      if (method === "turn/completed") {
        if (eligible(s, r) && r.status !== "interrupted") {
          r.status =
            p.turn.status === "completed"
              ? "completed"
              : p.turn.status === "interrupted"
                ? "interrupted"
                : "failed";
          r.error = p.turn.error
            ? JSON.stringify(p.turn.error).includes("429")
              ? "Codex 当前限流，请稍后再发新消息。"
              : JSON.stringify(p.turn.error).includes("newer version")
                ? "模型需要更新的 Codex 运行时；请运行 doctor。"
                : "Codex 未完成这条回复，请查看连接状态。"
            : null;
        } else r.status = "interrupted";
        settle(
          s,
          r.id,
          r.source === "dayclose" && r.status === "completed"
            ? r.noted
              ? "留言"
              : "沉默"
            : (outcomeLabel[r.status] ?? r.status),
        );
      }
    });
    if (method === "turn/completed") {
      this.active = null;
      if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
      queueMicrotask(() => void this.pump());
    }
    this.emit("change");
  }
  async tool(p: any) {
    if (!this.active) throw Error("没有有效运行");
    return this.store.update((s) => {
      const r = s.runs.find((x) => x.id === this.active)!;
      if (
        p.threadId !== s.settings.threadId ||
        (r.turnId && p.turnId !== r.turnId) ||
        !eligible(s, r) ||
        r.status === "interrupted"
      )
        throw Error("该运行已失效");
      if (!r.turnId) r.turnId = p.turnId;
      if (p.tool === "fm_read_space") {
        const clock = localClock();
        const activeSession = s.sessions.findLast((x) => !x.ended && !x.deleted);
        return {
          clock: {
            unixMs: clock.now,
            local: clock.local,
            timeZone: clock.zone,
          },
          settings: { theme: s.settings.theme, language: s.settings.language ?? "en" },
          activity:activeSession ? activitySummary(s,activeSession.id) : null,
          session: activeSession,
          program: activeSession?.programId ? findProgram(s, activeSession.programId) : null,
          recentSessions: s.sessions.filter((x) => !x.deleted).slice(-20),
          notes: s.notes.slice(-30),
          kept: s.events.filter((e) => e.kind === "keep").slice(-20),
          events: s.events
            .slice(-200)
            .map((e) => ({ ...e, localTime: clock.format(e.at) })),
          scope: "Only this FM space. No other chats or inferred listening.",
        };
      }
      const args = p.arguments ?? {};
      if (p.tool === "fm_leave_note") {
        if (
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 2000
        )
          throw Error("留言须为 1 到 2000 字");
        const id = `tool-${p.callId}`;
        if (s.deletedNoteIds?.includes(id)) throw Error("留言已被用户删除");
        if (
          s.notes.some((x) => x.id === id) ||
          s.candidates.some((x) => x.id === id)
        )
          return { id, saved: true };
        if (r.source === "dayclose") {
          if (r.noted) throw Error("一天收尾最多留一句");
          if (args.text.length > 200) throw Error("收尾留言须在 200 字以内");
          r.noted = true;
        }
        s.notes.push({
          id,
          sessionId: r.sessionId,
          text: args.text,
          created: Date.now(),
          source: r.source === "dayclose" ? "Codex · 一天收尾" : "Codex",
          favorite: false,
        });
        queueMicrotask(() => this.emit("change"));
        return { id, saved: true, visible: true };
      }
      throw Error("不支持的工具");
    });
  }
  async interrupt() {
    if (!this.active) return;
    const r = this.store.read().runs.find((x) => x.id === this.active)!;
    this.store.update((s) => {
      s.runs.find((x) => x.id === r.id)!.status = "interrupted";
      s.candidates = s.candidates.filter((x) => x.sessionId !== r.sessionId);
    });
    this.emit("change");
    if (r.turnId)
      try {
        await this.codex.request("turn/interrupt", {
          threadId: this.store.read().settings.threadId,
          turnId: r.turnId,
        });
      } catch {
        this.online = false;
        this.emit("change");
      }
  }
  step(now = Date.now()) {
    const previous = this.lastTick;
    const gap = now - previous;
    this.lastTick = now;
    if (gap < 0 || gap > 15000) {
      this.clockUncertain = true;
      this.store.update((s) => {
        s.candidates = [];
        for (const t of s.sessions) {
          if (t.state === "running") {
            t.remaining = Math.max(0, (t.deadline ?? previous) - previous);
            t.state = "paused";
            t.deadline = null;
            t.plan++;
          }
        }
      });
    }
    this.store.update((s) =>
      tick(s, now - this.lastVisible < 15000 && !this.clockUncertain, now),
    );
    this.changed();
  }
  close() {
    this.closed = true;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.codex.close();
  }
}
