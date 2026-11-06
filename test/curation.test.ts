import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { makeCurator } from "../src/curation.ts";
import { enqueue, nextEdition, timer } from "../src/domain.ts";
test("curation needs consent and context, preserves the timer, then consumes one eligible pick", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-curate-")),
    store = new Store(join(dir, "db"));
  let calls = 0,
    selected = "";
  const curator = makeCurator(store, async (prompt) => {
    calls++;
    const json = JSON.parse(prompt.slice(prompt.indexOf('{"messages"')));
    assert.deepEqual(json.messages, ["古琴"]);
    assert.ok(json.candidates.length <= 48);
    assert.equal(new Set(json.candidates.map((c: {edition:string})=>c.edition)).size,json.candidates.length);
    selected = json.candidates.find((c: { edition: string }) =>
      c.edition.endsWith("@liushui"),
    ).edition;
    return { choice: selected, reason: "你提到古琴" };
  });
  try {
    await curator.prepare();
    store.update((s) => {
      s.settings.curateNext = true;
    });
    await curator.prepare();
    assert.equal(calls, 0);
    store.update((s) => {
      const r = enqueue(
        s,
        "recent",
        "古琴\n\n[Agent FM · listening card]\nprivate-extra",
      );
      r.status = "completed";
    });
    await curator.prepare();
    await curator.prepare();
    assert.equal(calls, 1);
    const t = store.update((s) => timer(s, "start", 25));
    assert.equal(t.edition, selected);
    assert.equal(t.editionSource, "codex");
    assert.equal(t.editionReason, "你提到古琴");
    assert.deepEqual(
      store.read().ledger!.map((e) => [e.kind, e.outcome]),
      [["curate", "采用"]],
    );
    const deadline = t.deadline;
    store.update(nextEdition);
    const s = store.read();
    assert.equal(s.sessions[0].deadline, deadline);
    assert.notEqual(s.sessions[0].edition, selected);
    assert.equal(s.sessions[0].editionSource, "random");
    assert.equal(s.curatorPick, undefined);
  } finally {
    curator.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a slow recommendation is discarded after new user input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-curate-")),
    store = new Store(join(dir, "db"));
  let release!: () => void;
  const delay = new Promise<void>((ok) => (release = ok));
  const curator = makeCurator(store, async (prompt) => {
    const j = JSON.parse(prompt.slice(prompt.indexOf('{"messages"')));
    await delay;
    return { choice: j.candidates[0].edition };
  });
  try {
    store.update((s) => {
      s.settings.curateNext = true;
      enqueue(s, "first", "些许雨声");
    });
    const pending = curator.prepare();
    store.update((s) => enqueue(s, "second", "换个口味"));
    release();
    await pending;
    assert.equal(store.read().curatorPick, undefined);
  } finally {
    curator.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("curation stops calling the model after twelve calls in a local day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-curate-")),
    store = new Store(join(dir, "db"));
  let calls = 0;
  const curator = makeCurator(store, async () => {
    calls++;
    return { choice: "none", reason: "" };
  });
  try {
    store.update((s) => {
      s.settings.curateNext = true;
      s.settings.budget = {
        day: new Date().toLocaleDateString("sv-SE"),
        curate: 11,
        dayClose: 0,
      };
      enqueue(s, "m1", "雨声");
    });
    await curator.prepare();
    assert.equal(calls, 1);
    // A fresh curator (e.g. after restart) shares the persisted budget.
    const again = makeCurator(store, async () => {
      calls++;
      return { choice: "none", reason: "" };
    });
    store.update((s) => enqueue(s, "m2", "潮声"));
    await again.prepare();
    store.update((s) => enqueue(s, "m3", "钢琴"));
    const third = makeCurator(store, async () => {
      calls++;
      return { choice: "none", reason: "" };
    });
    await third.prepare();
    again.close();
    third.close();
    assert.equal(calls, 1);
    const ledger = store.read().ledger!;
    assert.deepEqual(
      ledger.map((e) => e.outcome),
      ["弃选", "已达上限，今天改为随机"],
    );
  } finally {
    curator.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
