/** The `chat` tool: a written call with the held agent, a line at a time, each answered whole. */

import { z } from "zod";

import { Talk } from "../holding/talking.js";
import { Refused, tool } from "../tool.js";

export const chat = tool({
  name: "chat",
  description: "Talk to the held agent as a caller: `say` a line (opening a call, or continuing one by its id) and get its whole answer; `end` hangs up.",
  schema: {
    action: z.enum(["say", "end"]).describe("say a line as the caller, opening a call or continuing `call`; end hangs `call` up"),
    text: z.string().optional().describe("`say`: what the caller says"),
    call: z.string().optional().describe("the call to continue or end; a new call opens when left out"),
    agent: z.string().optional().describe("the agent's name; the only one held when left out"),
    contact: z.string().optional().describe("who is calling (a phone number), so memory files the call under them"),
    state: z.record(z.string(), z.unknown()).optional().describe("the state a new call opens in"),
  },
  manual:
    "`chat` is a written call with the agent `start` holds. `say` without `call` opens one and answers with its id; pass that id to go on. Each answer is everything the agent did for that line: its turns, the tools it called with their arguments, their results, the state it changed. `end` hangs up, and the call is judged like any other. `contact` makes the caller someone, so memory is written and recalled.",
  handler: async (args, session) => {
    if (args.action === "end") {
      const talk = theTalk(session.talks, needed(args.call, "call"));
      session.talks.delete(needed(args.call, "call"));
      return await talk.end();
    }
    const text = needed(args.text, "text");
    if (args.call !== undefined) {
      const talk = theTalk(session.talks, args.call);
      // Ended by the agent or the gateway since the last line: let it go, and say so.
      if (talk.ended) session.talks.delete(args.call);
      return await talk.say(text);
    }
    const held = session.holding(args.agent);
    const app = await held.ready();
    const talk = await Talk.opened(held.door, held.home.name, app, args.contact, args.state);
    const answer = await talk.say(text);
    if (answer.call !== null && !answer.ended) session.talks.set(answer.call, talk);
    return { ...answer, version: held.version };
  },
});

function needed(value: string | undefined, name: string): string {
  if (value === undefined || value === "") throw new Refused(`${name} is needed for this action`);
  return value;
}

function theTalk(talks: Map<string, Talk>, call: string): Talk {
  const talk = talks.get(call);
  if (talk === undefined) throw new Refused(`no open call ${call} here: say a line without \`call\` to open one`);
  return talk;
}
