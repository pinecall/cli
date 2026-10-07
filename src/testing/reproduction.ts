/** Reproduction files for failing goldens: the LLM requests, the log and the verdicts. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Cell, Entry, EvalRun } from "./gateway.js";
import type { Golden } from "./goldens.js";

/** Output directory, relative to where the suite ran; one folder per run. */
export const REPRODUCTIONS = ".pinecall/evals";

/** Placeholder for `asked` when requests were not recorded. */
export const NOT_RECORDED =
  "not recorded: this call's requests were built in the worker process, which a spoken run " +
  "drives over LiveKit. The log below is the whole of what this call left behind.";

/**
 * Write one file per failing cell (golden, requests, call log, verdicts) and return the paths.
 * The prompt text appears only here: the log stores hashes of prompt blocks.
 */
export function writtenOut(
  run: EvalRun,
  goldens: Golden[],
  logs: Record<string, Entry[]>,
  under: string = REPRODUCTIONS,
): string[] {
  const broken = (run.matrix?.runs ?? []).filter((cell) => cell.scores.some((score) => !score.passed));
  if (broken.length === 0) return [];
  const folder = join(under, run.id);
  mkdirSync(folder, { recursive: true });
  // Include the model in the file name when several failed, or one overwrites the other.
  const models = new Set(broken.map((cell) => cell.model));
  return broken.map((cell) => {
    const call = callOf(run, cell);
    const path = join(folder, `${fileNameOf(cell, models.size > 1)}.json`);
    writeFileSync(path, `${JSON.stringify(aReproduction(run, cell, call, goldens, logs[call] ?? []), null, 2)}\n`);
    return path;
  });
}

/** File name for a cell: the golden, plus the model (slashes replaced) when several models failed. */
export function fileNameOf(cell: Pick<Cell, "golden" | "model">, severalModels: boolean): string {
  return severalModels ? `${cell.golden} · ${cell.model.replace(/[/\\]/g, "-")}` : cell.golden;
}

/** The reproduction file's contents. */
function aReproduction(
  run: EvalRun,
  cell: Cell,
  call: string,
  goldens: Golden[],
  log: Entry[],
): Record<string, unknown> {
  return {
    run: run.id,
    agent: run.agent,
    golden: cell.golden,
    model: cell.model,
    call,
    declared: goldens.find((one) => one.name === cell.golden) ?? null,
    verdicts: cell.scores.map((score) => ({
      metric: score.metric,
      passed: score.passed,
      criteria: score.criteria,
      reason: score.reason,
    })),
    // One per request, in order. Null (spoken runs) becomes a sentence, not `[]`, which would read
    // as "no tools ran".
    asked: cell.asked ?? NOT_RECORDED,
    log,
  };
}

/** Summary line naming the reproductions folder. */
export function whereTheyAre(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const folder = dirname(paths[0]!);
  return [`  ${paths.length} reproduction${paths.length === 1 ? "" : "s"} written to ${folder}/`];
}

/** The call id for a cell. */
function callOf(run: EvalRun, cell: Cell): string {
  return run.calls.find((one) => one.golden === cell.golden && one.model === cell.model)?.call ?? "";
}

