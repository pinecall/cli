/** A `call.score` entry: found in a call's log, and rendered as a verdict per judge and the judging cost. */

import { type Judgment } from "@pinecall/agents/wire";
import { type CallScore } from "@pinecall/agents/wire";

import type { Entry } from "./gateway.js";

// Verdict marks, shared with the matrix report.
export const HELD = "✓";
export const BROKEN = "✗";
const DEFERRED = "?";
const SKIPPED = "·";

// LiveKit's three verdicts plus our `skipped`.
const MARK: Record<string, string> = {
  held: HELD,
  broken: BROKEN,
  deferred: DEFERRED,
  skipped: SKIPPED,
};

// An absent `passed` means the call was not judged; it must read as neither pass nor fail.
const NOBODY_JUDGED = "nobody judged this call";

const NO_REASON = "no reason was written down";

/** The last `call.score` in a call's log, or null. */
export function theScoreIn(entries: Entry[]): CallScore | null {
  const found = entries.filter((entry) => entry.type === "call.score").at(-1);
  return found === undefined ? null : (found.data as unknown as CallScore);
}

/** The judge's reason, or a placeholder when empty. */
export function reasonOf(said: { reason: string }): string {
  return said.reason === "" ? NO_REASON : said.reason;
}

/** The score as printed: headline, one line per judge, then cost. */
export function linesOfScore(score: CallScore): string[] {
  return [headline(score), ...score.judges.map(oneJudge), costLine(score)];
}

// Three states: passed, failed, or not judged (with the entry's reason).
function headline(score: CallScore): string {
  if (score.passed === undefined || score.passed === null) {
    return `${SKIPPED} ${NOBODY_JUDGED}: ${score.not_judged ?? "the entry says nothing about why"}`;
  }
  return `${score.passed ? HELD : BROKEN} ${score.passed ? "every judge held" : "a judge answered broken"}`;
}

function oneJudge(judgment: Judgment): string {
  const seqs = judgment.evidence.seqs;
  const at = seqs.length === 0 ? "" : `  [seq ${seqs.join(", ")}]`;
  return `  ${MARK[judgment.verdict] ?? SKIPPED} ${judgment.name.padEnd(10)} ${reasonOf(judgment)}${at}`;
}

// An unknown cost is omitted, not printed as zero.
function costLine(score: CallScore): string {
  const asked = score.judge_calls;
  const priced =
    score.judge_cost_usd === undefined || score.judge_cost_usd === null
      ? ""
      : ` · $${score.judge_cost_usd.toFixed(4)}`;
  return `  ${asked} judge call${asked === 1 ? "" : "s"}${priced}`;
}
