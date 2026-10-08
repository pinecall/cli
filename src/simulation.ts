/** One simulated call as a core any front runs: a model plays the persona against an agent already served, written or spoken, judged at hang-up. */

import { type CallScore } from "@pinecall/agents/wire";
import { signed } from "@pinecall/agents/client";
import WebSocket from "ws";

import { chatUrl, type Opened } from "./chat-url.js";
import { theDoor } from "./env.js";
import type { Ear } from "./listening.js";
import type { Served } from "./serving.js";
import type { Persona } from "./testing/personas.js";
import { type Door, entriesOf, type Entry, type Persona as Calling, theNextLine } from "./testing/gateway.js";
import { latencyLine, mediansOf } from "./testing/latency.js";
import { linesOfScore } from "./testing/score.js";
import { aCallId, aVoiceCall, DEGRADED, type Degraded, watching } from "./testing/voice.js";
import { after, Heard, SETTLE_MS } from "./testing/heard.js";

// Refused on written calls rather than silently ignored.
export const ONLY_ON_A_LINE = "--background-noise and --packet-loss are about audio: add --voice";

/** Default caller turns; long enough for a full booking flow, not just the opening. */
export const TURNS = 15;

// `call.score` is written after hang-up, so it is polled for up to this long.
const JUDGING_MAY_TAKE_MS = 60_000;
const TERMINAL_ENTRY = "call.score";

const notSealed = (call: string): string =>
  `no ${TERMINAL_ENTRY} within ${JUDGING_MAY_TAKE_MS / 1000}s: read the call with ` +
  `\`pinecall sessions ${call}\`, or the console → Sessions`;

/** Result of one simulated call: its id and, when judged, its score. */
export interface Simulated {
  call: string;
  score?: CallScore | undefined;
}

/** Parse --background-noise (dB) and --packet-loss (percent); undefined when neither is set. */
export function degradedBy(noise: string | undefined, loss: string | undefined): Degraded | undefined {
  if (noise === undefined && loss === undefined) return undefined;
  return {
    interferer_db: noise === undefined || noise === "" ? DEGRADED.interferer_db : Number(noise),
    packet_loss: loss === undefined || loss === "" ? DEGRADED.packet_loss : Number(loss) / 100,
  };
}

/** Exit code: 2 when the call never opened, 1 when a judge answered broken, else 0. */
export function exitCodeOf(said: Simulated | undefined): number {
  if (said === undefined) return 2;
  if (said.score === undefined) return 0;
  return said.score.passed === true ? 0 : 1;
}

/** Options for {@link aSimulation}. */
export interface Simulation {
  /** The agent, and the process that serves the call. */
  served: Served;
  judge: boolean;
  voice: boolean;
  /** Puts the spoken call on this machine's speakers; the CLI's front hands it in, the MCP never does. */
  ear?: ((door: Door, call: string, out: NodeJS.WritableStream) => Promise<Ear | null>) | undefined;
  degraded?: Degraded | undefined;
  turns: number;
  out: NodeJS.WritableStream;
  /** Gateway to run against; defaults to the one from the environment. */
  door?: Door | undefined;
  /** Called with the call id as soon as it is known. */
  opened?: ((call: string) => void) | undefined;
}

/**
 * Run one call at the agent served against a model playing the persona in the gateway. With
 * `judge`, print the resulting `call.score`.
 */
export async function aSimulation(persona: Persona, how: Simulation): Promise<Simulated | undefined> {
  const door = how.door ?? (await theDoor());
  if (door === undefined) return undefined;
  const { slug } = how.served;
  how.out.write(`${persona.name} · ${persona.goal}\n`);
  // A written call names the app in its socket URL; a spoken one reaches whoever takes unclaimed calls.
  const call = how.voice
    ? await outLoud(door, slug, persona, how)
    : await inWriting(chatUrl(door.url, slug, writtenAs(persona, how.served.app())), door, persona, how);
  return { call, ...(await theEnding(door, call, how)) };
}

// Written call over one socket; closing it hangs up, which triggers scoring.
async function inWriting(
  socketUrl: string,
  door: Door,
  persona: Persona,
  how: Simulation,
): Promise<string> {
  const socket = new WebSocket(socketUrl, { headers: signed(door.apiKey, door.world) });
  const heard = new Heard(how.out, how.opened);
  socket.on("message", (frame: Buffer) => heard.absorb(JSON.parse(frame.toString()) as Entry));
  await once(socket, "open");
  await heard.quiet();
  for (let turn = 0; turn < how.turns; turn += 1) {
    // Hung up elsewhere (console, app, agent); stop as the spoken path does (runtime api/evals/voice.py).
    if (heard.over) break;
    const next = await theNextLine(door, {
      persona: callingAs(persona),
      heard: heard.said,
      turns_left: how.turns - turn,
    });
    if (next.say === "" || heard.over) break;
    const before = heard.agentTurns;
    socket.send(JSON.stringify({ text: next.say }));
    await heard.answered(before);
    if (next.hangup) break;
  }
  socket.close();
  how.out.write(`  ${heard.call ?? "no call"} · ${heard.agentTurns} agent turn(s)\n`);
  return heard.call ?? "";
}

// Spoken call run entirely by the runtime; this side mints the id and tails the log.
async function outLoud(
  door: Door,
  slug: string,
  persona: Persona,
  how: Simulation,
): Promise<string> {
  const call = aCallId();
  // Report the id only after the first log entry, so a refused call is never announced.
  const heard = new Heard(how.out);
  let told = false;
  // Join before requesting the call so the greeting is not missed.
  const ear = how.ear === undefined ? null : how.ear(door, call, how.out);
  const held = aVoiceCall(door, {
    call,
    agent: slug,
    persona: callingAs(persona),
    turns: how.turns,
    ...(how.degraded === undefined ? {} : { degraded: how.degraded }),
    ...(persona.state === undefined ? {} : { state: persona.state }),
  });
  await watching(door, call, held, (entry) => {
    if (!told) {
      told = true;
      how.opened?.(call);
    }
    heard.absorb(entry);
  });
  const called = await held;
  await (await ear)?.leave();
  how.out.write(`  ${call} · ${called.turns} caller turn(s) · ${heard.agentTurns} agent turn(s) · ${called.line}\n`);
  return call;
}

/** Convert a persona to the gateway's wire shape; unset optional fields are omitted. */
export function callingAs(persona: Persona): Calling {
  const set = (value: string | null | undefined): value is string => value !== undefined && value !== null && value !== "";
  return {
    name: persona.name,
    goal: persona.goal,
    style: persona.style,
    ...(persona.facts === undefined ? {} : { facts: persona.facts }),
    ...(set(persona.llm) ? { llm: persona.llm } : {}),
    ...(set(persona.tts) ? { tts: persona.tts } : {}),
    ...(set(persona.voice) ? { voice: persona.voice } : {}),
    ...(set(persona.accepts_when) ? { accepts_when: persona.accepts_when } : {}),
    ...(set(persona.declines_when) ? { declines_when: persona.declines_when } : {}),
  };
}

// Print per-turn latency medians from the log and, when judging, the score.
async function theEnding(
  door: Door,
  call: string,
  how: Simulation,
): Promise<{ score?: CallScore | undefined }> {
  if (call === "") return {};
  const measured = latencyLine(mediansOf(await entriesOf(door, call)));
  how.out.write(`  ${measured === "" ? "no metrics on this call" : measured}\n`);
  return { score: how.judge ? await theScore(door, call, how.out) : undefined };
}

async function theScore(
  door: Door,
  call: string,
  out: NodeJS.WritableStream,
): Promise<CallScore | undefined> {
  const deadline = Date.now() + JUDGING_MAY_TAKE_MS;
  while (Date.now() < deadline) {
    const sealed = await sealing(door, call);
    if (sealed !== undefined) {
      out.write(`${linesOfScore(sealed).join("\n")}\n`);
      return sealed;
    }
    await after(SETTLE_MS);
  }
  out.write(`${notSealed(call)}\n`);
  return undefined;
}

/** The call's `call.score` entry, if written yet. */
async function sealing(door: Door, call: string): Promise<CallScore | undefined> {
  const sealed = (await entriesOf(door, call)).find((entry) => entry.type === TERMINAL_ENTRY);
  return sealed === undefined ? undefined : (sealed.data as unknown as CallScore);
}


function once(socket: WebSocket, event: string): Promise<void> {
  return new Promise((done, failed) => {
    socket.on(event, () => done());
    socket.on("error", failed);
  });
}

// The persona's name and the state it opens the call in ride the socket's URL to call.started.
function writtenAs(persona: Persona, app: string | undefined): Opened {
  return {
    persona: persona.name,
    ...(app === undefined ? {} : { app }),
    ...(persona.state === undefined ? {} : { state: persona.state }),
  };
}
