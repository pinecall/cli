/** Console door for simulated calls against the agent class in this directory. */

import { aSimulation, degradedBy, ONLY_ON_A_LINE, TURNS, type Simulated, type Simulation } from "../simulation.js";
import type { Served } from "../serving.js";
import { NOBODY, personaNamed, type Persona } from "../testing/personas.js";
import type { Door } from "../testing/gateway.js";
import { aFlag, anObject, aNumber, aString, maybeNumber } from "./asked.js";
import { Refusal } from "./refusal.js";

/** Request body for starting a simulation. */
export interface Wanted {
  agent: string;
  persona: string;
  voice: boolean;
  judge: boolean;
  turns: number;
  /** Noise level in dB under the caller. Spoken calls only. */
  background_noise?: number | undefined;
  /** Packet loss in percent. Spoken calls only. */
  packet_loss?: number | undefined;
}

// Caps a persona that never hangs up.
const MOST_TURNS = 30;

// A simulation needs the class mounted in this process, i.e. the one in this directory.
const NOT_THIS_DIRECTORY = (asked: string, here: string | null): string =>
  here === null
    ? `no agent class in this directory: run \`pinecall start\` where ${asked}'s agent.tsx is`
    : `this process runs in ${here}'s directory: to simulate ${asked}, run \`pinecall start\` there`;

const NO_CALL = "the simulation ended before a call opened";

/** Simulation door as the console server uses it. */
export interface Simulating {
  start(wanted: unknown): Promise<{ call: string }>;
}

/** Injectable parts of a simulation, replaceable in tests. */
export interface Pieces {
  /** One simulation at the agent this `pinecall start` serves. */
  simulate: (persona: Persona, how: Omit<Simulation, "served">) => Promise<Simulated | undefined>;
}

/**
 * Simulation door for one `pinecall start`. Turns print to the terminal as `pinecall simulate` does;
 * the persona is fetched from the gateway by name, among the agent's own.
 */
export function simulatingFrom(
  door: Door,
  agent: string | null,
  out: NodeJS.WritableStream,
  pieces: Pieces,
): Simulating {
  return {
    async start(asked: unknown): Promise<{ call: string }> {
      const wanted = parsed(asked);
      if (wanted.agent !== agent) throw new Refusal(409, NOT_THIS_DIRECTORY(wanted.agent, agent));
      const degraded = degradedBy(
        wanted.background_noise === undefined ? undefined : String(wanted.background_noise),
        wanted.packet_loss === undefined ? undefined : String(wanted.packet_loss),
      );
      if (!wanted.voice && degraded !== undefined) throw new Refusal(422, ONLY_ON_A_LINE);
      const persona = await personaNamed(door, wanted.agent, wanted.persona);
      if (persona === undefined) throw new Refusal(404, NOBODY(wanted.persona, wanted.agent));
      return await opened(persona, wanted, degraded, door, out, pieces.simulate);
    },
  };
}

// Resolve with the call id as soon as it exists; the simulation keeps running here.
// One that ends before a call opens becomes a 502.
async function opened(
  persona: Persona,
  wanted: Wanted,
  degraded: ReturnType<typeof degradedBy>,
  door: Door,
  out: NodeJS.WritableStream,
  simulate: Pieces["simulate"],
): Promise<{ call: string }> {
  return await new Promise<{ call: string }>((answer, refuse) => {
    let answered = false;
    const running = simulate(persona, {
      door,
      judge: wanted.judge,
      voice: wanted.voice,
      ...(degraded === undefined ? {} : { degraded }),
      turns: wanted.turns,
      out,
      opened: (call) => {
        answered = true;
        answer({ call });
      },
    });
    running.then(
      () => {
        if (!answered) refuse(new Refusal(502, NO_CALL));
      },
      (failed: unknown) => {
        const why = failed instanceof Error ? failed.message : String(failed);
        out.write(`simulation failed: ${why}\n`);
        if (!answered) refuse(new Refusal(502, why));
      },
    );
  });
}

function parsed(asked: unknown): Wanted {
  const given = anObject(asked, "a simulation");
  return {
    agent: aString(given, "agent"),
    persona: aString(given, "persona"),
    voice: aFlag(given, "voice"),
    judge: aFlag(given, "judge"),
    turns: given["turns"] === undefined ? TURNS : aNumber(given, "turns", 1, MOST_TURNS),
    background_noise: maybeNumber(given, "background_noise", 0, 120),
    packet_loss: maybeNumber(given, "packet_loss", 0, 100),
  };
}

/** Simulation parts for the agent `served` names. */
export function simulatingPiecesFor(served: Served): Pieces {
  return { simulate: async (persona, how) => await aSimulation(persona, { ...how, served }) };
}
