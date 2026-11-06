import type { State } from "./types.ts";

/** Deterministic evidence, not a listening or productivity inference. */
export function activitySummary(s: State, sessionId: string) {
  if (!s.sessions.some(t => t.id === sessionId && !t.deleted)) return null;
  const events = s.events.filter(e => e.sessionId === sessionId);
  const selections = events.filter(e => e.kind === "source-selected");
  const pauses = events.filter(e => e.kind === "pause");
  const completed = events.filter(e => e.kind === "completed");
  const kept = events.filter(e => e.kind === "keep");
  const reference = (e: State["events"][number]) => ({eventId:e.id, at:e.at, value:e.detail,
    ...(e.program ? {programId:e.program.id, programTitle:e.program.title} : {})});
  return {
    version: 1,
    sessionId,
    sourceSelections: {count: selections.length, last: selections.length ? reference(selections.at(-1)!) : null},
    pauseEvents: {count: pauses.length, eventIds: pauses.slice(-10).map(e => e.id)},
    completions: {count: completed.length, eventIds: completed.slice(-10).map(e => e.id)},
    savedSets: {count: kept.length, evidence: kept.slice(-10).map(reference)},
    scope: "Recorded FM actions only. Counts are event counts, not proof of listening, work, preference or mood. Evidence lists contain at most the latest ten records."
  };
}
