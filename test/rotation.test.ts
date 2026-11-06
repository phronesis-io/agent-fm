import { test } from "node:test";
import assert from "node:assert/strict";
import { drawEdition, editionPool, visualIds } from "../src/rotation.ts";
import { initialState } from "../src/types.ts";
import { timer } from "../src/domain.ts";
import works from "../web/editions.json" with { type: "json" };
import sounds from "../web/sounds.json" with { type: "json" };
import baseSounds from "../web/rotation-sounds.json" with { type: "json" };
import authoredPairs from "../web/listening/ten.json" with { type: "json" };
import { existsSync } from "node:fs";
const rotationTracks = Object.entries(sounds).filter(([,s])=>!("curatedOnly" in s && s.curatedOnly)).map(([id])=>id);
test("catalogue resolves locally, with a source for every artwork", () => {
  assert.equal(visualIds("museum").length,500);
  assert.ok(visualIds("contemporary").length>=200);
  assert.ok(Object.keys(sounds).length >= 16);
  for (const [id, w] of Object.entries(works)) {
    assert.ok(w.audio in sounds);
    assert.ok(
      existsSync("web/" + ("image" in w ? w.image.slice(1) : id + ".jpg")),
    );
    assert.ok(
      "source" in w
        ? w.source.startsWith("https://")
        : w.museum,
    );
  }
  for (const track of Object.keys(sounds))
    assert.ok(existsSync("web/" + track + ".mp3"));
});
test("each work/sound pair occurs once per full rotation, including restart", () => {
  let s = initialState(),
    previous = "field@arabesque";
  s.settings.visualLibrary="museum";
  const seen = new Set<string>();
  for (let round = 0; round < rotationTracks.length; round++) {
    const art = new Set<string>();
    for (let i = 0; i < 500; i++) {
      if (i === 211) s = JSON.parse(JSON.stringify(s));
      const { edition: id } = drawEdition(s, previous);
      const [work, sound] = id.split("@"),
        [lastArt, lastSound] = previous.split("@");
      assert.notEqual(work, lastArt);
      assert.notEqual(sound, lastSound);
      assert.ok(!art.has(work));
      assert.ok(!seen.has(id));
      seen.add(id);
      art.add(work);
      previous = id;
    }
  }
  assert.equal(seen.size, visualIds("museum").length * rotationTracks.length);
  assert.ok(drawEdition(s, previous));
  assert.equal(s.rotation?.pass, 0);
});

test("catalogue expansion rebuilds the old bag without changing the active clock", () => {
  const s = initialState();
  timer(s,"start",25,1000);
  s.sessions.at(-1)!.edition = "field";
  s.rotation = {remaining:[],pass:9,offsets:[0,1,2,3,4,5,6,7,8,9]};
  const before = JSON.stringify(s.sessions);
  const next = drawEdition(s,"field@arabesque");
  assert.ok(next.edition.split("@")[1] in sounds);
  assert.equal(s.rotation.offsets.length,rotationTracks.length);
  assert.equal(s.rotation.pass,0);
  assert.equal(JSON.stringify(s.sessions),before);
});

test("the first pass reaches every sound while preserving the authored ten", () => {
  assert.deepEqual(Object.keys(baseSounds).sort(),visualIds("museum").sort());
  for (const sound of Object.values(baseSounds)) assert.ok(sound in sounds);
  const s=initialState();s.settings.visualLibrary="museum";
  const pool=editionPool(s,"unknown");
  assert.deepEqual([...new Set(pool.map(id=>id.split("@")[1]))].sort(),rotationTracks.sort());
  for (const pair of authoredPairs) assert.ok(pool.includes(pair.art+"@"+pair.sound));
});
