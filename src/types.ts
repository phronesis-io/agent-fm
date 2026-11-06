import type { Program } from "./programs.ts";
export type RunStatus =
  | "queued"
  | "submitting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "uncertain";
export type Run = {
  /** Immutable invitation context; live state remains available via fm_read_space. */
  context?: {activity?: ReturnType<typeof import("./activity.ts").activitySummary>; capturedAt:number; language?:string; session:Session; program:Program|null; events:State["events"]};
  id: string;
  /** "prepare" is the retired v0.6 per-Pomodoro preparation; never run again. */
  source: "user" | "prepare" | "dayclose" | "completion";
  text: string;
  reply: string;
  status: RunStatus;
  turnId: string | null;
  sessionId: string;
  plan: number;
  epoch: number;
  created: number;
  error: string | null;
  /** A day-close run may leave at most one note. */
  noted?: boolean;
};
export type Session = {
  programId?: string;
  editionSource?: "codex" | "random" | "queued";
  edition?: string;
  /** One-line reason supplied with an adopted Codex pick. */
  editionReason?: string;
  id: string;
  started: number;
  ended: number | null;
  deleted: boolean;
  state: "open" | "running" | "paused" | "elapsed" | "ended";
  deadline: number | null;
  remaining: number;
  plan: number;
  prepared: boolean;
  shown: boolean;
};
export type Note = {
  id: string;
  sessionId: string;
  text: string;
  created: number;
  source: string;
  favorite: boolean;
};
export type Settings = {
  /** Explicitly confirmed BCP 47 language. Absent before listener confirmation. */
  language?: string;
  /** Next roaming choice; unset uses the photography/illustration library. */
  visualLibrary?: "contemporary" | "museum" | "all";
  version: number;
  theme: "lake" | "night";
  /** Legacy per-Pomodoro preparation. Always false from v0.9; kept so older builds stay quiet. */
  outerLoop: boolean;
  curateNext?: boolean;
  /** At most one optional note after the day's last Pomodoro. */
  dayClose?: boolean;
  completionCompanion?: boolean;
  /** Bridge-enforced model budget for the current local day. */
  budget?: { day: string; curate: number; dayClose: number; translate?: number };
  present: boolean;
  connected: boolean;
  epoch: number;
  threadId: string | null;
  model?: string;
  creating: boolean;
};
export type Candidate = {
  id: string;
  sessionId: string;
  text: string;
  plan: number;
  epoch: number;
  deadline: number;
  expires: number;
};
export type LedgerKind = "curate" | "dayclose" | "chat" | "translate" | "completion";
/** Metadata about one model call. Never holds message or note text. */
export type LedgerEntry = {
  id: string;
  at: number;
  kind: LedgerKind;
  outcome: string;
};
export type State = {
  programs?: Program[];
  nextProgram?: string;
  ledger?: LedgerEntry[];
  /** Local days on which the page was visible. */
  openDays?: string[];
  nextListeningEdition?: string;
  curatorPick?: { edition: string; key: string; reason?: string };
  rotation?: { remaining: string[]; pass: number; offsets: number[]; library?: string; catalogue?: string };
  schema: 1;
  settings: Settings;
  sessions: Session[];
  runs: Run[];
  notes: Note[];
  candidates: Candidate[];
  deletedNoteIds?: string[];
  events: {
    id: string;
    sessionId: string;
    kind: string;
    at: number;
    detail: string;
    /** Saved programme snapshot; preserves identity and sources across catalogue updates. */
    program?: Program;
  }[];
};
export const initialState = (): State => ({
  schema: 1,
  settings: {
    version: 1,
    theme: "lake",
    outerLoop: false,
    curateNext: false,
    dayClose: false,
    present: true,
    connected: true,
    epoch: 1,
    threadId: null,
    creating: false,
  },
  sessions: [],
  runs: [],
  notes: [],
  candidates: [],
  events: [],
  ledger: [],
});
