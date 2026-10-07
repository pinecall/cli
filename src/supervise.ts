/** `pinecall supervise <call>`: tail a live call's transcript and send supervisor verbs. */

import { createInterface, type Interface } from "node:readline";

import { type Verb } from "@pinecall/agents/wire";

import type { Pinecall } from "@pinecall/agents/client";
import { pinecallFor } from "./client-for.js";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { asked, type Door } from "./testing/gateway.js";
import { standingOf } from "./the-call.js";
import { refusal } from "./whoami.js";

const USAGE = "usage: pinecall supervise <call>";

// Shown only on a TTY.
const PROMPT = "> ";

// Live audio is the console's; this verb is transcript and verbs only.
export const ON_THE_SPEAKERS =
  "the audio of a live call is the console, which has a room — `pinecall start` prints its URL; this is the transcript and the desk";

/** Supervisor keys, one move per line. `q` leaves without ending the call. */
export const MOVES = [
  ["w <text>", "whisper to the agent — the caller never hears it"],
  ["s <text>", "say it to the caller, in the agent's voice, verbatim"],
  ["t", "take the line: the agent stops speaking and you are on it"],
  ["x", "give it back: the agent has the line again"],
  ["e [reason]", "end the call"],
  ["q", "leave the desk; the call goes on"],
] as const;

export const group: Group = {
  purpose: "listen in: whisper, say, takeover, transfer, end",
  usage: `${USAGE}

  The call's transcript as it happens, and one line to move on it:

${MOVES.map(([key, what]) => `    ${key.padEnd(11)} ${what}`).join("\n")}

  Every move lands in the caller's own log as its own \`supervisor.*\` entry with a seq, so what a
  human did to a call is read the same way as what the agent did. ${ON_THE_SPEAKERS}.`,
  run,
};

/** Stream and environment overrides, for tests. */
export interface Running {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Input for moves; defaults to stdin. */
  input?: NodeJS.ReadableStream;
}

export async function run(argv: string[], how: Running = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const call = argv.find((word) => !word.startsWith("-"));
  if (call === undefined) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  // Refuse unknown or ended calls instead of waiting on an empty transcript.
  const standing = await standingOf(door, call);
  if (!standing.live) {
    err.write(`${ALREADY_ENDED(call)}\n`);
    return 2;
  }
  out.write(`${call} · ${ON_THE_SPEAKERS}\n`);
  const pc = pinecallFor(door);
  try {
    return await atTheDesk(pc, door, call, out, err, how.input ?? process.stdin);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
}

/** Message for a call that has already ended. */
export const ALREADY_ENDED = (call: string): string =>
  `${call} has ended, and a desk moves a call that is happening: \`pinecall sessions show ${call}\` reads it`;

/** Tail the log and read moves concurrently; neither waits for the other. */
async function atTheDesk(
  pc: Pinecall,
  door: Door,
  call: string,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
  input: NodeJS.ReadableStream,
): Promise<number> {
  const lines = createInterface({ input, output: process.stdout, prompt: PROMPT });
  const leaving = new AbortController();
  let ended = false;
  let left = false;
  const watching = (async () => {
    for await (const seen of pc.observe({ call }, { signal: leaving.signal })) {
      // Raw log entry data, not the folded event.
      const line = lineOf(seen.entry.seq, seen.entry.type, seen.entry.data);
      if (line !== null) out.write(`\r${line}\n`);
      prompting(lines, input, left);
      if (seen.entry.type === "call.ended") ended = true;
      if (ended) break;
    }
  })();
  prompting(lines, input, left);
  for await (const typed of lines) {
    if (ended) break;
    const move = moveOf(typed.trim());
    if (move === "leave") break;
    if (move === null) {
      err.write(`\rnot a move. ${MOVES.map(([key]) => key.split(" ")[0]).join(" · ")}\n`);
    } else {
      await sent(door, call, move).catch((refused: unknown) => err.write(`\r${refusal(refused)}\n`));
    }
    prompting(lines, input, left);
  }
  // Abort the tail rather than awaiting it: it may be waiting on an entry that never comes.
  left = true;
  leaving.abort();
  lines.close();
  await watching.catch(() => undefined);
  return 0;
}

/**
 * Draw the prompt only on a TTY, and never after the interface is closed: the tail can outlive it,
 * and prompting then throws ERR_USE_AFTER_CLOSE.
 */
function prompting(lines: Interface, input: NodeJS.ReadableStream, left: boolean): void {
  if (!left && (input as NodeJS.ReadStream).isTTY === true) {
    lines.prompt();
  }
}

/** Parse a typed line into a verb, `leave` for q, or null when it is not a move. */
export function moveOf(typed: string): Verb | "leave" | null {
  const [key, ...rest] = typed.split(" ");
  const said = rest.join(" ").trim();
  if (key === "q") return "leave";
  if (key === "t") return { verb: "takeover" };
  if (key === "x") return { verb: "release" };
  if (key === "e") return { verb: "end", reason: said === "" ? undefined : said };
  if (said === "") return null;
  if (key === "w") return { verb: "whisper", text: said };
  if (key === "s") return { verb: "say", text: said };
  return null;
}

async function sent(door: Door, call: string, verb: Verb): Promise<void> {
  await asked(door, `/v1/calls/${encodeURIComponent(call)}/verbs`, { method: "POST", body: verb });
}

/** Format a log entry for the desk: turns, supervisor moves and the end; null for everything else. */
export function lineOf(seq: number, type: string, data: Record<string, unknown>): string | null {
  const at = String(seq).padStart(4, " ");
  if (type === "turn.user") return `${at}  caller  ${String(data["text"] ?? "")}`;
  if (type === "turn.agent") return `${at}  agent   ${String(data["text"] ?? "")}`;
  if (type === "call.ended") return `${at}  ——      ended: ${String(data["reason"] ?? "")}`;
  if (type.startsWith("supervisor.")) {
    const what = type.slice("supervisor.".length);
    const said = data["text"] ?? data["reason"] ?? data["to"] ?? "";
    return `${at}  desk    ${what}${said === "" ? "" : ` ${String(said)}`}`;
  }
  return null;
}
