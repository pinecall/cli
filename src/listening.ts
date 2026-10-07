/** `--listen`: play a live call on this machine's speakers. */

import { spawn, type ChildProcess } from "node:child_process";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { theLoaderFor } from "./language.js";
import { aPlayerFor, PLAYERS } from "./players.js";
import { asked, type Door } from "./testing/gateway.js";

/** A listen seat: LiveKit connection fields and this terminal's identity in the room. */
interface Seat {
  server_url: string;
  participant_token: string;
  identity: string;
}

/** A listener attached to one call. */
export interface Ear {
  /** This terminal's participant identity. */
  identity: string;
  leave(): Promise<void>;
}

// Rooms carry 48 kHz mono (runtime evals/speech.py); ear and player must agree.
const SAMPLE_RATE = 48_000;
const CHANNELS = 1;

// Seat requests are retried: a simulation asks before the room has opened.
const A_ROOM_OPENS_WITHIN_MS = 30_000;
const A_KNOCK_EVERY_MS = 500;

// Grace period before the ear process is killed.
const LEAVING_TAKES_MS = 2_000;

// PCM goes over fd 3: the room library's logger writes to stdout and cannot be silenced.
const PCM = 3;

/** Error message when no raw-audio player is installed. */
export const NO_PLAYER =
  `no player on this machine: --listen writes ${SAMPLE_RATE} Hz mono to one of ` +
  `${PLAYERS.filter((one) => one.raw !== null).map((one) => one.name).join(", ")} — install ffmpeg, sox or alsa-utils`;

/** Error message when the optional `@livekit/rtc-node` is missing. */
export const NO_ROOM_LIBRARY =
  "--listen joins the call's room from this terminal and needs @livekit/rtc-node, which is an " +
  "optional dependency: install it (pnpm add @livekit/rtc-node) and listen again";

/**
 * Join a live call as a hidden, silent listener (`POST /v1/calls/{call}/listen`, scope `observe`)
 * and play both tracks locally. The room is joined in a child process (cli/ear.ts) because the
 * native room library logs to stdout and keeps threads alive after the call.
 */
export async function anEarIn(door: Door, call: string, out: NodeJS.WritableStream): Promise<Ear> {
  const player = aPlayer();
  if (player === null) throw new Error(NO_PLAYER);
  theRoomLibrary();
  const seat = await aSeatIn(door, call);
  const ear = spawn(process.execPath, [...theLoaderFor(EAR), EAR, String(SAMPLE_RATE), String(CHANNELS)], {
    stdio: ["pipe", "ignore", "ignore", "pipe"],
  });
  (ear.stdio[PCM] as Readable).pipe(player.stdin!);
  ear.stdin!.write(`${JSON.stringify({ server_url: seat.server_url, participant_token: seat.participant_token })}\n`);
  out.write(`  listening as ${seat.identity} · ${player.spawnfile}\n`);
  return {
    identity: seat.identity,
    async leave(): Promise<void> {
      // Closing stdin asks the ear to leave; `gone` kills it after a grace period.
      ear.stdin!.end();
      await gone(ear);
      player.stdin!.end();
    },
  };
}

/** Request a listen seat, retrying until the room opens or the deadline passes. */
export async function aSeatIn(door: Door, call: string): Promise<Seat> {
  const deadline = Date.now() + A_ROOM_OPENS_WITHIN_MS;
  for (;;) {
    try {
      return await asked<Seat>(door, `/v1/calls/${call}/listen`, { method: "POST", body: {} });
    } catch (refused) {
      if (Date.now() >= deadline) throw refused;
      await new Promise((wake) => setTimeout(wake, A_KNOCK_EVERY_MS));
    }
  }
}

// `ear.ts` in a checkout, `ear.js` in dist: follows this module's own extension.
export const EAR = fileURLToPath(new URL(`ear${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

/** Throw if `@livekit/rtc-node` is not resolvable, without loading it. */
function theRoomLibrary(): void {
  try {
    import.meta.resolve("@livekit/rtc-node");
  } catch {
    throw new Error(NO_ROOM_LIBRARY);
  }
}

/** Resolve when the ear exits, killing it after the grace period. */
function gone(ear: ChildProcess): Promise<void> {
  return new Promise((left) => {
    const kill = setTimeout(() => ear.kill("SIGKILL"), LEAVING_TAKES_MS);
    ear.once("exit", () => {
      clearTimeout(kill);
      left();
    });
  });
}

/** Start the first raw-PCM player on PATH, or null when none is installed. */
function aPlayer(): ChildProcess | null {
  const player = aPlayerFor("raw");
  if (player === null || player.raw === null) return null;
  return spawn(player.name, player.raw(SAMPLE_RATE, CHANNELS), { stdio: ["pipe", "ignore", "ignore"] });
}
