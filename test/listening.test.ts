import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listeningText } from "../src/listening.ts";
import notes from "../web/listening/ten.json" with { type: "json" };
import facts from "../web/listening/facts.json" with { type: "json" };
import works from "../web/editions.json" with { type: "json" };
import sounds from "../web/sounds.json" with { type: "json" };
test("ten editorial pairings resolve to independent facts, authentic titles and local media", () => {
  assert.equal(new Set(notes.map((n) => n.art)).size, 10);
  for (const n of notes) {
    const record = facts[n.art as keyof typeof facts],
      w = works[n.art as keyof typeof works];
    assert.ok(record.fact && record.original && record.language);
    assert.ok(n.text.pair && n.text.aside && n.sound in sounds);
    assert.ok(
      existsSync("web/" + ("image" in w ? w.image.slice(1) : n.art + ".jpg")),
    );
  }
});
test("shared Chinese facts need no model; an uncached language is only generated on consent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-public-facts-"));
  try {
    assert.equal(
      (await listeningText(dir, 0, "zh-CN", false)).fact,
      facts["cma-79932"].fact,
    );
    await assert.rejects(listeningText(dir, 0, "it-IT", false), /offline/);
    await assert.rejects(listeningText(dir, 100, "en", true), /Invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
