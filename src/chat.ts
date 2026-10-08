/** `pinecall chat [agent]`: chat with this directory's agent in a process of its own, or with a running one. */

import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import type { CamelEvent } from "@pinecall/agents/client";
import { signed } from "@pinecall/agents/client";
import WebSocket from "ws";

import { answered, NOTHING_OWED, owing, sent, type Owed } from "./answered.js";
import { spawnServing, whileServing, type Spawns } from "./child.js";
import { theDoor, type Open } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, notASlug, oneHome } from "./home.js";
import { inspectOf, servingOne } from "./language.js";
import { BROKE, CALLER, lineFor } from "./view.js";
import { firstState } from "./prompt.js";

const PROMPT = `${CALLER} `;

export const group: Group = {
  purpose: "the agent served from this terminal, and a written caller against it",
  usage: `usage: pinecall chat [agent] [--agent <name>] [--file agent.tsx] [--prod] [--as <contact>]
                     [--state file [--case n]] [--events] [--inspect[=host:port] | --inspect-brk]

  With nothing after it: the agent of this directory, served by a process of its own that this
  one starts, and a written caller against it. The tools run on this machine, so a breakpoint in
  a @tool is reachable: --inspect or --inspect-brk opens that process to a debugger.

  With an agent's slug: a written call at the agent somebody is already holding — your own
  \`pinecall start\` in another terminal, or a colleague's. Nothing is mounted here.

  --agent <name>  which agent of a project of several, by its folder's name
  --file <path>   which class to mount, by its path
  --prod          production's agent, if your org lets you act there; the sandbox otherwise
  --as <contact>  who is calling: the id memory files this call under (a phone number, a customer id)
  --state file    the state the call opens in — the same goldens file \`pinecall prompt\` reads
  --case n        which case of that file, when it holds several
  --events        one JSON line per log entry instead of the lines, for a pipe
  --inspect       Node's own flag, given to the agent's process (a TypeScript agent's alone)`,
  run,
};

/**
 * Without a slug: start this directory's agent as a console's process (it takes no call it did not
 * open) and open `WS /v1/chat` as the caller, naming that process's app id so the call is served
 * there. With a slug: start nothing and chat with whichever process holds that agent.
 */
export async function run(argv: string[], spawns: Spawns = spawnServing): Promise<number> {
  const { inspect, rest } = inspectOf(argv);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      state: { type: "string" },
      case: { type: "string" },
      as: { type: "string" },
      file: { type: "string" },
      ...AGENT_FLAG,
      events: { type: "boolean", default: false },
    },
  });
  const reach = positionals[0];
  const aFile = notASlug(reach);
  if (aFile !== undefined) {
    process.stderr.write(`${aFile}\n`);
    return 2;
  }
  const door = await theDoor();
  if (door === undefined) return 2;
  const url = door.url;
  // The gateway puts it on the call's call.started; the class applies it before the first render.
  const state = values.state === undefined ? undefined : firstState(values.state, values.case);
  const opened: Opened = {
    ...(values.as === undefined ? {} : { contact: values.as }),
    ...(state === undefined ? {} : { state }),
  };
  if (reach !== undefined) {
    return await talk(() => chatUrl(url, reach, opened), door, values.events === true);
  }
  const home = await oneHome("chat", values.file, values.agent);
  // A console's process: a real phone call is never routed to this terminal.
  const started = servingOne(door, home, { console: true, inspect });
  return await whileServing(started, home.name, async (served) => {
    // Read on every dial: a gateway restart registers the process under a new app id.
    const address = (): string => {
      const app = served.app();
      return chatUrl(url, home.name, app === undefined ? opened : { ...opened, app });
    };
    return await talk(address, door, values.events === true);
  }, spawns);
}

/** How a written call opens: which process serves it, who calls, who plays them, in what state. */
export interface Opened {
  /** Pin the serving process; otherwise the gateway picks the newest socket holding the agent. */
  app?: string;
  /** The contact memory files the call under. */
  contact?: string;
  /** The simulated persona; the gateway records it on `call.started` for attribution. */
  persona?: string;
  /** The state the call opens in, carried on its `call.started`. */
  state?: Record<string, unknown>;
}

/** The `/v1/chat` WebSocket URL for a gateway base URL. */
export function chatUrl(base: string, agent: string, opened: Opened = {}): string {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/chat`;
  url.searchParams.set("agent", agent);
  // searchParams encodes each value: a raw `+` in a contact would arrive as a space.
  if (opened.app !== undefined) url.searchParams.set("app", opened.app);
  if (opened.contact !== undefined) url.searchParams.set("contact", opened.contact);
  if (opened.persona !== undefined) url.searchParams.set("persona", opened.persona);
  if (opened.state !== undefined) url.searchParams.set("state", JSON.stringify(opened.state));
  return url.toString();
}

// Each typed line is one turn; each frame is one log entry. The key goes in the Authorization
// header (the global WebSocket cannot set headers, hence `ws`). An unexpected close is a gateway
// restart: redial with `?call=` to resume; `address()` is re-read since the app id may change.
export function talk(
  address: () => string,
  door: Open,
  events: boolean,
  input: NodeJS.ReadableStream = process.stdin,
): Promise<number> {
  const lines = createInterface({ input, output: process.stdout, prompt: PROMPT });
  // A pipe is read, not typed at: no prompt for it.
  const prompt = (): void => {
    if ((input as { isTTY?: boolean }).isTTY === true) lines.prompt();
  };
  // Entries can arrive after stdin closed (piped input), and readline throws on a closed prompt.
  let typing = true;
  // The input ended; the call is left once nothing is owed.
  let closed = false;
  let call: string | null = null;
  let over = false;
  let socket: WebSocket | null = null;
  let back = 0;
  // Input that ends (a pipe) leaves only once every line sent was heard and answered, so the last
  // answer is printed and the call hung up whole.
  let owed: Owed = NOTHING_OWED;
  // Hanging up asks the gateway to end the call and waits for it to close the socket, so the
  // process that served the call stops with nothing live; a gateway that never closes is left.
  const leave = (): void => {
    typing = false;
    if (socket?.readyState !== WebSocket.OPEN) return void socket?.close();
    socket.send(JSON.stringify({ hangup: true }));
    const hungUp = socket;
    setTimeout(() => hungUp.close(), HANG_UP_WITHIN_MS).unref();
  };
  // `ws` throws on send before open, so input stays paused until the socket is up.
  lines.pause();
  return new Promise<number>((done) => {
    const dial = (): void => {
      const url = call === null ? address() : withCall(address(), call);
      const opened = new WebSocket(url, { headers: signed(door.apiKey, door.world) });
      socket = opened;
      opened.on("open", () => {
        if (!typing || closed) return;
        lines.resume();
        prompt();
      });
      opened.on("message", (frame: Buffer) => {
        const entry = JSON.parse(frame.toString()) as { call?: string | null; type?: string; data?: unknown };
        // Reset retries on the first message, not on open: the door may accept and then refuse.
        if (back > 0) process.stderr.write("\rthe gateway is back: the call goes on\n");
        back = 0;
        if (typeof entry.call === "string") call = entry.call;
        if (entry.type === "call.score") over = true;
        owed = owing(owed, entry);
        if (closed && answered(owed)) leave();
        // --events prints raw JSON entries, as `run --events` does.
        const line = events ? frame.toString() : lineOf(frame.toString());
        if (line === null) return;
        // Redraw the prompt: an entry may land mid-typing.
        process.stdout.write(`\r${line}\n`);
        if (typing && !closed) prompt();
      });
      // An error is followed by a close, and the close decides.
      opened.on("error", () => undefined);
      opened.on("close", (_code: number, reason: Buffer) => {
        const why = reason.toString();
        if (!typing || over) {
          lines.close();
          done(0);
          return;
        }
        lines.pause();
        // A close reason is a refusal. While reconnecting it may just mean the app socket has not
        // re-registered yet, so keep retrying until BACK_TRIES.
        const coming = call !== null && back < BACK_TRIES;
        if (!coming) {
          lines.close();
          if (why !== "") process.stderr.write(`\r${why}\n`);
          done(why === "" ? 0 : 1);
          return;
        }
        if (back === 0) process.stderr.write("\rthe gateway went away — the call is kept, reconnecting…\n");
        back += 1;
        setTimeout(dial, waitBack(back));
      });
    };
    lines.on("line", (line) => {
      if (line.trim() !== "" && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ text: line.trim() }));
        owed = sent(owed);
      }
      prompt();
    });
    lines.on("close", () => {
      closed = true;
      if (answered(owed)) return leave();
      setTimeout(leave, LONGEST_ANSWER_MS).unref();
    });
    dial();
  });
}

// How long ended input waits for the answer it is owed before it hangs up anyway.
export const LONGEST_ANSWER_MS = 60_000;

// How long a hang-up waits for the gateway to end the call and close the socket.
const HANG_UP_WITHIN_MS = 5_000;

// Reconnect budget: about a minute in total, enough for a gateway restart.
export const BACK_TRIES = 15;
const BACK_FIRST_MS = 500;
const BACK_CAP_MS = 5_000;

/** Exponential backoff before the `back`-th reconnect attempt. */
export function waitBack(back: number): number {
  return Math.min(BACK_FIRST_MS * 2 ** (back - 1), BACK_CAP_MS);
}

/** The chat URL with `call` set, to resume that call. */
function withCall(address: string, call: string): string {
  const url = new URL(address);
  url.searchParams.set("call", call);
  return url.toString();
}

// Format one entry as cli/view.ts does; null for entries with no line (see --events).
// Errors are always shown. `turn.user` is skipped because readline already echoed it.
export function lineOf(frame: string): string | null {
  const entry = JSON.parse(frame) as { type?: string; data?: Record<string, unknown> };
  if (entry.type === "turn.user") return null;
  if (entry.type === "error") return `${BROKE} ${String(entry.data?.message)}`;
  const line = lineFor({ ...entry, data: entry.data ?? {} } as CamelEvent);
  return line === null ? null : `${line.mark} ${line.text}`;
}
