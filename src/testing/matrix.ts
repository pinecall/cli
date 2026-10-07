/** Text report of a finished run: one line per golden, details under failures. */

import type { Cell, EvalRun, Matrix, Score } from "./gateway.js";
import { latencyLine, type Medians } from "./latency.js";
import { BROKEN, HELD, reasonOf } from "./score.js";

// The runner's model name for "whatever the agent declared"; the report shows the declared model instead.
export const DECLARED = "declared";

/** Latency medians by call id. */
export type Latencies = Record<string, Medians>;

/** Render the report. `declaredAs` is the agent's declared model, shown in place of `DECLARED`. */
export function reportOf(run: EvalRun, latencies: Latencies, declaredAs: string): string[] {
  const matrix = run.matrix;
  if (matrix === null) return [`${run.agent}  ${run.status}${run.error === null ? "" : `: ${run.error}`}`];
  const models = matrix.models.map((model) => named(model, declaredAs));
  const counted = `${matrix.goldens.length} golden${matrix.goldens.length === 1 ? "" : "s"}`;
  const lines = [`${run.agent} · ${counted} · ${models.join(" · ")}`];
  // Group by model only when comparing several.
  const compared = matrix.models.length > 1;
  for (const model of matrix.models) {
    if (compared) lines.push(`  ${named(model, declaredAs)}`);
    for (const cell of matrix.runs.filter((one) => one.model === model)) {
      lines.push(...linesOfCell(cell, callOf(run, cell), latencies, compared));
    }
  }
  lines.push(...divergences(matrix, declaredAs), footer(run, matrix));
  // A failed run keeps its partial matrix; print the error so the count is not read as complete.
  if (run.error !== null) lines.push(`  ${run.error}`);
  return lines;
}

/** Total provider cost of the run's calls, from each `call.summary`. */
function callCost(matrix: Matrix): number {
  return matrix.runs.reduce((total, cell) => total + (cell.summary?.cost?.usd ?? 0), 0);
}

// A passing golden is one line; a failing one adds a line per broken judge and the call id.
function linesOfCell(cell: Cell, call: string, latencies: Latencies, indented: boolean): string[] {
  const pad = indented ? "    " : "  ";
  const broken = cell.scores.filter((score) => !score.passed);
  const measured = latencyLine(latencies[call] ?? {});
  if (broken.length === 0) {
    return [`${pad}${HELD} ${cell.golden}${measured === "" ? "" : `  ${measured}`}`];
  }
  const width = Math.max(...broken.map((score) => score.metric.length), "log".length);
  return [
    `${pad}${BROKEN} ${cell.golden}`,
    ...broken.map((score) => `${pad}      ${score.metric.padEnd(width)}  broken   ${reasonOf(score)}`),
    `${pad}      ${"log".padEnd(width)}           ${call}`,
  ];
}

// Goldens and metrics where models disagree.
function divergences(matrix: Matrix, declaredAs: string): string[] {
  if (matrix.models.length < 2) return [];
  const lines: string[] = [];
  for (const golden of matrix.goldens) {
    for (const metric of matrix.metrics) {
      const known = matrix.models
        .map((model) => ({ model, score: scoreAt(matrix, model, golden, metric) }))
        .filter((one) => one.score !== undefined);
      if (known.length < 2) continue;
      if (new Set(known.map((one) => one.score!.passed)).size === 1) continue;
      const said = known
        .map((one) => `${one.score!.passed ? HELD : BROKEN} ${named(one.model, declaredAs)}`)
        .join("   ");
      lines.push(`      ${golden}  ${metric}  ${said}`);
    }
  }
  return lines.length === 0 ? [] : ["  divergences", ...lines];
}

// Passed/total, judge calls, cost and duration.
function footer(run: EvalRun, matrix: Matrix): string {
  const cells = matrix.runs.length;
  const held = cells - new Set(matrix.failures.map((one) => `${one.model} ${one.golden}`)).size;
  const seconds = Math.round((run.finished_at ?? run.started_at) - run.started_at);
  const cost = callCost(matrix).toFixed(4);
  const asked = matrix.judge_calls;
  return `  ${held}/${cells} · ${asked} judge call${asked === 1 ? "" : "s"} · $${cost} · ${seconds}s`;
}

function scoreAt(matrix: Matrix, model: string, golden: string, metric: string): Score | undefined {
  const cell = matrix.runs.find((one) => one.model === model && one.golden === golden);
  return cell?.scores.find((one) => one.metric === metric);
}

function callOf(run: EvalRun, cell: Cell): string {
  const opened = run.calls.find((one) => one.golden === cell.golden && one.model === cell.model);
  return opened?.call ?? "";
}

function named(model: string, declaredAs: string): string {
  return model === DECLARED ? declaredAs : model;
}
