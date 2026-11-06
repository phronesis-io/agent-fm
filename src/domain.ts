import { activitySummary } from "./activity.ts";
import { findProgram } from "./programs.ts";
import { drawEdition } from "./rotation.ts";
import { localDay, record, spend } from "./budget.ts";
import { DAY_CLOSE_EVENT } from "./prompts.ts";
import { randomUUID } from "node:crypto";
import type { State, Session, Run } from "./types.ts";
export function current(s: State, now = Date.now()): Session {
  let t = s.sessions.findLast((x) => !x.ended && !x.deleted);
  if (!t) {
    t = {
      id: randomUUID(),
      started: now,
      ended: null,
      deleted: false,
      state: "open",
      deadline: null,
      remaining: 0,
      plan: 1,
      prepared: false,
      shown: false,
    };
    s.sessions.push(t);
  }
  return t;
}
export function event(
  s: State,
  sessionId: string,
  kind: string,
  detail: string,
  now = Date.now(),
) {
  s.events.push({ id: randomUUID(), sessionId, kind, at: now, detail });
  if (kind === "completed" && s.settings.completionCompanion && s.settings.connected) {
    const session = s.sessions.find(t => t.id === sessionId && !t.deleted);
    const id = "completion-" + sessionId;
    if (session && !s.runs.some(r => r.id === id) &&
        s.runs.filter(r => r.source === "completion" && localDay(r.created) === localDay(now)).length < 24) {
      s.runs.push({
        id, source:"completion", text:"[Agent FM · background event: Pomodoro completed] The timer really completed. This is an event, not a user message. In the confirmed language, offer one short, natural sentence acknowledging this shared interval. Refer to prior conversation only if relevant. Do not infer work done, mood or listening. Do not ask for a report or call fm_leave_note.",
        reply:"", status:"queued", turnId:null, sessionId, plan:session.plan,
        epoch:s.settings.epoch, created:now, error:null
      });
      record(s,"completion","排队",now,id);
    }
  }
}
export function nextEdition(s: State) {
  const shown = s.sessions.findLast((t) => !t.deleted && t.edition);
  const previous = shown?.edition ?? "field";
  const t = current(s);
  delete t.programId;
  const pick = drawEdition(s, previous);
  delete t.editionReason;
  Object.assign(t, pick);
  event(s, t.id, "tune-away", previous);
  event(s, t.id, "skipped", shown?.editionSource ?? "initial");
  event(s, t.id, "edition", pick.edition);
  event(s, t.id, "shown", pick.editionSource);
}
/** "留下这组": keep the current work, sound and session with no model call. */
export function keep(s: State, now = Date.now()) {
  const shown = s.sessions.findLast((t) => !t.deleted && t.edition);
  const edition = shown?.edition ?? "field";
  const t = current(s, now);
  const program = t.programId ? findProgram(s, t.programId) : undefined;
  if (s.events.some(e => e.sessionId === t.id && e.kind === "keep" &&
      e.detail === edition && e.program?.id === program?.id && e.program?.revision === program?.revision)) return edition;
  event(s, t.id, "keep", edition, now);
  if (program) s.events.at(-1)!.program = structuredClone(program);
  return edition;
}
export function timer(
  s: State,
  action: string,
  minutes = 25,
  now = Date.now(),
) {
  const t = current(s, now);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240)
    throw Error("时长须为 1 到 240 分钟");
  if (t.state === "running" && t.deadline !== null && now >= t.deadline) {
    t.state = "elapsed";
    if (!s.events.some((e) => e.sessionId === t.id && e.kind === "completed"))
      event(s, t.id, "completed", "番茄完成", t.deadline);
  }
  if (action === "start") {
    if (t.state !== "open") throw Error("计时已经开始");
    const previous =
      s.sessions.findLast((x) => !x.deleted && x.edition)?.edition ?? "field";
    delete t.editionReason;
    delete t.programId;
    const program = s.nextProgram ? findProgram(s, s.nextProgram) : undefined;
    const queuedEdition = program?.media.kind === "edition" ? program.media.edition : s.nextListeningEdition;
    if (queuedEdition) {
      t.edition = queuedEdition;
      t.editionSource = "queued";
    } else {
      Object.assign(t, drawEdition(s, previous));
    }
    delete s.nextListeningEdition;
    if (program) {
      t.programId = program.id;
      delete s.nextProgram;
    }
    if (t.programId) event(s,t.id,"program-start",t.programId,now);
    event(s, t.id, "shown", t.editionSource ?? "random", now);
    t.state = "running";
    t.remaining = minutes * 60000;
    t.deadline = now + t.remaining;
  } else if (action === "pause") {
    if (t.state !== "running") throw Error("当前没有运行中的计时");
    t.remaining = Math.max(0, t.deadline! - now);
    t.deadline = null;
    t.state = "paused";
  } else if (action === "resume") {
    if (t.state !== "paused") throw Error("当前没有暂停的计时");
    t.deadline = now + t.remaining;
    t.state = "running";
  } else if (action === "extend") {
    if (!["running", "elapsed", "paused"].includes(t.state))
      throw Error("请先开始计时");
    t.remaining =
      (t.state === "paused"
        ? t.remaining
        : Math.max(0, (t.deadline ?? now) - now)) +
      minutes * 60000;
    t.deadline = now + t.remaining;
    t.state = "running";
  } else if (action === "end") {
    t.state = "ended";
    t.ended = now;
    t.deadline = null;
  } else throw Error("未知计时操作");
  t.plan++;
  s.candidates = s.candidates.filter((x) => x.sessionId !== t.id);
  event(s, t.id, action, String(minutes), now);
  return t;
}
export function enqueue(
  s: State,
  id: string,
  text: string,
  source: Run["source"] = "user",
  now = Date.now(),
): Run {
  const old = s.runs.find((x) => x.id === id);
  if (old) {
    if (old.text !== text || old.source !== source)
      throw Error("消息 ID 已用于其他内容");
    return old;
  }
  if (!s.settings.connected) throw Error("Agent 已断开");
  if (!text.trim() || text.length > 12000)
    throw Error("消息须为 1 到 12000 个字符");
  if (s.runs.filter((x) => x.status === "queued").length >= 20)
    throw Error("待发送消息太多，请稍后");
  const t = current(s, now);
  const r: Run = {
    id,
    source,
    context: structuredClone({capturedAt:now, language:s.settings.language, session:t, activity:activitySummary(s,t.id),
      program:t.programId ? findProgram(s,t.programId) : null,
      events:s.events.filter(e=>e.sessionId===t.id).slice(-30)}),
    text,
    reply: "",
    status: "queued",
    turnId: null,
    sessionId: t.id,
    plan: t.plan,
    epoch: s.settings.epoch,
    created: now,
    error: null,
  };
  s.runs.push(r);
  return r;
}
export function eligible(s: State, r: Run, now = Date.now()) {
  const t = s.sessions.find((x) => x.id === r.sessionId);
  return (
    !!t &&
    !t.deleted &&
    s.settings.connected &&
    r.epoch === s.settings.epoch &&
    (r.source === "user" ||
      (r.source === "completion" && !!s.settings.completionCompanion && now <= r.created + 120000) ||
      (r.source === "dayclose" &&
        !!s.settings.dayClose &&
        localDay(r.created) === localDay(now) &&
        now <= r.created + DAY_CLOSE_TTL))
  );
}
/** A day-close note must appear within this window or not at all. */
export const DAY_CLOSE_TTL = 15 * 60000;
/** Quiet time after the last completed Pomodoro before the day can close. */
export const DAY_CLOSE_QUIET = 20 * 60000;
function dayCloseDue(s: State, now: number) {
  if (!s.settings.dayClose || !s.settings.connected) return false;
  const day = localDay(now);
  if (s.settings.budget?.day === day && s.settings.budget.dayClose > 0)
    return false;
  const live = s.sessions.filter((t) => !t.deleted);
  if (live.some((t) => t.state === "running" || t.state === "paused"))
    return false;
  const ids = new Set(live.map((t) => t.id));
  const done = s.events.filter(
    (e) => e.kind === "completed" && ids.has(e.sessionId) && localDay(e.at) === day,
  );
  const last = done.at(-1)?.at;
  if (last === undefined || now - last < DAY_CLOSE_QUIET) return false;
  // Any later start means the day is still going.
  return !s.events.some((e) => e.kind === "start" && e.at > last);
}
export function tick(s: State, online: boolean, now = Date.now()) {
  for (const t of s.sessions) {
    if (t.deleted || t.ended || t.deadline === null) continue;
    if (t.state === "running" && now >= t.deadline) {
      t.state = "elapsed";
      if (!s.events.some((e) => e.sessionId === t.id && e.kind === "completed"))
        event(s, t.id, "completed", "番茄完成", t.deadline);
    }
  }
  // v0.6 per-Pomodoro candidates are retired; nothing is published from them.
  if (s.candidates.length) s.candidates = [];
  if (online && dayCloseDue(s, now) && spend(s, "dayClose", now)) {
    const id = `dayclose-${localDay(now)}-${s.settings.epoch}`;
    try {
      enqueue(s, id, DAY_CLOSE_EVENT, "dayclose", now);
      record(s, "dayclose", "排队", now, id);
    } catch {
      // A full queue spends today's allowance rather than retrying all day.
      record(s, "dayclose", "未发出", now, id);
    }
  }
}
export function removeSession(s: State, id: string) {
  const t = s.sessions.find((x) => x.id === id);
  if (!t) throw Error("时段不存在");
  t.deleted = true;
  t.ended = Date.now();
  t.state = "ended";
  t.plan++;
  s.notes = s.notes.filter((x) => x.sessionId !== id);
  s.candidates = s.candidates.filter((x) => x.sessionId !== id);
  s.events = s.events.filter((x) => x.sessionId !== id);
  for (const r of s.runs.filter((x) => x.sessionId === id)) {
    delete r.context;
    r.text = "";
    r.reply = "";
    r.error = null;
    if (["queued", "running", "submitting"].includes(r.status))
      r.status = "interrupted";
  }
}
export function publicState(s: State) {
  const live = new Set(s.sessions.filter((x) => !x.deleted).map((x) => x.id));
  const today = localDay();
  return {
    settings: s.settings,
    program: (() => {
      const id = s.sessions.findLast(t=>!t.deleted && !t.ended)?.programId;
      return id ? findProgram(s,id) : null;
    })(),
    nextProgram: s.nextProgram ? findProgram(s,s.nextProgram) : null,
    ledger: (s.ledger ?? []).filter((e) => localDay(e.at) === today),
    sessions: s.sessions.filter((x) => !x.deleted),
    runs: s.runs.filter((x) => live.has(x.sessionId) && (x.source === "user" || x.source === "completion")),
    notes: s.notes.filter((x) => live.has(x.sessionId)),
    events: s.events.filter((x) => live.has(x.sessionId)),
    now: Date.now(),
  };
}
