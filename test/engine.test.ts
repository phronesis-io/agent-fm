import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { Engine } from "../src/engine.ts";
import { Codex } from "../src/codex.ts";
import { enqueue, timer, removeSession } from "../src/domain.ts";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "fm-test-"));
  const store = new Store(join(dir, "db"));
  const codex = new Codex();
  const engine = new Engine(store, codex);
  store.update((s) => {
    s.settings.threadId = "thread";
  });
  return {
    store,
    engine,
    codex,
    cleanup() {
      engine.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("a day-close run leaves one visible note, then refuses more and late writes", async () => {
  const x = setup();
  try {
    x.store.update((s) => {
      s.settings.dayClose = true;
      enqueue(s, "dayclose-1", "close", "dayclose");
    });
    x.engine.active = "dayclose-1";
    x.engine.notification("item/agentMessage/delta", {
      threadId: "thread",
      turnId: "turn",
      delta: "private reasoning",
    });
    assert.equal(x.store.read().runs[0].reply, "");
    const call = (callId: string, text: string) =>
      x.engine.tool({
        threadId: "thread",
        turnId: "turn",
        callId,
        tool: "fm_leave_note",
        arguments: { text },
      });
    await call("a", "今天的古琴很合适。");
    assert.equal(x.store.read().notes.length, 1);
    assert.equal(x.store.read().notes[0].source, "Codex · 一天收尾");
    await assert.rejects(call("b", "second"));
    x.store.update((s) => {
      s.settings.dayClose = false;
    });
    await assert.rejects(call("c", "late"));
    await assert.rejects(
      x.engine.tool({
        threadId: "thread",
        turnId: "turn",
        callId: "d",
        tool: "fm_set_scene",
        arguments: { theme: "night", expected_version: 1 },
      }),
    );
  } finally {
    x.cleanup();
  }
});
test("v0.9 start retires an enabled outer loop and its queued preparation", () => {
  const x = setup();
  try {
    x.store.update((s) => {
      s.settings.outerLoop = true;
      timer(s, "start", 25);
      enqueue(s, "prepare-old", "prepare", "prepare");
    });
    const fresh = new Engine(x.store, new Codex());
    const s = x.store.read();
    assert.equal(s.settings.outerLoop, false);
    assert.equal(s.runs[0].status, "interrupted");
    fresh.close();
  } finally {
    x.cleanup();
  }
});
test("restart marks accepted-but-unpersisted run uncertain rather than requeue", () => {
  const x = setup();
  try {
    x.store.update((s) => {
      const r = enqueue(s, "12345678", "hello");
      r.status = "submitting";
    });
    const fresh = new Engine(x.store, new Codex());
    assert.equal(x.store.read().runs[0].status, "uncertain");
    fresh.close();
  } finally {
    x.cleanup();
  }
});
test("late SSE delta cannot restore deleted body", () => {
  const x = setup();
  try {
    x.store.update((s) => enqueue(s, "12345678", "secret"));
    x.engine.active = "12345678";
    x.store.update((s) => removeSession(s, s.runs[0].sessionId));
    x.engine.notification("item/agentMessage/delta", {
      threadId: "thread",
      turnId: "turn",
      delta: "secret",
    });
    assert.equal(x.store.read().runs[0].reply, "");
  } finally {
    x.cleanup();
  }
});
test("SQLite rollback preserves previously acknowledged state", () => {
  const x = setup();
  try {
    assert.throws(() =>
      x.store.update((s) => {
        s.settings.theme = "night";
        throw Error("disk-like transaction abort");
      }),
    );
    assert.equal(x.store.read().settings.theme, "lake");
  } finally {
    x.cleanup();
  }
});
test("unknown submission is reconciled only by persisted client ID", async () => {
  const x = setup();
  try {
    x.store.update((s) => {
      const r = enqueue(s, "12345678", "same text");
      r.status = "uncertain";
    });
    x.codex.request = async () => ({
      data: [
        {
          id: "turn",
          status: "completed",
          items: [
            { type: "userMessage", clientId: "different", content: [] },
            { type: "agentMessage", text: "wrong" },
          ],
        },
      ],
      nextCursor: null,
    });
    await x.engine.reconcile();
    assert.equal(x.store.read().runs[0].status, "uncertain");
    x.codex.request = async () => ({
      data: [
        {
          id: "turn",
          status: "completed",
          items: [
            { type: "userMessage", clientId: "12345678" },
            { type: "agentMessage", text: "correct" },
          ],
        },
      ],
      nextCursor: null,
    });
    await x.engine.reconcile();
    assert.equal(x.store.read().runs[0].reply, "correct");
    assert.equal(x.store.read().runs[0].status, "completed");
  } finally {
    x.cleanup();
  }
});
test("completion from a different turn cannot release the active run", () => {
  const x = setup();
  try {
    x.store.update((s) => {
      const r = enqueue(s, "12345678", "hello");
      r.turnId = "active-turn";
      r.status = "running";
    });
    x.engine.active = "12345678";
    x.engine.notification("turn/completed", {
      threadId: "thread",
      turn: { id: "old-turn", status: "completed" },
    });
    assert.equal(x.engine.active, "12345678");
    assert.equal(x.store.read().runs[0].status, "running");
  } finally {
    x.cleanup();
  }
});
test("cancelled user turn never appends late text", () => {
  const x = setup();
  try {
    x.store.update((s) => {
      const r = enqueue(s, "12345678", "hello");
      r.status = "interrupted";
    });
    x.engine.active = "12345678";
    x.engine.notification("item/agentMessage/delta", {
      threadId: "thread",
      turnId: "turn",
      delta: "late",
    });
    assert.equal(x.store.read().runs[0].reply, "");
  } finally {
    x.cleanup();
  }
});

test("every companion turn uses the current confirmed language, including after a change", async () => {
  const x = setup();
  const requests: any[] = [];
  x.codex.request = async (method, params) => {
    assert.equal(method, "turn/start");
    requests.push(params);
    return {turn:{id:"turn-" + requests.length}};
  };
  x.engine.online = true;
  try {
    for (const language of ["ko", "fr"]) {
      x.store.update(s => {
        s.settings.language = language;
        enqueue(s, "language-" + language, "Tell me about this painting");
      });
      await x.engine.pump();
      const text = requests.at(-1).input.map((item:any) => item.text).join("\n");
      assert.ok(text.includes("Respond in " + language));
      x.engine.notification("turn/completed", {threadId:"thread", turn:{id:"turn-" + requests.length, status:"completed"}});
    }
    assert.equal(requests.length, 2);
  } finally { x.cleanup(); }
});

test("unconfirmed language defaults to English, auto follows messages, and invitation context stays frozen", async () => {
  const x = setup();
  const requests: any[] = [];
  x.codex.request = async (_method, params) => {
    requests.push(params);
    return {turn:{id:"snapshot-" + requests.length}};
  };
  x.engine.online = true;
  try {
    x.store.update(s => {
      const r = enqueue(s, "snapshot-first", "Tell me about this work");
      r.context!.session.edition = "field";
      s.sessions[0].edition = "roses";
    });
    await x.engine.pump();
    const first = requests[0].input.map((item:any) => item.text).join("\n");
    assert.ok(first.includes("Default to English"));
    const snapshot = requests[0].input.find((item:any) => item.text.startsWith("[Agent FM · recorded")).text;
    assert.ok(snapshot.includes('"edition":"field"'));
    const live = await x.engine.tool({tool:"fm_read_space",threadId:"thread",turnId:"snapshot-1"}) as any;
    assert.equal(live.settings.language, "en");
    assert.equal(live.session.edition, "roses");
    assert.equal(live.program, null);
    x.engine.notification("turn/completed", {threadId:"thread",turn:{id:"snapshot-1",status:"completed"}});
    x.store.update(s => {
      s.settings.language = "auto";
      enqueue(s, "snapshot-second", "Bonjour");
    });
    await x.engine.pump();
    const second = requests[1].input.map((item:any) => item.text).join("\n");
    assert.ok(second.includes("Follow the language of the listener's latest message"));
    assert.ok(!second.includes("Respond in auto"));
  } finally { x.cleanup(); }
});
