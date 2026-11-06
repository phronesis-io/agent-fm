import { createHash, randomInt } from "node:crypto";
import art from "../web/editions.json" with { type: "json" };
import programmes from "../web/programs.json" with { type: "json" };
import sounds from "../web/sounds.json" with { type: "json" };
import rotationSounds from "../web/rotation-sounds.json" with { type: "json" };
import type { State } from "./types.ts";

const works: Record<string, { audio: string; collection?: string; library?: string }> = art;
export function visualIds(library: "contemporary" | "museum" | "all") {
  return Object.keys(works).filter(id=> library === "all" ||
    (library === "contemporary" ? works[id].library === "contemporary" : works[id].library !== "contemporary"));
}
const pairedProgrammes = programmes.filter(p => p.collection === "contemporary-pairings" && p.media.kind === "edition");
const pairs = new Map(pairedProgrammes.map(p => [p.media.edition!.split("@")[0], p]));
const catalogueKeys = Object.fromEntries((["contemporary","museum","all"] as const).map(library=>[
  library,createHash("sha256").update(visualIds(library).map(id => pairs.get(id)?.media.edition ?? id).join("\n")).digest("hex").slice(0,16)
]));
// Museum roaming keeps its original sound cycle. Contemporary visuals use
// explicit editorial pairs; unrelated programme additions do not enter the bag.
const tracks = Object.entries(sounds).filter(([,sound])=>!("curatedOnly" in sound && sound.curatedOnly)).map(([id])=>id);
const baseSounds: Record<string,string> = rotationSounds;
function offsets() {
  const a = tracks.map((_, i) => i);
  // Start with the rotation's base sound; later passes each use a different sound.
  for (let i = a.length - 1; i > 1; i--) {
    const j = 1 + randomInt(i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function editionPool(s: State, previous: string) {
  const requested = s.settings.visualLibrary ?? "contemporary";
  const library = requested === "contemporary" && !visualIds(requested).length ? "museum" : requested;
  const ids = visualIds(library);
  const catalogue = catalogueKeys[library];
  let reel = s.rotation;
  if (!reel || (reel.library ?? "museum") !== library || (reel.catalogue && reel.catalogue !== catalogue) || reel.offsets.length !== tracks.length || (!reel.remaining.length && reel.pass + 1 === tracks.length)) {
    reel = s.rotation = { remaining: [...ids], pass: 0, offsets: offsets(), library, catalogue };
  } else if (!reel.remaining.length) {
    reel.pass++;
    reel.remaining = [...ids];
  }
  reel.library = library;
  reel.catalogue = catalogue;
  const offset = reel.offsets[reel.pass];
  const soundFor = (id: string) =>
    pairs.get(id)?.media.edition!.split("@")[1] ??
    tracks[(tracks.indexOf(baseSounds[id] ?? works[id].audio) + offset) % tracks.length];
  const [lastArt, lastSound = works[lastArt]?.audio] = previous.split("@");
  const counts = new Map<string, number>();
  for (const id of reel.remaining) {
    const k = soundFor(id);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // When one sound occupies half the remaining slots it may need to go next
  // so that later choices can still alternate all the way to the end.
  const dominant = [...counts].find(
    ([, count]) => count > reel.remaining.length / 2,
  )?.[0];
  const choices = reel.remaining.filter(
    (id) =>
      id !== lastArt &&
      soundFor(id) !== lastSound &&
      (!dominant || soundFor(id) === dominant),
  );
  const varied = choices.filter(
    (id) => works[id].collection !== works[lastArt]?.collection,
  );
  const pool = varied.length
    ? varied
    : choices.length
      ? choices
      : reel.remaining;
  return pool.map((id) => id + "@" + soundFor(id));
}
export function curatorKey(s: State, previous: string) {
  const cutoff = Date.now() - 7 * 86400000;
  const recent = s.runs
    .filter((r) => r.source === "user" && r.text && r.created >= cutoff)
    .slice(-6);
  const skips = s.events
    .filter((e) => e.kind === "tune-away" && e.at >= cutoff)
    .slice(-5);
  return JSON.stringify([
    s.settings.epoch,
    s.settings.version,
    previous,
    recent.map((r) => r.id),
    skips.map((e) => e.id),
  ]);
}
export function drawEdition(s: State, previous: string) {
  const pool = editionPool(s, previous);
  const preferred = s.curatorPick;
  const usePick =
    preferred &&
    s.settings.curateNext &&
    s.settings.connected &&
    pool.includes(preferred.edition) &&
    preferred.key === curatorKey(s, previous);
  const next = usePick ? preferred.edition : pool[randomInt(pool.length)];
  if (usePick) {
    const entry = s.ledger?.findLast(
      (e) => e.kind === "curate" && e.outcome === "已备好",
    );
    if (entry) entry.outcome = "采用";
  }
  delete s.curatorPick;
  const bag = s.rotation!.remaining;
  bag.splice(bag.indexOf(next.split("@")[0]), 1);
  return {
    edition: next,
    ...(pairs.get(next.split("@")[0])?.media.edition === next ? {programId:pairs.get(next.split("@")[0])!.id} : {}),
    editionSource: usePick ? ("codex" as const) : ("random" as const),
    ...(usePick && preferred.reason ? { editionReason: preferred.reason } : {}),
  };
}
