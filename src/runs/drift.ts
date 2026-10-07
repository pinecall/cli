/** `pinecall runs drift`: each judge's pass rate over two time windows, and the change. */

import { type CallScore } from "@pinecall/agents/wire";
import { type SessionLine } from "@pinecall/agents/wire";

import { entriesOf, theSessions, type Door } from "../testing/gateway.js";
import { theScoreIn } from "./candidate.js";

/** Calls read per drift; 200 is the sessions endpoint's maximum. */
export const A_WINDOW_OF_CALLS = 200;

/** Allowed drop in percentage points before failing; the sign is ignored. */
export const THRESHOLD = 10;

/** Number of recent failing calls listed. */
const NAMED = 3;

/** A finished call and its score. */
export interface Judged {
  call: string;
  /** End time, unix seconds; decides the window. */
  at: number;
  score: CallScore | null;
}

/** One judge's pass rate in one window. */
export interface Rate {
  held: number;
  settled: number;
  percent: number;
}

/** One judge's rate in both windows and the change. */
export interface JudgeDrift {
  judge: string;
  before: Rate | null;
  now: Rate | null;
  /** Percentage points, now minus before; null when either window has no verdicts. */
  delta: number | null;
}

/** One failing verdict with its evidence seqs. */
export interface Broke {
  call: string;
  judge: string;
  seqs: number[];
  reason: string;
}

/** Drift result: per-judge rows, unjudged counts, and recent failures. */
export interface Drift {
  judges: JudgeDrift[];
  notJudged: { now: number; before: number };
  broke: Broke[];
  /** The most negative delta, or null when nothing was comparable. */
  worst: number | null;
}

/** Drift parameters; windows are in seconds. */
export interface Asked {
  agent: string;
  window: number;
  baseline: number;
  threshold: number;
  limit: number;
  /** Current time, unix seconds (injectable for tests). */
  now: number;
}

/** Print the drift; returns 1 when a judge dropped more than the threshold. */
export async function drifted(
  door: Door,
  asked: Asked,
  out: NodeJS.WritableStream,
  asJson = false,
): Promise<number> {
  const drift = await theDrift(door, asked);
  out.write(asJson ? `${JSON.stringify(drift)}\n` : `${linesOf(asked, drift).join("\n")}\n`);
  return drift.worst !== null && drift.worst < -Math.abs(asked.threshold) ? 1 : 0;
}

/** Compute the drift; used by the CLI verb and the console. */
export async function theDrift(door: Door, asked: Asked): Promise<Drift> {
  const sessions = await theSessions(door, asked.agent, asked.limit);
  const now = await judgedIn(door, finishedBetween(sessions, asked.now - asked.window, asked.now));
  const opened = asked.now - asked.baseline;
  const before = await judgedIn(door, finishedBetween(sessions, opened, asked.now - asked.window));
  return driftOf(now, before);
}

/** Finished calls that ended in `(from, to]`, newest first. */
export function finishedBetween(sessions: SessionLine[], from: number, to: number): SessionLine[] {
  const inside = sessions.filter(
    (line) => !line.live && line.ended_at !== null && line.ended_at > from && line.ended_at <= to,
  );
  return inside.sort((one, other) => (other.ended_at ?? 0) - (one.ended_at ?? 0));
}

/** Per-judge pass rates in each window, counted from `call.score` verdicts. */
export function driftOf(now: Judged[], before: Judged[]): Drift {
  const [judgedNow, judgedBefore] = [now.filter(wasJudged), before.filter(wasJudged)];
  const judges = [...new Set([...judgedNow, ...judgedBefore].flatMap(namesIn))].sort();
  const rows = judges.map((judge) => rowFor(judge, judgedNow, judgedBefore));
  const deltas = rows.map((row) => row.delta).filter((delta) => delta !== null);
  return {
    judges: rows,
    notJudged: { now: now.length - judgedNow.length, before: before.length - judgedBefore.length },
    broke: brokenIn(judgedNow),
    worst: deltas.length > 0 ? Math.min(...deltas) : null,
  };
}

/** Text output: header, one row per judge, then recent failures. */
export function linesOf(asked: Asked, drift: Drift): string[] {
  const width = Math.max(1, ...drift.judges.map((row) => row.judge.length));
  const lines = [
    `${asked.agent}  drift  the last ${secondsAs(asked.window)} against the ${secondsAs(asked.baseline)} before it`,
    ...drift.judges.map((row) => rowAs(row, width)),
    `  ${drift.notJudged.now} not judged in the window, ${drift.notJudged.before} in the baseline`,
  ];
  if (drift.broke.length > 0) {
    lines.push(`  the ${drift.broke.length} most recent broken call(s):`);
    for (const broke of drift.broke) {
      lines.push(`    ${broke.call}  ${broke.judge}  seq ${broke.seqs.join(", ")}  ${broke.reason}`);
    }
  }
  return lines;
}

/** Read each call's `call.score` from the end of its log. */
async function judgedIn(door: Door, sessions: SessionLine[]): Promise<Judged[]> {
  const judged: Judged[] = [];
  for (const line of sessions) {
    // Start just below the last seq so each call costs a one-entry page.
    const entries = await entriesOf(door, line.call, {
      after: Math.max(0, line.last_seq - 1),
      types: ["call.score"],
      limit: 4,
    });
    judged.push({ call: line.call, at: line.ended_at ?? 0, score: theScoreIn(entries) });
  }
  return judged;
}

// An absent `passed` means not judged, not failed; such calls are counted separately.
function wasJudged(judged: Judged): boolean {
  return judged.score !== null && judged.score.passed !== null && judged.score.passed !== undefined;
}

function namesIn(judged: Judged): string[] {
  return (judged.score?.judges ?? []).map((judgment) => judgment.name);
}

function rowFor(judge: string, now: Judged[], before: Judged[]): JudgeDrift {
  const [held, was] = [rateOf(judge, now), rateOf(judge, before)];
  const delta = held !== null && was !== null ? held.percent - was.percent : null;
  return { judge, before: was, now: held, delta };
}

// Held over settled: `deferred` and `skipped` are excluded, not counted as failures.
function rateOf(judge: string, judged: Judged[]): Rate | null {
  const verdicts = judged
    .flatMap((one) => one.score?.judges ?? [])
    .filter((judgment) => judgment.name === judge)
    .map((judgment) => judgment.verdict);
  const settled = verdicts.filter((verdict) => verdict === "held" || verdict === "broken").length;
  if (settled === 0) return null;
  const held = verdicts.filter((verdict) => verdict === "held").length;
  return { held, settled, percent: (held / settled) * 100 };
}

// Input is already newest first; stop after NAMED calls.
function brokenIn(judged: Judged[]): Broke[] {
  const broke: Broke[] = [];
  for (const one of judged) {
    const faults = (one.score?.judges ?? []).filter((judgment) => judgment.verdict === "broken");
    if (faults.length === 0) continue;
    if (broke.some((named) => named.call === one.call)) continue;
    for (const fault of faults) {
      broke.push({ call: one.call, judge: fault.name, seqs: fault.evidence.seqs, reason: fault.reason });
    }
    if (new Set(broke.map((named) => named.call)).size >= NAMED) break;
  }
  return broke;
}

function rowAs(row: JudgeDrift, width: number): string {
  const delta = row.delta === null ? "     —" : `${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(1)}`;
  return `  ${row.judge.padEnd(width)}  ${percentAs(row.before)} → ${percentAs(row.now)}  ${delta.padStart(6)} points  ${countsAs(row)}`;
}

function percentAs(rate: Rate | null): string {
  return (rate === null ? "—" : `${rate.percent.toFixed(1)}%`).padStart(6);
}

function countsAs(row: JudgeDrift): string {
  const said = (rate: Rate | null): string => (rate === null ? "nothing" : `${rate.held}/${rate.settled}`);
  return `(${said(row.now)} held, was ${said(row.before)})`;
}

/** Parse a window like `90m`, `24h` or `7d` into seconds; null if invalid. */
export function secondsOf(said: string): number | null {
  const written = /^(\d+)([smhd])$/.exec(said);
  if (written === null) return null;
  const sizes: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(written[1]) * (sizes[written[2] ?? "s"] ?? 1);
}

// Format seconds in the largest whole unit.
function secondsAs(seconds: number): string {
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60]] as const) {
    if (seconds % size === 0) return `${seconds / size}${unit}`;
  }
  return `${seconds}s`;
}
