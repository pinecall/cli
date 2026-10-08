/** The phone tools: whose terminal a ring lands in (`line`), the org's `numbers` and `carriers`, and the `callbacks` waiting. */

import { z } from "zod";

import { callbacks as callbacksOf } from "../../callbacks.js";
import { callsFrom, claimed, forgetCallsFrom, released, theLine } from "../../line.js";
import { keepCalling, pinecallHome } from "../../signed-in.js";
import { asked } from "../../testing/gateway.js";
import { Refused, tool } from "../tool.js";
import { AGENT, PROD } from "./fields.js";

const NUMBERS = "/v1/numbers";

export const line = tool({
  name: "line",
  description: "Who answers the agent's number right now and who could take it; which phone is the person's own, so their calls reach their copy.",
  schema: {
    action: z.enum(["show", "from", "forget", "claim", "release"]).describe("show whose process a ring lands in; from says which phone is the person's own; forget drops it; claim takes the line for this copy; release gives it back"),
    agent: AGENT,
    number: z.string().optional().describe("`from`: the person's own phone, in +E.164"),
    prod: PROD,
  },
  manual:
    "`line show` says whose process a ring at the agent's number lands in. `from <number>` says which phone is the person's own, once: their calls reach the copy they hold (the one `start` holds) while everybody else reaches production. `claim` takes the line for this copy, `release` gives it back, `forget` drops the phone.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "from") {
      if (args.number === undefined) throw new Refused("from takes the person's own phone, in +E.164");
      const said = await callsFrom(door, args.number);
      keepCalling(door.url, args.number, pinecallHome(session.env));
      return said;
    }
    if (args.action === "forget") {
      const said = await forgetCallsFrom(door);
      keepCalling(door.url, undefined, pinecallHome(session.env));
      return said;
    }
    const name = (await session.home(args.agent)).name;
    if (args.action === "claim") return await claimed(door, name);
    if (args.action === "release") return await released(door, name);
    return await theLine(door, name);
  },
});

export const numbers = tool({
  name: "numbers",
  description: "The org's numbers and the agent each reaches; the numbers its carrier account owns; importing one, shown as steps before anything is written.",
  schema: {
    action: z.enum(["list", "available", "import"]).describe("list the org's numbers; available is what its carrier account owns; import points one at an agent, a dry run unless dry_run is false"),
    number: z.string().optional().describe("`import`: the number, in +E.164"),
    agent: z.string().optional().describe("`import`: the agent that answers it"),
    channel: z.enum(["phone", "whatsapp"]).optional().describe("`import`: phone unless it is a WhatsApp number"),
    account: z.string().optional().describe("`available`: one carrier account, when the org has several"),
    dry_run: z.boolean().optional().describe("`import`: true (the default) prints the steps and writes nothing; false does them"),
    prod: PROD,
  },
  manual:
    "`numbers list` shows which number reaches which agent in the sandbox; `available` what the org's Twilio account owns. `import` points a number the account owns at an agent: it first answers the steps it would take and writes nothing; call again with `dry_run: false` to do them. Letting a number go is never a tool: `pinecall numbers drop` in a terminal.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "available") return await asked<unknown>(door, args.account === undefined ? `${NUMBERS}/available` : `${NUMBERS}/available?account=${encodeURIComponent(args.account)}`);
    if (args.action === "list") return { numbers: await asked<unknown>(door, NUMBERS) };
    if (args.number === undefined || args.agent === undefined) throw new Refused("import takes the number and the agent that answers it");
    const dry = args.dry_run !== false;
    const body = { number: args.number, agent: args.agent, ...(args.channel === undefined ? {} : { channel: args.channel }) };
    return await asked<unknown>(door, dry ? `${NUMBERS}?dry_run=true` : NUMBERS, { method: "POST", body });
  },
});

export const carriers = tool({
  name: "carriers",
  description: "The org's carrier accounts — Twilio, a SIP peer, WhatsApp — and one account's networks and how outbound calls leave. Never a secret.",
  schema: { action: z.enum(["list", "show"]).describe("list the org's carrier accounts, or show one"), account: z.string().optional().describe("`show`: the account's id"), prod: PROD },
  manual: "`carriers` lists the org's carrier accounts and shows one. Adding one takes its secrets, so it is never a tool: the person types `pinecall carriers add` in a terminal, or uses the console's Numbers screen.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "show") return await asked<unknown>(door, args.account === undefined ? "/v1/carrier" : `/v1/carrier?account=${encodeURIComponent(args.account)}`);
    return await asked<unknown>(door, "/v1/carriers");
  },
});

export const callbacks = tool({
  name: "callbacks",
  description: "The callers waiting to be called back, oldest first: who, on which channel, through what (the overflow, the agent's own tool, the widget).",
  schema: { agent: z.string().optional().describe("only this agent's"), after: z.number().int().min(0).optional().describe("where the page before ended"), prod: PROD },
  manual: "`callbacks` lists the people waiting for a call back, each with the call it came from.",
  handler: async (args, session) => {
    const query = new URLSearchParams();
    if (args.agent !== undefined) query.set("agent", args.agent);
    if (args.after !== undefined) query.set("after", String(args.after));
    return await callbacksOf(await session.door(args.prod), query);
  },
});
