/** Run a golden suite against the agent a process serves (CLI and console), scored by the gateway. */

import { type ModelConfig } from "@pinecall/agents/wire";
import { type Camel } from "@pinecall/agents/wire";

import type { Served } from "../serving.js";
import { aRun, entriesOf, Refused, theRuns, type Door, type Entry, type EvalRun, type Wanted } from "./gateway.js";
import type { Golden } from "./goldens.js";
import { mediansOf } from "./latency.js";
import { reportOf, type Latencies } from "./matrix.js";
import { followed } from "./progress.js";
import { whereTheyAre, writtenOut } from "./reproduction.js";

// Shown on a 409 (one run per agent at a time).
const BUSY = "a run is already going on {agent} ({id}) — pinecall runs show {id} to watch it";

// The column of the agent's own model: what its settings name, which this side never reads.
const DECLARED = "the app's own model";

/** Everything needed to run one suite. */
export interface Suite {
  door: Door;
  /** The agent, and the process the run's calls are served by. */
  served: Served;
  goldens: Golden[];
  models: Camel<ModelConfig>[];
  /** Ring 2 fields for a spoken suite; empty for a written one. */
  line: Partial<Wanted>;
  out: NodeJS.WritableStream;
  json: boolean;
}

/**
 * Run the suite, show progress, write reproductions and print the report.
 * @returns Exit code: 1 if any golden failed or the gateway was busy.
 */
export async function ranSuite(suite: Suite): Promise<number> {
  const { door, served, goldens, models, out } = suite;
  const app = served.app();
  const pending = aRun(door, {
    agent: served.slug,
    goldens,
    ...(models.length > 0 ? { models } : {}),
    ...(app === undefined ? {} : { app }),
    ...suite.line,
  });
  const watched = {
    agent: served.slug,
    goldens: goldens.length,
    models: models.length > 0 ? models.map((model) => `${model.provider}/${model.model}`) : [DECLARED],
    declaredAs: DECLARED,
  };
  let run: EvalRun;
  try {
    run = await followed(door, watched, pending, out, suite.json);
  } catch (refused) {
    if (!(refused instanceof Refused) || refused.status !== 409) throw refused;
    process.stderr.write(`${await busy(door, served.slug, refused)}\n`);
    return 1;
  }
  return await reported(door, run, goldens, DECLARED, suite.json, out);
}

/** A finished run as data: the run, each call's latency medians, and the reproductions written for what broke. */
export interface Report {
  run: EvalRun;
  latencies: Latencies;
  reproductions: string[];
}

/** Read every call's log once, measure its turns, and write a reproduction for each golden that broke. */
export async function reportOfTheRun(door: Door, run: EvalRun, goldens: Golden[]): Promise<Report> {
  const logs = await logsOf(door, run);
  const latencies: Latencies = {};
  for (const [call, entries] of Object.entries(logs)) latencies[call] = mediansOf(entries);
  return { run, latencies, reproductions: writtenOut(run, goldens, logs) };
}

/** Whether every golden held. */
export function held(run: EvalRun): boolean {
  return run.status === "done" && (run.matrix?.failures.length ?? 0) === 0;
}

/** Print the report; returns 1 if any golden failed. */
async function reported(
  door: Door,
  run: EvalRun,
  goldens: Golden[],
  declaredAs: string,
  asJson: boolean,
  out: NodeJS.WritableStream,
): Promise<number> {
  const report = await reportOfTheRun(door, run, goldens);
  if (asJson) out.write(`${JSON.stringify(report)}\n`);
  else out.write(`${[...reportOf(run, report.latencies, declaredAs), ...whereTheyAre(report.reproductions)].join("\n")}\n`);
  return held(run) ? 0 : 1;
}

// Each call's log by call id; per-turn metrics are only in the log.
async function logsOf(door: Door, run: EvalRun): Promise<Record<string, Entry[]>> {
  const logs: Record<string, Entry[]> = {};
  for (const opened of run.calls) logs[opened.call] = await entriesOf(door, opened.call);
  return logs;
}

// Look up this agent's running run; the org's newest run may belong to another agent.
async function busy(door: Door, agent: string, refused: Refused): Promise<string> {
  const newest = (await theRuns(door, 1, agent))[0];
  if (newest?.status !== "running") return refused.message;
  return BUSY.replaceAll("{id}", newest.id).replace("{agent}", agent);
}
