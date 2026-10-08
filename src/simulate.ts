/** `pinecall simulate --persona x`: a model plays the caller, and the call is judged at hang-up. */

import { parseArgs } from "node:util";

import { whileServing } from "./child.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { anEarIn, type Ear } from "./listening.js";
import { aSimulation, degradedBy, exitCodeOf, ONLY_ON_A_LINE, TURNS, type Simulated, type Simulation } from "./simulation.js";
import { AGENT_FLAG, oneHome, type Home } from "./home.js";
import { inspectOf, servingOne } from "./language.js";
import { NOBODY, personaNamed, type Persona } from "./testing/personas.js";
import { type Door, type Spoken } from "./testing/gateway.js";

const USAGE =
  "usage: pinecall simulate --persona <name> [--judge] [--turns n] [--voice] [--listen]\n" +
  "       [--background-noise <dB under the caller>] [--packet-loss 0.05] [--agent <name>] [--file agent.tsx]\n" +
  "       [--inspect[=host:port] | --inspect-brk]\n";

export const group: Group = {
  purpose: "a model plays one persona against the agent, live, and the call is scored at hang-up",
  usage: `${USAGE}
  A model in the gateway plays the caller: every turn improvised from the persona's goal, its
  style and its own facts — there is no script. A process this terminal starts serves the agent,
  this terminal holds the transcript, the gateway holds the provider keys. The call lands in the log like any other.

  --persona <name>    one of the agent's personas, by name: pinecall personas lists them
  --judge             read back the call.score the log seals on, and print every judge
  --turns n           how many turns the caller improvises before hanging up (default 15)
  --voice             a real line: a room, and the caller in a person's voice, not the agent's
  --listen            the call on this machine's speakers while it happens; turns --voice on
  --background-noise  dB under the caller: a television behind them. Spoken runs only
  --packet-loss       the share of the caller's packets that never arrive, 0 to 1. Spoken runs only
  --agent <name>      which agent of a project of several plays the other half
  --file agent.tsx    which class to serve, when the directory holds more than one
  --inspect           Node's own flag, given to the agent's process (a TypeScript agent's alone)`,
  run,
};

// --listen implies --voice; printed because it changes what runs.
const LISTEN_IS_A_LINE = "--listen is a call with audio in it: --voice is on";


export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const { inspect, rest } = inspectOf(argv);
  const { values } = parseArgs({
    args: rest,
    options: {
      persona: { type: "string" },
      judge: { type: "boolean", default: false },
      listen: { type: "boolean", default: false },
      voice: { type: "boolean", default: false },
      "background-noise": { type: "string" },
      "packet-loss": { type: "string" },
      turns: { type: "string" },
      file: { type: "string" },
      ...AGENT_FLAG,
    },
  });
  const listen = values.listen === true;
  const voice = values.voice === true || listen;
  if (listen && values.voice !== true) out.write(`${LISTEN_IS_A_LINE}\n`);
  if (values.persona === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }
  const degraded = degradedBy(values["background-noise"], values["packet-loss"]);
  if (!voice && degraded !== undefined) {
    process.stderr.write(`${ONLY_ON_A_LINE}\n`);
    return 2;
  }
  const home = await oneHome("simulate", values.file, values.agent);
  const door = await theDoor();
  if (door === undefined) return 2;
  const persona = await personaNamed(door, home.name, values.persona);
  if (persona === undefined) {
    process.stderr.write(`${NOBODY(values.persona, home.name)}\n`);
    return 2;
  }
  const said = await aSimulationOf(home, persona, {
    door,
    judge: values.judge === true,
    voice,
    ...(listen ? { ear: listening } : {}),
    ...(degraded === undefined ? {} : { degraded }),
    turns: values.turns === undefined ? TURNS : Number(values.turns),
    out,
  }, inspect);
  return exitCodeOf(said);
}

/**
 * One simulation of an agent of this project, served by a process started for it: a console's
 * process, unless the call is spoken — that one arrives from a worker naming no app.
 */
export async function aSimulationOf(
  home: Home,
  persona: Persona,
  how: Omit<Simulation, "served"> & { door: Door },
  inspect: string[] = [],
): Promise<Simulated | undefined> {
  const started = servingOne(how.door, home, { console: !how.voice, inspect });
  return await whileServing(started, home.name, async (served) => await aSimulation(persona, { ...how, served }));
}

// Listening is best-effort: no audio player or room library must not fail the simulation.
async function listening(door: Door, call: string, out: NodeJS.WritableStream): Promise<Ear | null> {
  try {
    return await anEarIn(door, call, out);
  } catch (failed) {
    out.write(`  not listening: ${failed instanceof Error ? failed.message : String(failed)}\n`);
    return null;
  }
}
