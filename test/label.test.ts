import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedLabel, sourceLabel, translateLabel } from "../src/label.ts";

test("label source fields are the museum's own text", () => {
  const met = sourceLabel("field");
  assert.equal(met.language, "en");
  assert.equal(met.fields.title, "Wheat Field with Cypresses");
  const cma = sourceLabel("cma-79932");
  assert.equal(cma.fields.title, "Landscape with Fishermen");
  assert.ok(cma.fields.excerpt.startsWith("This landscape painting"));
  assert.throws(() => sourceLabel("nope"));
});

test("a label is translated once per language, cached, and only the source fields are sent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-label-"));
  let calls = 0;
  const fake = async (prompt: string) => {
    calls++;
    const input = JSON.parse(prompt.slice(prompt.indexOf("INPUT\n") + 6));
    assert.deepEqual(Object.keys(input).sort(), ["collection", "culture", "excerpt", "title"]);
    return Object.fromEntries(Object.keys(input).map((k) => [k, "译:" + k]));
  };
  try {
    assert.equal(await cachedLabel(dir, "cma-79932", "zh-CN"), null);
    const [a, b] = await Promise.all([
      translateLabel(dir, "cma-79932", "zh-CN", fake),
      translateLabel(dir, "cma-79932", "zh-CN", fake),
    ]);
    assert.equal(calls, 1, "concurrent clicks share one call");
    assert.deepEqual(a, b);
    assert.equal((await cachedLabel(dir, "cma-79932", "zh-CN"))!.title, "译:title");
    assert.equal(await cachedLabel(dir, "cma-79932", "ja"), null);
    await assert.rejects(
      translateLabel(dir, "cma-98764", "zh-CN", async () => ({ title: "" })),
    );
    assert.equal(await cachedLabel(dir, "cma-98764", "zh-CN"), null, "bad output is not cached");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
