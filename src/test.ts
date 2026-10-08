/** `pinecall test [paths]`: run goldens, and the org's cases, through the agent served from this terminal, scored by the gateway. */

import { existsSync, watch } from "node:fs";
import { parseArgs } from "node:util";

import { whileServing, type Spawns } from "./child.js";
import { modelOf } from "./testing/models.js";
import { theDoor, type Open } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, hasDirectory, homesFor, type Home } from "./home.js";
import { inspectOf, servingOne } from "./language.js";
import type { Served } from "./serving.js";
import type { Played, Wanted } from "./testing/gateway.js";
import { GOLDENS, goldensIn, matching, NO_GOLDENS } from "./testing/goldens.js";
import { ranSuite } from "./testing/suite.js";
import { packetLossOf } from "./testing/voice.js";

const USAGE =
  "usage: pinecall test [paths] [--agent <name>] [--file agent.tsx] [--model m]… [--grep x] [--watch] [--json]\n" +
  "                    [--case <name>]… [--dataset] [--version n] [--inspect[=host:port] | --inspect-brk]\n" +
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
  --case <name>       a case of the org's dataset, by name, whatever its status (\`pinecall cases\`
                      lists them): a pending one is how the call that broke is reproduced. Repeatable
  --dataset           every case a person approved, not held out and not kept in the repository:
                      the nightly. With --case or --dataset and no paths, only the cases are played
                      and test/goldens is not read; with paths, both. Cases play in the sandbox only
  --version n         every call of the run on that version of the agent's settings instead of the
                      one standing: a candidate against what runs now
  --inspect           Node's own flag, given to the agent's process (a TypeScript agent's alone)

  Whose settings a run plays on is the key's: from a laptop, YOUR corner of the sandbox; in CI, a
  sandbox server token, the TEAM's. A settings fix only you have is green at your desk and red in
  CI until \`pinecall agent push --team\` (or \`agent set … --team\`) gives it to the team.`,
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

const NOT_A_VERSION = (said: string): string =>
  `--version ${said}: a version of the agent's settings is a whole number from 1, as \`pinecall agent history\` lists them`;

const NOTHING_TO_WATCH =
  "--watch runs again when a golden file changes, and a run of cases alone reads none: name the goldens to watch beside --case or --dataset";

const FOR_ONE_AGENT = (names: string[]): string =>
  `paths, --watch, --case and --version are for one agent: add --agent ${names.join(" or --agent ")}`;

/** The cases and the settings version the flags ask for, or the sentence refusing them. */
function playedOf(values: { case?: string[]; dataset?: boolean; version?: string }): Played | string {
  const version = values.version === undefined ? undefined : Number(values.version);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) return NOT_A_VERSION(values.version!);
  return {
    ...(values.case === undefined ? {} : { cases: [...new Set(values.case)] }),
    ...(values.dataset === true ? { dataset: true } : {}),
    ...(version === undefined ? {} : { version }),
  };
}

/** Whether a run plays any of the org's cases. */
function playsCases(played: Played): boolean {
  return played.cases !== undefined || played.dataset === true;
}

/** Output streams, the environment and the agent's process, for tests. */
export interface Testing {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  spawns?: Spawns;
}

/**
 * Serve the agent from a process this terminal starts, as `pinecall chat` does, so @tool bodies run
 * here and can be debugged; the gateway drives and scores the conversations. The suite is
 * `testing/suite.ts`.
 */
export async function run(argv: string[], how: Testing = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
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
      case: { type: "string", multiple: true },
      dataset: { type: "boolean", default: false },
      version: { type: "string" },
    },
  });
  const played = playedOf(values);
  if (typeof played === "string") {
    err.write(`${played}\n`);
    return 2;
  }
  // Cases and no paths: only the cases, and test/goldens is not read.
  const onlyCases = playsCases(played) && positionals.length === 0;
  if (onlyCases && values.watch === true) {
    err.write(`${NOTHING_TO_WATCH}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  // A console's process: a run names its app, and a real call never rings in a terminal running one.
  const served = (home: Home, use: (agent: Served) => Promise<number>): Promise<number> =>
    whileServing(servingOne(door, home, { console: true, inspect }), home.name, use, how.spawns);
  const suite = (agent: Served, paths: string[]): Promise<number> => suiteOf(agent, paths, door, values, played, out, err);
  // Multi-agent project: run each agent's goldens in turn; exit with the worst code.
  const homes = await homesFor(values.file, values.agent);
  if (homes.length > 1) {
    if (positionals.length > 0 || values.watch === true || played.cases !== undefined || played.version !== undefined) {
      err.write(`${FOR_ONE_AGENT(homes.map((home) => home.name))}\n`);
      return 2;
    }
    let worst = 0;
    for (const home of homes) {
      if (!onlyCases && !hasDirectory(home.goldens)) {
        out.write(`${home.name} · no goldens at ${home.goldens}\n`);
        continue;
      }
      worst = Math.max(worst, await served(home, (agent) => suite(agent, onlyCases ? [] : [home.goldens])));
    }
    return worst;
  }
  const home = homes[0]!;
  const paths = positionals.length > 0 ? positionals : onlyCases ? [] : [home.goldens];
  if (positionals.length === 0 && !onlyCases && !existsSync(home.goldens)) {
    err.write(`${NO_GOLDENS.replace(GOLDENS, home.goldens)}\n${USAGE}`);
    return 2;
  }
  return await served(home, async (agent) => {
    if (values.watch !== true) return await suite(agent, paths);
    await suite(agent, paths);
    return await watching(paths, () => suite(agent, paths), out);
  });
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

/** Run the goldens under `paths`, and the cases asked, through the agent served. */
async function suiteOf(
  served: Served,
  paths: string[],
  door: Open,
  values: Asked,
  played: Played,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const models = (values.model ?? []).map(modelOf).filter((model) => model !== undefined);
  // No paths is no goldens: `goldensIn([])` would read test/goldens.
  const goldens = paths.length === 0 ? [] : matching(await goldensIn(paths), values.grep);
  if (goldens.length === 0 && !playsCases(played)) {
    err.write(`no golden matched${values.grep === undefined ? "" : ` --grep ${values.grep}`}\n`);
    return 2;
  }
  return await ranSuite({ door, served, goldens, models, line: aLine(values), played, out, json: values.json === true });
}
