/** `runs list`, `runs show` and `runs diff`. */

import { entriesOf, oneRun, theRuns, type Cell, type Door, type EvalRun } from "../testing/gateway.js";
import { mediansOf } from "../testing/latency.js";
import { DECLARED, reportOf, type Latencies } from "../testing/matrix.js";
import { reasonOf } from "../testing/score.js";

/** Default number of runs `list` prints. */
export const DEFAULT_LIMIT = 20;

/** Print one line per run, newest first. */
export async function listed(
  door: Door,
  limit: number,
  asJson: boolean,
  out: NodeJS.WritableStream,
): Promise<number> {
  const runs = await theRuns(door, limit);
  if (asJson) {
    out.write(`${JSON.stringify({ runs })}\n`);
    return 0;
  }
  out.write(`${runs.map(lineOf).join("\n")}\n`);
  return 0;
}

/** Print one run as `pinecall test` reported it. */
export async function shown(
  door: Door,
  id: string,
  asJson: boolean,
  out: NodeJS.WritableStream,
): Promise<number> {
  const run = await oneRun(door, id);
  if (asJson) {
    out.write(`${JSON.stringify(run)}\n`);
    return 0;
  }
  const latencies: Latencies = {};
  for (const opened of run.calls) latencies[opened.call] = mediansOf(await entriesOf(door, opened.call));
  out.write(`${reportOf(run, latencies, DECLARED).join("\n")}\n`);
  return run.matrix !== null && run.matrix.failures.length > 0 ? 1 : 0;
}

/** Print only the scores that changed between two runs; returns 1 if any became broken. */
export async function diffed(
  door: Door,
  before: string,
  after: string,
  asJson: boolean,
  out: NodeJS.WritableStream,
): Promise<number> {
  const [was, now] = [await oneRun(door, before), await oneRun(door, after)];
  const moved = movedBetween(was, now);
  const broke = moved.some((line) => line.includes(`→ ${BROKEN}`));
  if (asJson) {
    out.write(`${JSON.stringify({ before, after, moved: moved.map((line) => line.trim()) })}\n`);
    return broke ? 1 : 0;
  }
  out.write(`${[`${before} → ${after}`, ...(moved.length > 0 ? moved : ["  nothing moved"])].join("\n")}\n`);
  return broke ? 1 : 0;
}

/** Labels on either side of a diff arrow. */
const HELD = "held";
const BROKEN = "broken";
const UNMEASURED = "not measured";

/**
 * Scores whose result changed between two runs. A score new in `now` is listed only if broken, so
 * new failures still show when no cells match the older run.
 */
export function movedBetween(was: EvalRun, now: EvalRun): string[] {
  const lines: string[] = [];
  for (const cell of now.matrix?.runs ?? []) {
    const before = cellIn(was, cell.model, cell.golden);
    for (const score of cell.scores) {
      const older = before?.scores.find((one) => one.metric === score.metric);
      if (older === undefined) {
        if (score.passed) continue;
        lines.push(`  ${cell.golden}  ${score.metric}  ${UNMEASURED} → ${BROKEN}  ${reasonOf(score)}`);
        continue;
      }
      if (older.passed === score.passed) continue;
      const way = older.passed ? `${HELD} → ${BROKEN}` : `${BROKEN} → ${HELD}`;
      lines.push(`  ${cell.golden}  ${score.metric}  ${way}  ${reasonOf(score)}`);
    }
  }
  // Scores the newer run no longer measures, so a removed golden does not look like a fix.
  for (const cell of was.matrix?.runs ?? []) {
    const after = cellIn(now, cell.model, cell.golden);
    for (const score of cell.scores) {
      if (after?.scores.some((one) => one.metric === score.metric) === true) continue;
      lines.push(`  ${cell.golden}  ${score.metric}  ${score.passed ? HELD : BROKEN} → ${UNMEASURED}`);
    }
  }
  return lines;
}

function cellIn(run: EvalRun, model: string, golden: string): Cell | undefined {
  return run.matrix?.runs.find((one) => one.model === model && one.golden === golden);
}

// Id first, for `runs show <id>`.
function lineOf(run: EvalRun): string {
  const when = new Date(run.started_at * 1000).toISOString().slice(0, 19).replace("T", " ");
  const cells = run.matrix?.runs.length ?? run.calls.length;
  const broken = new Set((run.matrix?.failures ?? []).map((one) => `${one.model} ${one.golden}`)).size;
  return `${run.id}  ${when}  ${run.agent.padEnd(16)}  ${run.status.padEnd(7)}  ${cells - broken}/${cells}`;
}
