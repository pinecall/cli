/** Spoken simulations: the runtime holds the call, this side polls its log. */

import { randomBytes } from "node:crypto";

import type { Door, Entry, Persona } from "./gateway.js";
import { asked, entriesOf } from "./gateway.js";

/** Deliberate line degradation; absent means a clean line. */
export interface Degraded {
  /** Interferer level in dB below the caller's voice. */
  interferer_db: number;
  /** Fraction of caller packets dropped, 0 to 1. */
  packet_loss: number;
}

// Background TV at 15 dB below the caller: measured to leak into `turn.user`.
export const DEGRADED: Degraded = { interferer_db: 15, packet_loss: 0 };

/** Result of a finished spoken call. */
export interface Called {
  call: string;
  turns: number;
  line: string;
}

/** Mint a call id locally; the room name is the call id, so the log can be watched immediately. */
export function aCallId(): string {
  return `call_${randomBytes(12).toString("hex")}`;
}

/** What a spoken call is placed with; `state` is the one the agent opens it in. */
export interface VoiceCall {
  call: string;
  agent: string;
  persona: Persona;
  turns: number;
  degraded?: Degraded;
  state?: Record<string, unknown>;
}

/** Start a spoken call in the runtime, which holds the LiveKit and provider credentials. */
export async function aVoiceCall(door: Door, wanted: VoiceCall): Promise<Called> {
  return await asked<Called>(door, "/v1/evals/voice", {
    method: "POST",
    body: {
      call: wanted.call,
      agent: wanted.agent,
      persona: wanted.persona,
      turns: wanted.turns,
      ...(wanted.degraded ?? {}),
      ...(wanted.state === undefined ? {} : { state: wanted.state }),
    },
  });
}

/** Poll the call's log from a cursor, passing each entry to `absorb`, until `over` settles. */
export async function watching(
  door: Door,
  call: string,
  over: Promise<unknown>,
  absorb: (entry: Entry) => void,
  every = 400,
): Promise<void> {
  let running = true;
  // Errors are handled by whoever awaits the call; here it only stops polling.
  void over.catch(() => undefined).finally(() => (running = false));
  let cursor = 0;
  const whatIsNew = async (): Promise<void> => {
    for (const entry of await entriesOf(door, call, { after: cursor })) {
      cursor = entry.seq;
      absorb(entry);
    }
  };
  while (running) {
    await whatIsNew();
    await new Promise((wake) => setTimeout(wake, every));
  }
  // Final poll: the closing turns may land after the last one.
  await whatIsNew();
}
