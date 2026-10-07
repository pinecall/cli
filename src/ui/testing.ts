/** Console door for goldens: list this directory's and start a run of the chosen ones. */

import { modelOf } from "../testing/models.js";

import { inFlight } from "../testing/progress.js";
import type { Door, Wanted as RunWanted } from "../testing/gateway.js";
import { goldensOf, type Golden } from "../testing/goldens.js";
import type { Home } from "../home.js";
import type { Served } from "../serving.js";
import { ranSuite } from "../testing/suite.js";
import { aFlag, anObject, aString, maybeNumber, names } from "./asked.js";
import { Refusal } from "./refusal.js";

/** Request body for starting a run. */
export interface Wanted {
  agent: string;
  goldens: string[];
  /** `vendor/model`, one per matrix column. Empty means the configured model. */
  models: string[];
  voice: boolean;
  /** Noise level in dB under the caller. Spoken runs only. */
  background_noise?: number | undefined;
  /** Packet loss ratio, 0 to 1. Spoken runs only. */
  packet_loss?: number | undefined;
}

/** A golden as the page lists it. */
export interface Listed {
  name: string;
  input: string[];
  expect: Record<string, unknown>;
}

/** The mounted agent and its goldens. */
export interface Roster {
  agent: string | null;
  goldens: Listed[];
}

/** Testing door as the console server uses it. */
export interface Testing {
  roster(): Promise<Roster>;
  start(wanted: unknown): Promise<{ run: string }>;
}

/** Injectable parts of a run, replaceable in tests. */
export interface Pieces {
  goldens: () => Promise<Golden[]>;
  /** Run the goldens against the agent this `pinecall start` serves; resolves to the exit code. */
  suite: (
    door: Door,
    goldens: Golden[],
    models: string[],
    line: Partial<RunWanted>,
    out: NodeJS.WritableStream,
  ) => Promise<number>;
  /** Id of the agent's in-flight run, if any. */
  running: (door: Door, agent: string) => Promise<string | undefined>;
}

// The run's row is written before the first call, so this only covers the gateway taking the run.
const A_RUN_OPENS_WITHIN_MS = 20_000;
const A_LOOK_EVERY_MS = 250;

const NOT_THIS_DIRECTORY = (asked: string, here: string | null): string =>
  here === null
    ? `no agent class in this directory: run \`pinecall start\` where ${asked}'s agent.tsx is`
    : `this process runs in ${here}'s directory: to run ${asked}'s goldens, run \`pinecall start\` there`;

const ONLY_ON_A_LINE = "background noise and packet loss are about audio: a spoken run";
const NO_RUN = "the suite ended before the gateway opened a run";

/**
 * Testing door for one `pinecall start`. The report prints to the terminal as `pinecall test` does;
 * the page reads the run from `GET /v1/evals/runs`.
 */
export function testingFrom(
  door: Door,
  agent: string | null,
  out: NodeJS.WritableStream,
  pieces: Pieces,
): Testing {
  return {
    async roster(): Promise<Roster> {
      const goldens = await pieces.goldens();
      return {
        agent,
        goldens: goldens.map(({ name, input, expect }) => ({ name, input, expect: { ...(expect ?? {}) } })),
      };
    },

    async start(asked: unknown): Promise<{ run: string }> {
      const wanted = parsed(asked);
      if (wanted.agent !== agent) throw new Refusal(409, NOT_THIS_DIRECTORY(wanted.agent, agent));
      const spoiled = wanted.background_noise !== undefined || wanted.packet_loss !== undefined;
      if (!wanted.voice && spoiled) throw new Refusal(422, ONLY_ON_A_LINE);
      const chosen = (await pieces.goldens()).filter((golden) => wanted.goldens.includes(golden.name));
      const missing = wanted.goldens.filter((name) => !chosen.some((golden) => golden.name === name));
      if (missing.length > 0) throw new Refusal(404, `no golden called ${missing.join(", ")}`);
      return await opened(agent, chosen, wanted.models, aLine(wanted), door, out, pieces);
    },
  };
}

// Send only spoken-run fields; a written run omits `voice` rather than sending `false`.
function aLine(wanted: Wanted): Partial<RunWanted> {
  if (!wanted.voice) return {};
  return {
    voice: true,
    ...(wanted.background_noise === undefined ? {} : { interferer_db: wanted.background_noise }),
    ...(wanted.packet_loss === undefined ? {} : { packet_loss: wanted.packet_loss }),
  };
}

// Resolve with the run id once the gateway writes its row; the suite keeps running here.
// A suite that ends first becomes a 502.
async function opened(
  agent: string,
  goldens: Golden[],
  models: string[],
  line: Partial<RunWanted>,
  door: Door,
  out: NodeJS.WritableStream,
  pieces: Pieces,
): Promise<{ run: string }> {
  let settled = false;
  const suite = pieces.suite(door, goldens, models, line, out).then(
    () => (settled = true),
    (failed: unknown) => {
      settled = true;
      out.write(`suite failed: ${failed instanceof Error ? failed.message : String(failed)}\n`);
    },
  );
  const deadline = Date.now() + A_RUN_OPENS_WITHIN_MS;
  while (!settled && Date.now() < deadline) {
    const id = await pieces.running(door, agent);
    if (id !== undefined) return { run: id };
    await Promise.race([suite, new Promise((wake) => setTimeout(wake, A_LOOK_EVERY_MS))]);
  }
  throw new Refusal(502, NO_RUN);
}

function parsed(asked: unknown): Wanted {
  const given = anObject(asked, "a run");
  return {
    agent: aString(given, "agent"),
    goldens: names(given, "goldens"),
    models: given["models"] === undefined ? [] : names(given, "models"),
    voice: aFlag(given, "voice"),
    background_noise: maybeNumber(given, "background_noise", 0, 120),
    packet_loss: maybeNumber(given, "packet_loss", 0, 1),
  };
}

/** Run parts for one agent of a project, served by the process `served` names. */
export function testingPiecesFor(home: Home, served: Served): Pieces {
  return {
    goldens: () => goldensOf(home.goldens),
    suite: async (door, goldens, models, line, out) => {
      const asked = models.map(modelOf).filter((model) => model !== undefined);
      return await ranSuite({ door, served, goldens, models: asked, line, out, json: false });
    },
    running: inFlight,
  };
}
