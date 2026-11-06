import { randomInt } from "node:crypto";
import works from "../web/editions.json" with { type: "json" };
import sounds from "../web/sounds.json" with { type: "json" };
import { editionPool, curatorKey } from "./rotation.ts";
import { structuredCodex } from "./listening.ts";
import { curatePrompt } from "./prompts.ts";
import type { Store } from "./store.ts";
import type { State } from "./types.ts";
import { localDay, record, settle, spend } from "./budget.ts";
/** Ledger outcome for the first selection skipped after today's limit. */
export const OVER = "已达上限，今天改为随机";
const artwork: Record<
  string,
  { art: string; audio: string; culture?: string }
> = works;
const music: Record<string, { track: string; credit: string }> = sounds;
function describe(edition: string) {
  const [id, track] = edition.split("@"),
    w = artwork[id],
    song = music[track ?? w?.audio];
  return {
    edition,
    art: w?.art,
    culture: w?.culture,
    music: song?.track,
    credit: song?.credit,
  };
}
function previous(s: State) {
  return (
    s.sessions.findLast((t) => !t.deleted && t.edition)?.edition ?? "field"
  );
}
export function makeCurator(store: Store, choose = structuredCodex) {
  let task: AbortController | null = null,
    attempt = "",
    nextAt = 0,
    closed = false;
  function cancel() {
    task?.abort();
    attempt = "";
  }
  async function prepare() {
    if (closed || task || Date.now() < nextAt) return;
    const state = store.read();
    if (
      !state.settings.curateNext ||
      !state.settings.connected ||
      state.nextListeningEdition
    )
      return;
    const last = previous(state),
      key = curatorKey(state, last);
    if (attempt === key || state.curatorPick?.key === key) return;
    const cutoff = Date.now() - 7 * 86400000;
    const messages = state.runs
      .filter((r) => r.source === "user" && r.text && r.created >= cutoff)
      .slice(-6)
      .map((r) =>
        r.text.split("\n\n[Agent FM · listening card]")[0].slice(0, 400),
      );
    const skipped = state.events
      .filter((e) => e.kind === "tune-away" && e.at >= cutoff)
      .slice(-5)
      .map((e) => describe(e.detail));
    if (!messages.length && !skipped.length) return;
    // Spend before calling: a crash after this point costs one unit, never more.
    const ticket = store.update((s) => {
      if (!spend(s, "curate")) return null;
      return record(s, "curate", "进行中");
    });
    attempt = key;
    nextAt = Date.now() + 180000;
    if (!ticket) {
      // One marker per day; it is not a model call.
      store.update((s) => {
        const day = localDay();
        if (
          !s.ledger?.some(
            (e) => e.outcome === OVER && localDay(e.at) === day,
          )
        )
          record(s, "curate", OVER);
      });
      return;
    }
    const candidates = store.update((s) => editionPool(s, last));
    // Sample across sounds so a music preference is represented even in a small shortlist.
    const bySound = new Map<string, string[]>();
    for (const id of candidates) {
      const k = id.split("@")[1];
      const bucket = bySound.get(k) ?? [];
      bucket.push(id);
      bySound.set(k, bucket);
    }
    const buckets = [...bySound.values()];
    for (let i = buckets.length - 1; i > 0; i--) {
      const j = randomInt(i + 1); [buckets[i], buckets[j]] = [buckets[j], buckets[i]];
    }
    // Keep the original 48-candidate ceiling as the music library grows.
    // One per sound first, then up to three per sound; never spend more calls.
    const shortlist: string[] = [];
    for (let round = 0; round < 3 && shortlist.length < 48; round++) {
      for (const bucket of buckets) {
        if (shortlist.length === 48) break;
        if (bucket.length) shortlist.push(bucket.splice(randomInt(bucket.length), 1)[0]);
      }
    }
    const controller = new AbortController();
    task = controller;
    try {
      const result = await choose(
        curatePrompt({
          language: state.settings.language,
          messages,
          skipped,
          candidates: shortlist.map(describe),
        }),
        {
          type: "object",
          properties: {
            choice: { type: "string", enum: ["none", ...shortlist] },
            reason: { type: "string", maxLength: 80 },
          },
          required: ["choice", "reason"],
          additionalProperties: false,
        },
        controller.signal,
      );
      if (closed || controller.signal.aborted) {
        store.update((s) => settle(s, ticket, "已作废"));
        return;
      }
      if (!shortlist.includes(result.choice)) {
        store.update((s) => settle(s, ticket, "弃选"));
        return;
      }
      const reason =
        typeof result.reason === "string"
          ? result.reason.replace(/\s+/g, " ").trim().slice(0, 40)
          : "";
      store.update((s) => {
        if (
          s.settings.curateNext &&
          s.settings.connected &&
          curatorKey(s, previous(s)) === key
        ) {
          s.curatorPick = { key, edition: result.choice, reason };
          settle(s, ticket, "已备好");
        } else settle(s, ticket, "已作废");
      });
    } catch {
      /* Keep playback instant when no recommendation is available. */
      store.update((s) => settle(s, ticket, "失败"));
    } finally {
      task = null;
    }
  }
  return {
    prepare,
    cancel,
    close() {
      closed = true;
      cancel();
    },
  };
}
