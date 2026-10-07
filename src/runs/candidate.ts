/** `pinecall runs promote`: turn a real call into a golden candidate derived from its verdicts. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Judgment } from "@pinecall/agents/wire";
import { type CallScore } from "@pinecall/agents/wire";

import { entriesOf, type Door, type Entry } from "../testing/gateway.js";
import type { Expect, Golden } from "../testing/goldens.js";

/** Default output directory for promoted candidates. */
export const CANDIDATES = "test/candidates";

/** Promote options: name, output directory, and the seq to cut the call at. */
export interface Promotion {
  name?: string;
  out: string;
  fromSeq: number;
}

/** Error for a call with no verdict. */
export const NOT_JUDGED = "was not judged, so there is no verdict to write an expect from";

/**
 * Note for a broken `consent`. The tool goes in `expect.not_tools` (checked against the log), not
 * `expect.not` (checked against words, which would pass on the same break).
 */
export const CONSENT_BANS_THE_TOOL =
  "consent broke, so the tool that ran unasked is in expect.not_tools: keep it only if this call must never call it at all — the order itself is the runtime's own policy over state and input";

/**
 * Write a call as a golden candidate (state, caller turns, `expect` from the verdicts) and print it.
 * Candidates carry `promoted_from` and need review before use as goldens.
 */
export async function promoted(
  door: Door,
  call: string,
  wanted: Promotion,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream = process.stderr,
  asJson = false,
): Promise<number> {
  let written: Written;
  try {
    written = await promotedTo(door, call, wanted);
  } catch (refused) {
    err.write(`${refused instanceof Error ? refused.message : String(refused)}\n`);
    return 1;
  }
  out.write(asJson ? `${JSON.stringify(written)}\n` : `${linesOf(written, wanted.fromSeq).join("\n")}\n`);
  return 0;
}

/** A promoted call: file path, candidate, and review notes. */
export interface Written {
  path: string;
  candidate: Golden;
  notes: string[];
}

/** Write the candidate file; used by both the CLI verb and the console. */
export async function promotedTo(door: Door, call: string, wanted: Promotion): Promise<Written> {
  const entries = await entriesOf(door, call);
  if (entries.length === 0) throw new Error(`no log for call ${call} on this gateway`);
  const score = theScoreIn(entries);
  if (score === null || score.passed === null || score.passed === undefined) {
    throw new Error(`${call} ${NOT_JUDGED}: ${whyNobodyJudged(score)}`);
  }
  const candidate = candidateOf(call, entries, wanted.fromSeq, score, wanted.name);
  await mkdir(wanted.out, { recursive: true });
  const path = join(wanted.out, `${candidate.name}.json`);
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return { path, candidate, notes: notesOn(score, candidate.expect ?? {}) };
}

/** Output lines for a promotion. */
export function linesOf(written: Written, fromSeq: number): string[] {
  return [`${written.path}  ${written.candidate.input.length} caller turn(s) from seq ${fromSeq}`, ...written.notes];
}

/**
 * Build a golden from the state at `fromSeq` and every caller turn after it. `state.changed` holds
 * the full state, so the last one at or before the cut is enough.
 */
export function candidateOf(
  call: string,
  entries: Entry[],
  fromSeq: number,
  score: CallScore,
  name?: string,
): Golden {
  const state = entries
    .filter((entry) => entry.type === "state.changed" && entry.seq <= fromSeq)
    .at(-1)?.data["state"];
  return {
    name: name ?? call,
    promoted_from: call,
    ...(typeof state === "object" && state !== null ? { state: state as Record<string, unknown> } : {}),
    input: entries
      .filter((entry) => entry.type === "turn.user" && entry.seq > fromSeq)
      .map((entry) => String(entry.data["text"] ?? "")),
    expect: expectOf(score, entries),
  };
}

/**
 * Derive `expect` from broken verdicts. Only `grounded` and `consent` map to fields; other judges
 * are reported as notes.
 */
export function expectOf(score: CallScore, entries: Entry[]): Expect {
  const expect: Expect = {};
  for (const judgment of broken(score)) {
    if (judgment.name === "grounded") expect.grounded = true;
    if (judgment.name === "consent") {
      const banned = toolsAt(judgment.evidence.seqs, entries);
      if (banned.length > 0) expect.not_tools = banned;
    }
  }
  return expect;
}

/** The last `call.score` in the log, or null. */
export function theScoreIn(entries: Entry[]): CallScore | null {
  const found = entries.filter((entry) => entry.type === "call.score").at(-1);
  return found === undefined ? null : (found.data as unknown as CallScore);
}

function broken(score: CallScore): Judgment[] {
  return score.judges.filter((judgment) => judgment.verdict === "broken");
}

// Consent cites two seqs (the tool call and the late confirmation); pick by entry type, not order.
function toolsAt(seqs: number[], entries: Entry[]): string[] {
  const named = entries
    .filter((entry) => entry.type === "tool.call" && seqs.includes(entry.seq))
    .map((entry) => String(entry.data["name"] ?? ""));
  return [...new Set(named.filter((name) => name !== ""))];
}

// Review notes go to stdout so the file stays a valid golden.
function notesOn(score: CallScore, expect: Expect): string[] {
  const notes: string[] = [];
  for (const judgment of broken(score)) {
    notes.push(`  ${judgment.name} broke: ${judgment.reason}`);
  }
  if (expect.not_tools !== undefined) notes.push(`  ${CONSENT_BANS_THE_TOOL}`);
  if (notes.length === 0) notes.push("  nothing broke: write what this call must keep doing");
  return notes;
}

// Prefer the entry's own `not_judged` reason; older logs have no `call.score` at all.
function whyNobodyJudged(score: CallScore | null): string {
  if (score === null) return "its log carries no call.score at all";
  return score.not_judged ?? "the entry says nothing about why";
}
