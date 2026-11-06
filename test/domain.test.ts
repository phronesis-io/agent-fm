import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../src/types.ts";
import {
  current,
  enqueue,
  timer,
  tick,
  eligible,
  removeSession,
  publicState,
} from "../src/domain.ts";
test("same input ID is durable, conflicting content is refused", () => {
  const s = initialState();
  const a = enqueue(s, "12345678", "hello");
  assert.equal(enqueue(s, "12345678", "hello").id, a.id);
  assert.equal(s.runs.length, 1);
  assert.throws(() => enqueue(s, "12345678", "other"));
});
test("retired per-Pomodoro preparation never enqueues or publishes", () => {
  const s = initialState();
  s.settings.outerLoop = true;
  s.settings.dayClose = false;
  const t = timer(s, "start", 25, 0);
  tick(s, true, 23 * 60000);
  assert.equal(s.runs.length, 0);
  s.candidates.push({
    id: "n",
    sessionId: t.id,
    text: "old",
    plan: t.plan,
    epoch: 1,
    deadline: 1500000,
    expires: 2100000,
  });
  tick(s, true, 2100001);
  assert.equal(s.notes.length, 0);
  assert.equal(s.candidates.length, 0);
});
test("deletion redacts runs and rejects late writes and exports", () => {
  const s = initialState();
  const r = enqueue(s, "12345678", "private");
  r.reply = "private reply";
  s.notes.push({
    id: "n",
    sessionId: r.sessionId,
    text: "private note",
    created: 0,
    source: "Codex",
    favorite: false,
  });
  removeSession(s, r.sessionId);
  assert.equal(eligible(s, r), false);
  assert.equal(s.runs[0].text, "");
  assert.equal(JSON.stringify(publicState(s)).includes("private"), false);
});
test("revocation makes old runs ineligible even after reconnect", () => {
  const s = initialState();
  const r = enqueue(s, "12345678", "hello");
  s.settings.connected = false;
  s.settings.epoch++;
  s.settings.connected = true;
  assert.equal(eligible(s, r), false);
});
test("unlimited space does not call model on repeated ticks", () => {
  const s = initialState();
  s.settings.outerLoop = true;
  current(s, 0);
  for (let i = 0; i < 100; i++) tick(s, true, i * 60000);
  assert.equal(s.runs.length, 0);
});

test("local pomodoros complete once without AI and preserve early endings", () => {
  const s = initialState();
  s.settings.connected = false;
  const first = timer(s, "start", 25, 1000);
  timer(s, "pause", 25, 61000);
  tick(s, false, 5000000);
  assert.equal(s.events.filter((e) => e.kind === "completed").length, 0);
  timer(s, "resume", 25, 5000000);
  tick(s, false, 6440000);
  tick(s, false, 6500000);
  assert.equal(s.events.filter((e) => e.kind === "completed").length, 1);
  assert.equal(s.runs.length, 0);
  timer(s, "end", 25, 6500001);
  const second = timer(s, "start", 25, 6500002);
  assert.notEqual(second.id, first.id);
  timer(s, "end", 25, 6501000);
  const saved = JSON.parse(JSON.stringify(s));
  assert.equal(
    saved.events.filter((e: { kind: string }) => e.kind === "start").length,
    2,
  );
  assert.equal(
    saved.events.filter((e: { kind: string }) => e.kind === "completed").length,
    1,
  );
  assert.equal(saved.runs.length, 0);
});

test("each new timer draws a different edition and pausing keeps it", () => {
  const state = initialState();
  let previous: string | undefined;
  for (let i = 0; i < 12; i++) {
    const session = timer(state, "start");
    assert.ok(session.edition);
    assert.notEqual(session.edition, previous);
    previous = session.edition;
    assert.equal(timer(state, "pause").edition, previous);
    assert.equal(timer(state, "resume").edition, previous);
    timer(state, "end");
  }
});

test("switching editions visits every set without changing the running timer", async () => {
  const { nextEdition } = await import("../src/domain.ts");
  const s = initialState(),
    t = timer(s, "start", 25);
  const { id, deadline, plan, state } = t;
  const seen = new Set([t.edition]);
  for (let i = 0; i < 4; i++) {
    nextEdition(s);
    seen.add(t.edition);
  }
  assert.equal(seen.size, 5);
  assert.deepEqual(
    { id: t.id, deadline: t.deadline, plan: t.plan, state: t.state },
    { id, deadline, plan, state },
  );
  assert.equal(s.sessions.length, 1);
  assert.equal(s.runs.length, 0);
});

test("a queued listening card is consumed only by a new timer", () => {
  const s = initialState();
  const running = timer(s, "start", 25);
  const original = running.edition;
  s.nextListeningEdition = "cma-117338@rain";
  timer(s, "pause");
  assert.equal(timer(s, "resume").edition, original);
  timer(s, "end");
  assert.equal(timer(s, "start").edition, "cma-117338@rain");
  assert.equal(s.nextListeningEdition, undefined);
});

const H = 3600000;
// A fixed local afternoon keeps day boundaries away from the test.
const noon = new Date(2026, 10, 4, 12, 0, 0).getTime();
function completeOne(s: ReturnType<typeof initialState>, at: number) {
  timer(s, "start", 25, at);
  tick(s, true, at + 25 * 60000);
  timer(s, "end", 25, at + 25 * 60000 + 1);
}
test("day close waits for quiet after a completed Pomodoro and runs at most once a day", () => {
  const s = initialState();
  s.settings.dayClose = true;
  completeOne(s, noon);
  const done = noon + 25 * 60000;
  tick(s, true, done + 19 * 60000);
  assert.equal(s.runs.length, 0, "not before 20 quiet minutes");
  tick(s, false, done + 21 * 60000);
  assert.equal(s.runs.length, 0, "not while the page is away");
  tick(s, true, done + 21 * 60000);
  assert.equal(s.runs.length, 1);
  assert.equal(s.runs[0].source, "dayclose");
  assert.equal(s.ledger!.length, 1);
  assert.equal(s.ledger![0].kind, "dayclose");
  completeOne(s, done + H);
  tick(s, true, done + 3 * H);
  assert.equal(s.runs.length, 1, "second chance the same day is refused");
  completeOne(s, noon + 24 * H);
  tick(s, true, noon + 24 * H + 50 * 60000);
  assert.equal(s.runs.length, 2, "a new local day restores the allowance");
});
test("day close is off by default and needs a completed Pomodoro", () => {
  const s = initialState();
  completeOne(s, noon);
  tick(s, true, noon + 2 * H);
  assert.equal(s.runs.length, 0);
  s.settings.dayClose = true;
  timer(s, "start", 25, noon + 3 * H);
  timer(s, "end", 25, noon + 3 * H + 60000);
  const fresh = initialState();
  fresh.settings.dayClose = true;
  timer(fresh, "start", 25, noon);
  timer(fresh, "end", 25, noon + 60000);
  tick(fresh, true, noon + 2 * H);
  assert.equal(fresh.runs.length, 0, "an early-ended Pomodoro is not a completion");
});
test("a running or paused Pomodoro keeps the day open", () => {
  const s = initialState();
  s.settings.dayClose = true;
  completeOne(s, noon);
  timer(s, "start", 25, noon + H);
  timer(s, "pause", 25, noon + H + 60000);
  tick(s, true, noon + 3 * H);
  assert.equal(s.runs.length, 0);
});
test("day close expires, and disabling it invalidates a queued run", () => {
  const s = initialState();
  s.settings.dayClose = true;
  completeOne(s, noon);
  const at = noon + H;
  tick(s, true, at);
  const r = s.runs[0];
  assert.equal(eligible(s, r, at + 60000), true);
  assert.equal(eligible(s, r, at + 16 * 60000), false);
  s.settings.dayClose = false;
  assert.equal(eligible(s, r, at + 60000), false);
});
test("keeping the current set is local, idempotent and per session", async () => {
  const { keep } = await import("../src/domain.ts");
  const s = initialState();
  timer(s, "start", 25, noon);
  const edition = keep(s, noon + 1000);
  keep(s, noon + 2000);
  assert.equal(s.events.filter((e) => e.kind === "keep").length, 1);
  assert.equal(s.events.find((e) => e.kind === "keep")!.detail, edition);
  assert.equal(s.runs.length, 0);
});
test("metrics count skips by source, completions and keeps from local records", async () => {
  const { metrics } = await import("../src/metrics.ts");
  const { nextEdition, keep } = await import("../src/domain.ts");
  const s = initialState();
  completeOne(s, Date.now() - 2 * H);
  nextEdition(s);
  keep(s);
  const m = metrics(s);
  assert.equal(m.completedPerDay.at(-1), 1);
  assert.equal(m.skipRate.random.shown, 2);
  assert.equal(m.skipRate.random.skipped, 1);
  assert.equal(m.keeps, 1);
  assert.equal(m.modelCallsPerDay.at(-1), 0);
});
