/** A `call.score` entry: found in a call's log, and rendered as a verdict per judge and the judging cost. */

import { type Judgment } from "@pinecall/agents/wire";
import { type CallScore } from "@pinecall/agents/wire";

import type { Entry } from "./gateway.js";

// Verdict marks, shared with the matrix report.
export const HELD = "✓";
export const BROKEN = "✗";
const DEFERRED = "?";
const SKIPPED = "·";
const NOT_APPLICABLE = "–";
const CLASSIFIED = "=";

// LiveKit's three verdicts, and ours: never asked, did not apply, a choice or a score.
const MARK: Record<string, string> = {
  held: HELD,
  broken: BROKEN,
  deferred: DEFERRED,
  skipped: SKIPPED,
  na: NOT_APPLICABLE,
  classified: CLASSIFIED,
};

// A judgment's word as a person reads it; a classification is its choice or its score.
const WORD: Record<string, string> = { na: "n/a" };

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

// Four states: passed, failed, judged with no verdict (only N/A and classifications), or not judged.
function headline(score: CallScore): string {
  if (score.passed === undefined || score.passed === null) {
    if (score.judges.some((judgment) => judgment.verdict === "na" || judgment.verdict === "classified")) {
      return `${NOT_APPLICABLE} no judge held or broke: the rest classified the call or did not apply`;
    }
    return `${SKIPPED} ${NOBODY_JUDGED}: ${score.not_judged ?? "the entry says nothing about why"}`;
  }
  return `${score.passed ? HELD : BROKEN} ${score.passed ? "every judge held" : "a judge answered broken"}`;
}

// A verdict reads as its reason; a classification and an N/A say what they answered first.
function oneJudge(judgment: Judgment): string {
  const answered = judgment.verdict === "classified" || judgment.verdict === "na" ? `${wordOf(judgment)}: ` : "";
  return `  ${MARK[judgment.verdict] ?? SKIPPED} ${judgment.name.padEnd(10)} ${answered}${reasonOf(judgment)}${seqsOf(judgment)}`;
}

/** One judgment as a line: its mark, what it answered (a word, a choice, a score out of 5), its reason, the seqs it cites. */
export function answerOf(judgment: Judgment): string {
  return `${MARK[judgment.verdict] ?? SKIPPED} ${wordOf(judgment)}  ${reasonOf(judgment)}${seqsOf(judgment)}`;
}

function seqsOf(judgment: Judgment): string {
  const seqs = judgment.evidence.seqs;
  return seqs.length === 0 ? "" : `  [seq ${seqs.join(", ")}]`;
}

function wordOf(judgment: Judgment): string {
  if (judgment.choice !== undefined && judgment.choice !== null) return judgment.choice;
  if (judgment.score !== undefined && judgment.score !== null) return `${judgment.score}/5`;
  return WORD[judgment.verdict] ?? judgment.verdict;
}

// An unknown cost is omitted, not printed as zero; evals on the org's own key are never billed.
function costLine(score: CallScore): string {
  const asked = score.judge_calls;
  const evals = score.evals ?? 0;
  const priced =
    score.judge_cost_usd === undefined || score.judge_cost_usd === null
      ? ""
      : ` · $${score.judge_cost_usd.toFixed(4)}`;
  const billed = score.own_key === true ? " · own key: evals not billed" : "";
  return `  ${asked} judge call${asked === 1 ? "" : "s"} · ${evals} eval${evals === 1 ? "" : "s"}${priced}${billed}`;
}
