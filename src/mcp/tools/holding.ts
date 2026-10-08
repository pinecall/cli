/** The tools that hold the agent: `start`, `stop`, `status` and `logs`. */

import { z } from "zod";

import { lentSaid } from "../holding/framework.js";
import { Held } from "../holding/held.js";
import { tool } from "../tool.js";
import { AGENT, PROD } from "./fields.js";

export const start = tool({
  name: "start",
  description: "Hold the project's agent so it answers calls: in a thread of this server, reloaded on every save, or attached to a process already holding it.",
  schema: { agent: AGENT, prod: PROD },
  manual:
    "`start` holds the agent the way `pinecall start` does: it answers written calls (`chat`), spoken ones from the console, and a phone ring when a number points at it. A TypeScript agent runs inside this server and reloads on every save; a project with nothing installed runs on the framework this server ships, lent to its thread alone — nothing is written into the project — until `npm install` pins its own, and `status` says so; a save that does not load keeps the version before answering, and `status` says why. A Ruby agent is held by `pinecall start --watch` in a terminal: `start` then attaches to it. Already held on this machine (a terminal, another window), it attaches instead of fighting for the line. The console's screens reach the agent held here, through a companion this server keeps beside the thread.",
  handler: async (args, session) => {
    const home = await session.home(args.agent);
    const already = session.held.get(home.name);
    if (already !== undefined) return statusOf(already);
    const held = new Held(await session.door(args.prod), home, session.beside === undefined ? {} : { beside: session.beside });
    await held.start();
    session.held.set(home.name, held);
    return statusOf(held);
  },
});

export const stop = tool({
  name: "stop",
  description: "Stop holding the agent: its thread drains its live calls and leaves.",
  schema: { agent: AGENT },
  manual: "`stop` lets the agent go: a thread drains the calls it holds and leaves; an attached process is left running, since this server did not start it.",
  handler: async (args, session) => {
    const held = session.holding(args.agent);
    await held.stop();
    session.held.delete(held.home.name);
    return { stopped: held.home.name };
  },
});

export const status = tool({
  name: "status",
  description: "What this server holds: each agent, how (thread or attached), its app, the version answering, and why the newest save did not load.",
  schema: {},
  manual: "`status` leads with what is wrong, if anything: the sentence a save that does not load was refused with. Otherwise each agent held, its app id and the version answering, and `framework` when the agent runs on the one this server lent the project.",
  handler: async (_args, session) => ({ held: [...session.held.values()].map(statusOf) }),
});

export const logs = tool({
  name: "logs",
  description: "The last lines the held agent's thread printed: its own logs, a load error, a reload.",
  schema: { agent: AGENT, lines: z.number().int().min(1).max(500).optional().describe("how many of the last lines; 50 when left out") },
  manual: "`logs` reads the last lines the agent printed — a tenant's own console output, a load error, the versions as they replace each other. They are kept in memory, never written where the host reads.",
  handler: async (args, session) => {
    const held = session.holding(args.agent);
    return { agent: held.home.name, lines: held.logs.last(args.lines ?? 50) };
  },
});

function statusOf(held: Held): Record<string, unknown> {
  return {
    agent: held.home.name,
    ...(held.broken === undefined ? {} : { broken: held.broken }),
    held: held.how(),
    app: held.app() ?? null,
    version: held.version,
    environment: held.door.world,
    ...framework(held),
  };
}

// The version answering now: after an `npm install`, the next save runs on the project's own and the line goes.
function framework(held: Held): { framework?: string } {
  const lent = held.lent();
  return lent === undefined ? {} : { framework: lentSaid(lent) };
}
