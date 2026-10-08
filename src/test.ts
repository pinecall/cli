/** `pinecall test [paths]`: run goldens through the agent served from this terminal, scored by the gateway. */

import { existsSync, watch } from "node:fs";
import { parseArgs } from "node:util";

import { whileServing } from "./child.js";
import { modelOf } from "./testing/models.js";
import { theDoor, type Open } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, hasDirectory, homesFor, type Home } from "./home.js";
import { inspectOf, servingOne } from "./language.js";
import type { Served } from "./serving.js";
import type { Wanted } from "./testing/gateway.js";
import { GOLDENS, goldensIn, matching, NO_GOLDENS } from "./testing/goldens.js";
import { ranSuite } from "./testing/suite.js";
import { packetLossOf } from "./testing/voice.js";

const USAGE =
  "usage: pinecall test [paths] [--agent <name>] [--file agent.tsx] [--model m]… [--grep x] [--watch] [--json]\n" +
  "                    [--inspect[=host:port] | --inspect-brk]\n" +
  "       pinecall test --voice [--background-noise dB] [--packet-loss 0.05]\n";

export const group: Group = {
  purpose: "the goldens, run through the agent served from this terminal",
  usage: `${USAGE}
  Ring 1: every golden of test/goldens through the agent a process this terminal starts serves,
  scored by the gateway's judges, printed as a matrix. Exits 1 when a golden did not hold, and writes every
  broken one to .pinecall/evals/<run>/ with the requests the model answered.

  [paths]             files or directories of goldens; the whole of test/goldens when none
  --file agent.tsx    which class to serve, when the directory holds more than one
  --model m           a column of the matrix: vendor/model, repeatable
  --grep x            only the goldens whose name matches
  --watch             run again whenever a file changes
  --json              the run as one JSON document instead of the matrix
  --voice             ring 2: the same goldens said out loud on a real line
  --background-noise  dB under the caller, on a spoken run: a television behind them
  --packet-loss       the share of the caller's packets that never arrive, 0 to 1; a percent is refused
  --inspect           Node's own flag, given to the agent's process (a TypeScript agent's alone)`,
  run,
};

// Ring 2 (spoken) fields; a written run sends none of them, not even `voice: false`.
function aLine(values: { voice?: boolean; "background-noise"?: string; "packet-loss"?: string }): Partial<Wanted> {
  if (values.voice !== true) return {};
  const noise = numberOf(values["background-noise"]);
  return {
    voice: true,
    ...(noise === undefined ? {} : { interferer_db: noise }),
    ...(values["packet-loss"] === undefined ? {} : { packet_loss: packetLossOf(values["packet-loss"]) }),
  };
}

/** Parse a numeric flag; non-numbers are dropped rather than sent as NaN. */
function numberOf(said: string | undefined): number | undefined {
  if (said === undefined) return undefined;
  const value = Number(said);
  return Number.isFinite(value) ? value : undefined;
}

// Debounce for --watch; each run costs real calls.
const SETTLE_MS = 150;

/** The flags of one run that reach the suite. */
type Asked = Parameters<typeof aLine>[0] & { grep?: string | undefined; model?: string[] | undefined; json?: boolean | undefined };

/**
 * Serve the agent from a process this terminal starts, as `pinecall chat` does, so @tool bodies run
 * here and can be debugged; the gateway drives and scores the conversations. The suite is
 * `testing/suite.ts`.
 */
export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const { inspect, rest } = inspectOf(argv);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      ...AGENT_FLAG,
      model: { type: "string", multiple: true },
      grep: { type: "string" },
      watch: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      voice: { type: "boolean", default: false },
      "background-noise": { type: "string" },
      "packet-loss": { type: "string" },
    },
  });
  const door = await theDoor();
  if (door === undefined) return 2;
  // Multi-agent project: run each agent's goldens in turn; exit with the worst code.
  const homes = await homesFor(values.file, values.agent);
  if (homes.length > 1) {
    if (positionals.length > 0 || values.watch === true) {
      process.stderr.write(`paths and --watch are for one agent: add --agent ${homes.map((home) => home.name).join(" or --agent ")}\n`);
      return 2;
    }
    let worst = 0;
    for (const home of homes) {
      if (!hasDirectory(home.goldens)) {
        out.write(`${home.name} · no goldens at ${home.goldens}\n`);
        continue;
      }
      worst = Math.max(worst, await served(door, home, inspect, (agent) => suiteOf(agent, [home.goldens], door, values, out)));
    }
    return worst;
  }
  const home = homes[0]!;
  const paths = positionals.length > 0 ? positionals : [home.goldens];
  if (positionals.length === 0 && !existsSync(home.goldens)) {
    process.stderr.write(`${NO_GOLDENS.replace(GOLDENS, home.goldens)}\n${USAGE}`);
    return 2;
  }
  return await served(door, home, inspect, async (agent) => {
    if (values.watch !== true) return await suiteOf(agent, paths, door, values, out);
    await suiteOf(agent, paths, door, values, out);
    return await watching(paths, () => suiteOf(agent, paths, door, values, out), out);
  });
}

// A console's process: a run names its app, and a real call never rings in a terminal running one.
async function served(door: Open, home: Home, inspect: string[], use: (agent: Served) => Promise<number>): Promise<number> {
  return await whileServing(servingOne(door, home, { console: true, inspect }), home.name, use);
}

// Re-runs on golden changes only: node will not re-import the already loaded class.
async function watching(
  paths: string[],
  suite: () => Promise<number>,
  out: NodeJS.WritableStream,
): Promise<number> {
  const watched = paths.length > 0 ? paths : [GOLDENS];
  out.write(`watching ${watched.join(" ")} — restart to pick up a change to the class\n`);
  let running = false;
  let pending: NodeJS.Timeout | undefined;
  for (const path of watched) {
    watch(path, { recursive: true }, () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        if (running) return;
        running = true;
        void suite().finally(() => (running = false));
      }, SETTLE_MS);
    });
  }
  // Runs until ctrl-C.
  return await new Promise<number>(() => {});
}

/** Run the goldens under `paths` through the agent served. */
async function suiteOf(served: Served, paths: string[], door: Open, values: Asked, out: NodeJS.WritableStream): Promise<number> {
  const models = (values.model ?? []).map(modelOf).filter((model) => model !== undefined);
  const goldens = matching(await goldensIn(paths), values.grep);
  if (goldens.length === 0) {
    process.stderr.write(`no golden matched${values.grep === undefined ? "" : ` --grep ${values.grep}`}\n`);
    return 2;
  }
  return await ranSuite({ door, served, goldens, models, line: aLine(values), out, json: values.json === true });
}
