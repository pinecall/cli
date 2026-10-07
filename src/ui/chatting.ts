/** Console door for written calls against the agent class in this directory. */

import WebSocket from "ws";

import type { CamelEvent } from "@pinecall/agents/client";
import { signed } from "@pinecall/agents/client";

import { BACK_TRIES, chatUrl, waitBack, type Opened } from "../chat.js";
import type { Served } from "../serving.js";
import type { Door } from "../testing/gateway.js";
import type { Golden } from "../testing/goldens.js";
import { lineFor } from "../view.js";
import { anObject, aString, someWords } from "./asked.js";
import { Refusal } from "./refusal.js";

// Time for the call's first entry: register plus first render, no model turn.
const A_CALL_OPENS_WITHIN_MS = 20_000;

// A written call needs the class mounted in this process, i.e. the one in this directory.
const NOT_THIS_DIRECTORY = (asked: string, here: string | null): string =>
  here === null
    ? `no agent class in this directory: run \`pinecall start\` where ${asked}'s agent.tsx is`
    : `this process runs in ${here}'s directory: to chat with ${asked}, run \`pinecall start\` there`;

const NO_CALL = "the gateway took the socket but wrote no entry: nothing to read";
const NOT_OPEN = (call: string): string => `${call} is not a chat this console opened`;

/** Request body for opening a chat. */
export interface Wanted {
  agent: string;
  /** Contact the call is filed under (for agents with memory). */
  as?: string | undefined;
  /** Name of a golden whose state the call opens in, like `pinecall chat --state`. */
  golden?: string | undefined;
}

/** The mounted agent and the states a chat may open in. */
export interface Roster {
  agent: string | null;
  /** Names of goldens in this directory that declare a state. */
  states: string[];
}

/** Chat door as the console server uses it. */
export interface Chatting {
  roster(): Promise<Roster>;
  start(asked: unknown): Promise<{ call: string }>;
  say(asked: unknown): Promise<{ call: string }>;
  end(asked: unknown): Promise<{ call: string }>;
  /** Close every socket this console opened. */
  close(): Promise<void>;
}

/** One written call open in this process. */
export interface Line {
  call: string;
  say(text: string): void;
  end(): void;
}

/** Opens lines at the agent a process serves; a fake in tests. */
export interface Lines {
  /** Open a written call, optionally in a given state, carried on its `call.started`. */
  open(contact: string | undefined, opening?: Record<string, unknown> | undefined): Promise<Line>;
  close(): Promise<void>;
}

/**
 * Chat door for one `pinecall start`. Each call is served by the process `start` holds, so @tool
 * breakpoints work from the terminal; the page reads the call from the log.
 */
export function chattingFrom(
  agent: string | null,
  lines: Lines,
  goldens: () => Promise<Golden[]>,
): Chatting {
  const open = new Map<string, Line>();
  return {
    async roster(): Promise<Roster> {
      return { agent, states: (await theStates(agent, goldens)).map((golden) => golden.name) };
    },

    async start(asked: unknown): Promise<{ call: string }> {
      const wanted = parsed(asked);
      if (wanted.agent !== agent) throw new Refusal(409, NOT_THIS_DIRECTORY(wanted.agent, agent));
      const opening = wanted.golden === undefined ? undefined : await theStateOf(wanted.golden, agent, goldens);
      const line = await lines.open(wanted.as, opening);
      open.set(line.call, line);
      return { call: line.call };
    },

    async say(asked: unknown): Promise<{ call: string }> {
      // Validate the body before the lookup so a bad body is not reported as an unknown call.
      const given = anObject(asked, "a turn");
      const call = aString(given, "call");
      const text = aString(given, "text");
      const line = held(open, call);
      line.say(text);
      return { call: line.call };
    },

    async end(asked: unknown): Promise<{ call: string }> {
      const line = held(open, aString(anObject(asked, "a hangup"), "call"));
      line.end();
      open.delete(line.call);
      return { call: line.call };
    },

    async close(): Promise<void> {
      for (const line of open.values()) line.end();
      open.clear();
      await lines.close();
    },
  };
}

function held(open: Map<string, Line>, call: string): Line {
  const line = open.get(call);
  if (line === undefined) throw new Refusal(404, NOT_OPEN(call));
  return line;
}

function parsed(asked: unknown): Wanted {
  const given = anObject(asked, "a chat");
  return { agent: aString(given, "agent"), as: someWords(given, "as"), golden: someWords(given, "golden") };
}

/** Goldens in this directory that declare a state. */
async function theStates(agent: string | null, goldens: () => Promise<Golden[]>): Promise<Golden[]> {
  if (agent === null) return [];
  return (await goldens()).filter((golden) => golden.state !== undefined);
}

/** State of the named golden; 404 when none declares it. */
async function theStateOf(
  name: string,
  agent: string | null,
  goldens: () => Promise<Golden[]>,
): Promise<Record<string, unknown>> {
  const golden = (await theStates(agent, goldens)).find((one) => one.name === name);
  if (golden === undefined) throw new Refusal(404, `no golden called ${name} declares a state to open a call in`);
  return golden.state ?? {};
}

/**
 * One socket per call at the agent `served` names; the state a call opens in rides its socket's
 * URL. Naming the app routes the call to that process, not to the newest holder.
 */
export function linesThrough(door: Door, out: NodeJS.WritableStream, served: Served): Lines {
  return {
    async open(contact: string | undefined, opening?: Record<string, unknown> | undefined): Promise<Line> {
      const opened: Opened = {
        ...(contact === undefined ? {} : { contact }),
        ...(opening === undefined ? {} : { state: opening }),
      };
      // Read on every dial: the id changes when the gateway restarts.
      const address = (): string => {
        const app = served.app();
        return chatUrl(door.url, served.slug, app === undefined ? opened : { ...opened, app });
      };
      return await aLine(address, door, out);
    },
    async close(): Promise<void> {},
  };
}

// One chat socket; resolves once the call has an id and echoes entries to the terminal. A gateway
// restart drops the socket but keeps the call, so it redials with `?call=` until the call ends.
async function aLine(address: () => string, door: Door, out: NodeJS.WritableStream): Promise<Line> {
  let socket: WebSocket | null = null;
  let ended = false;
  let over = false;
  let back = 0;
  const line: Line = {
    call: "",
    say: (text: string) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ text }));
    },
    end: () => {
      ended = true;
      socket?.close();
    },
  };
  return await new Promise<Line>((answer, refuse) => {
    const giveUp = setTimeout(() => refuse(new Refusal(502, NO_CALL)), A_CALL_OPENS_WITHIN_MS);
    const dial = (): void => {
      const at = new URL(address());
      if (line.call !== "") at.searchParams.set("call", line.call);
      const opened = new WebSocket(at.toString(), { headers: signed(door.apiKey, door.world) });
      socket = opened;
      opened.on("message", (frame: Buffer) => {
        // Reset the retry budget once the call answers.
        back = 0;
        const entry = JSON.parse(frame.toString()) as { type?: string; call?: unknown; data?: Record<string, unknown> };
        if (entry.type === "call.score") over = true;
        if (line.call === "" && typeof entry.call === "string") {
          line.call = entry.call;
          clearTimeout(giveUp);
          answer(line);
        }
        const said = lineFor({ ...entry, data: entry.data ?? {} } as CamelEvent);
        if (said !== null) out.write(`${said.mark} ${said.text}\n`);
      });
      // A close reason before the first entry is the gateway's refusal; pass it to the page.
      opened.on("close", (_code: number, why: Buffer) => {
        if (line.call === "") {
          clearTimeout(giveUp);
          refuse(new Refusal(502, why.toString() === "" ? NO_CALL : why.toString()));
          return;
        }
        if (ended || over || back >= BACK_TRIES) return;
        back += 1;
        setTimeout(dial, waitBack(back));
      });
      // Always followed by a close, which handles it.
      opened.on("error", () => undefined);
    };
    dial();
  });
}
