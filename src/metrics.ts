import { localDay } from "./budget.ts";
import { OVER } from "./curation.ts";
import type { State } from "./types.ts";

/** Self-use indicators from PRD v0.9 §10, computed from local records only. */
export function metrics(s: State, now = Date.now(), days = 7) {
  const live = new Set(s.sessions.filter((t) => !t.deleted).map((t) => t.id));
  const events = s.events.filter((e) => live.has(e.sessionId));
  const window: string[] = [];
  for (let i = days - 1; i >= 0; i--) window.push(localDay(now - i * 86400000));
  const inWindow = (at: number) => window.includes(localDay(at));
  const perDay = (kind: string) =>
    window.map(
      (d) => events.filter((e) => e.kind === kind && localDay(e.at) === d).length,
    );
  const bySource = (kind: string) => {
    const out: Record<string, number> = {};
    for (const e of events)
      if (e.kind === kind && inWindow(e.at)) out[e.detail] = (out[e.detail] ?? 0) + 1;
    return out;
  };
  const shown = bySource("shown"),
    skipped = bySource("skipped");
  const skipRate = Object.fromEntries(
    Object.keys(shown).map((k) => [
      k,
      { shown: shown[k], skipped: skipped[k] ?? 0, rate: (skipped[k] ?? 0) / shown[k] },
    ]),
  );
  const calls = (s.ledger ?? []).filter((e) => inWindow(e.at) && e.outcome !== OVER);
  const outcomes: Record<string, Record<string, number>> = {};
  for (const e of calls) {
    outcomes[e.kind] ??= {};
    outcomes[e.kind][e.outcome] = (outcomes[e.kind][e.outcome] ?? 0) + 1;
  }
  const userRuns = s.runs.filter(
    (r) => r.source === "user" && live.has(r.sessionId) && inWindow(r.created),
  );
  return {
    days: window,
    openDays: window.filter((d) => s.openDays?.includes(d)).length,
    completedPerDay: perDay("completed"),
    skipRate,
    modelCallsPerDay: window.map(
      (d) => calls.filter((e) => localDay(e.at) === d).length,
    ),
    modelOutcomes: outcomes,
    keeps: events.filter((e) => e.kind === "keep" && inWindow(e.at)).length,
    // Messages that carried a work, record or note into chat.
    broughtToChat: userRuns.filter((r) => r.text.includes("\n\n[Agent FM · ")).length,
    messages: userRuns.length,
  };
}
