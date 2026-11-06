import { randomUUID } from "node:crypto";
import type { LedgerKind, State } from "./types.ts";

/** Daily model-call limits, enforced in the bridge rather than in prompts. */
export const LIMITS = { curate: 12, dayClose: 1, translate: 40 } as const;
const LEDGER_CAP = 1000;

/** Local calendar day as YYYY-MM-DD. */
export function localDay(at = Date.now()) {
  return new Date(at).toLocaleDateString("sv-SE");
}

function today(s: State, now: number) {
  const day = localDay(now);
  if (s.settings.budget?.day !== day)
    s.settings.budget = { day, curate: 0, dayClose: 0, translate: 0 };
  s.settings.budget.translate ??= 0;
  return s.settings.budget as Required<NonNullable<State["settings"]["budget"]>>;
}

export function remaining(
  s: State,
  kind: keyof typeof LIMITS,
  now = Date.now(),
) {
  return LIMITS[kind] - today(s, now)[kind];
}

/** Reserve one call. Returns false once today's allowance is used up. */
export function spend(s: State, kind: keyof typeof LIMITS, now = Date.now()) {
  const b = today(s, now);
  if (b[kind] >= LIMITS[kind]) return false;
  b[kind]++;
  return true;
}

/** Append call metadata. Never pass message, reply or note text here. */
export function record(
  s: State,
  kind: LedgerKind,
  outcome: string,
  now = Date.now(),
  id: string = randomUUID(),
) {
  s.ledger ??= [];
  if (s.ledger.some((e) => e.id === id)) return id;
  s.ledger.push({ id, at: now, kind, outcome });
  if (s.ledger.length > LEDGER_CAP) s.ledger.splice(0, s.ledger.length - LEDGER_CAP);
  return id;
}

export function settle(s: State, id: string, outcome: string) {
  const entry = s.ledger?.find((e) => e.id === id);
  if (entry) entry.outcome = outcome;
}
