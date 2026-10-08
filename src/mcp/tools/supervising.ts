/** The `supervise` tool: a live call as a supervisor's desk sees it — its transcript as it happens, and a move on it. */

import type { Verb } from "@pinecall/agents/wire";
import { z } from "zod";

import { sent } from "../../supervise.js";
import { entriesOf, type Door, type Entry } from "../../testing/gateway.js";
import { standingOf } from "../../the-call.js";
import { Refused, tool } from "../tool.js";
import { PROD, WAIT, WAIT_S } from "./fields.js";

const EVERY_MS = 500;

export const ENDED = (call: string): string => `${call} has ended, and a desk moves a call that is happening: \`call\` reads what it was`;
const A_PAGE = 200;

/** One entry of the call as a desk reads it. */
export type Seen =
  | { seq: number; caller: string }
  | { seq: number; agent: string }
  | { seq: number; tool: string; args: unknown }
  | { seq: number; desk: string; said: string | null }
  | { seq: number; ended: string };

export const supervise = tool({
  name: "supervise",
  description:
    "A live call, as a supervisor's desk sees it: its transcript as it happens (`watch`), and a move on it — whisper to the agent, say a line in its voice, take the line, give it back, transfer, end.",
  schema: {
    action: z
      .enum(["watch", "whisper", "say", "takeover", "release", "transfer", "end"])
      .describe(
        "watch reads what was said since `after`, waiting up to wait_s for more; whisper tells the agent something the caller never hears; say makes the agent say `text` verbatim; takeover silences the agent and puts a person on the line; release gives the line back; transfer sends the caller to `to`; end hangs up",
      ),
    call: z.string().describe("the live call's id: `calls` lists the agent's newest, a live one marked live"),
    text: z.string().optional().describe("`whisper` and `say`: the words"),
    to: z.string().optional().describe("`transfer`: the number in +E.164, or the SIP address, the caller is sent to"),
    mode: z.enum(["cold", "warm"]).optional().describe("`transfer`: cold sends the caller at once; warm lets the agent introduce them first"),
    reason: z.string().optional().describe("`end`: why, kept in the call's log"),
    after: z.number().int().min(0).optional().describe("`watch`: the `next` the answer before ended at; the call's beginning when left out"),
    wait_s: WAIT,
    prod: PROD,
  },
  manual:
    "`supervise` is the desk `pinecall supervise` is in a terminal, for a call that is happening. `watch` answers the call's lines since `after` — the caller's, the agent's, its tool calls, every move of a desk, the end — and waits up to `wait_s` for more while the call is live; pass the `next` it answers to keep reading. `whisper` reaches the agent as an instruction for its next reply and the caller never hears it; `say` puts words in the agent's voice; `takeover` silences the agent until `release`; `transfer` and `end` act on the caller, at once. Every move lands in the caller's own log as a `supervisor.*` entry. A call that has ended is refused: `call` reads it. The audio of a live call is the console's Live screen (`console_url`).",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    const standing = await standingOf(door, args.call);
    if (args.action === "watch") return await watched(door, args.call, standing.live, args.after ?? 0, args.wait_s ?? WAIT_S);
    if (!standing.live) throw new Refused(ENDED(args.call));
    const verb = verbOf(args);
    await sent(door, args.call, verb);
    return { call: args.call, sent: verb };
  },
});

function verbOf(args: { action: string; text?: string | undefined; to?: string | undefined; mode?: "cold" | "warm" | undefined; reason?: string | undefined }): Verb {
  switch (args.action) {
    case "whisper":
    case "say":
      if (args.text === undefined || args.text.trim() === "") throw new Refused(`${args.action} takes the words: text`);
      return { verb: args.action, text: args.text.trim() };
    case "transfer":
      if (args.to === undefined || args.to.trim() === "") throw new Refused("transfer takes where the caller goes: to, a number in +E.164 or a SIP address");
      return { verb: "transfer", to: args.to.trim(), ...(args.mode === undefined ? {} : { mode: args.mode }) };
    case "end":
      return { verb: "end", ...(args.reason === undefined ? {} : { reason: args.reason }) };
    case "takeover":
      return { verb: "takeover" };
    default:
      return { verb: "release" };
  }
}

// A live call is waited on until something is said or the wait is up; an ended one answers what is left at once.
async function watched(door: Door, call: string, live: boolean, after: number, waitS: number): Promise<{ call: string; live: boolean; lines: Seen[]; next: number }> {
  const until = Date.now() + waitS * 1000;
  let cursor = after;
  const lines: Seen[] = [];
  let ended = !live;
  for (;;) {
    for (const entry of await entriesOf(door, call, { after: cursor, limit: A_PAGE })) {
      cursor = entry.seq;
      if (entry.type === "call.ended") ended = true;
      const seen = seenOf(entry);
      if (seen !== undefined) lines.push(seen);
    }
    if (lines.length > 0 || ended || Date.now() >= until) return { call, live: !ended, lines, next: cursor };
    await new Promise((rung) => setTimeout(rung, EVERY_MS));
  }
}

/** One log entry as the desk reads it; undefined for the entries a desk does not (metrics, state, scores). */
export function seenOf(entry: Entry): Seen | undefined {
  const data = entry.data;
  if (entry.type === "turn.user") return { seq: entry.seq, caller: String(data["text"] ?? "") };
  if (entry.type === "turn.agent") return { seq: entry.seq, agent: String(data["text"] ?? "") };
  if (entry.type === "tool.call") return { seq: entry.seq, tool: String(data["name"] ?? "?"), args: data["arguments"] ?? {} };
  if (entry.type === "call.ended") return { seq: entry.seq, ended: String(data["reason"] ?? "") };
  if (entry.type.startsWith("supervisor.")) {
    const said = data["text"] ?? data["reason"] ?? data["to"] ?? null;
    return { seq: entry.seq, desk: entry.type.slice("supervisor.".length), said: said === null ? null : String(said) };
  }
  return undefined;
}
