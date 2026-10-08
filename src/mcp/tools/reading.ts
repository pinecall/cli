/** The tools that read what happened: `calls`, one `call` whole, the agent's `pipeline`, and the `providers` it may run on. */

import { z } from "zod";

import { entriesOf, theSessions } from "../../testing/gateway.js";
import { asked } from "../../testing/gateway.js";
import { tool } from "../tool.js";

const AGENT = z.string().optional().describe("the agent's name; the project's only agent when left out");

export const calls = tool({
  name: "calls",
  description: "The agent's newest calls in the sandbox: each one's id, channel, length, how it ended, its cost and its verdicts.",
  schema: { agent: AGENT, limit: z.number().int().min(1).max(100).optional().describe("how many, newest first; 20 when left out") },
  manual: "`calls` lists the agent's newest calls with their ids; `call` reads one whole.",
  handler: async (args, session) => {
    const name = (await session.home(args.agent)).name;
    return { agent: name, calls: await theSessions(await session.door(), name, args.limit ?? 20) };
  },
});

export const call = tool({
  name: "call",
  description: "One call's log, entry by entry — every turn, tool call, result, state change, metric and verdict — a page at a time.",
  schema: {
    call: z.string().describe("the call's id"),
    after: z.number().int().min(0).optional().describe("only entries after this seq: the `next` of the page before"),
    limit: z.number().int().min(1).max(500).optional().describe("entries in this page; 200 when left out"),
    types: z.array(z.string()).optional().describe("only these entry types, such as turn.agent or call.score"),
  },
  manual:
    "`call` reads one call's log the way the runtime keeps it: every entry with its seq, quiet ones included — the turns, each tool call and its result, the state after it, the latency of each turn, the cost, and the verdicts at hang-up (`call.score`). Page with `after`.",
  handler: async (args, session) => {
    const limit = args.limit ?? 200;
    const entries = await entriesOf(await session.door(), args.call, { after: args.after ?? 0, limit, ...(args.types === undefined ? {} : { types: args.types }) });
    const last = entries.at(-1) as { seq?: number } | undefined;
    return { call: args.call, entries, next: entries.length === limit && last?.seq !== undefined ? last.seq : null };
  },
});

export const pipeline = tool({
  name: "pipeline",
  description: "What the agent hears, decides and speaks with — the vendors and models of each stage — and the latency each measured.",
  schema: { agent: AGENT },
  manual: "`pipeline` reads the three stages a call runs on (ears, model, voice), which vendor and model each is, and the medians the agent's recent calls measured.",
  handler: async (args, session) => {
    const name = (await session.home(args.agent)).name;
    return await asked<unknown>(await session.door(), `/v1/agents/${encodeURIComponent(name)}/pipeline`);
  },
});

export const providers = tool({
  name: "providers",
  description: "The vendors an agent may run on: what each does, whether it is ready, and whose key it would run on. Never a key.",
  schema: {},
  manual:
    "`providers` lists every speech, model and voice vendor this gateway can run, what each does, and whose key a call would use. Bringing a key of your own is never a tool: the person types `pinecall providers add <vendor>` in a terminal, or uses the console.",
  handler: async (_args, session) => await asked<unknown>(await session.door(), "/v1/providers"),
});
