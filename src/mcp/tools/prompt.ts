/** The `prompt` tool: the exact prompt a state produces, offline, from a one-shot thread. */

import { z } from "zod";

import { languageOf, startedWith } from "../../language.js";
import { threadOnce } from "../holding/thread.js";
import { Refused, tool } from "../tool.js";

export const prompt = tool({
  name: "prompt",
  description: "Print the exact prompt the model reads when a call opens, or in a given state: offline, no key, no call.",
  schema: {
    agent: z.string().optional().describe("the agent's name; the project's only agent when left out"),
    state: z.record(z.string(), z.unknown()).optional().describe("fields of the class and their values, to see the prompt in that state"),
    channel: z.enum(["phone", "web", "whatsapp"]).optional().describe("the channel the prompt is written for"),
  },
  manual:
    "`prompt` prints what the model reads — the class's docstring, the rules, the tools, the view — exactly as a call would send it, offline. `state` sets fields first, so you can read the prompt at any stage. A Ruby agent's prompt is `pinecall prompt` in a terminal.",
  handler: async (args, session) => {
    const home = await session.home(args.agent);
    if (languageOf(home.file) !== "typescript") throw new Refused("a Ruby agent's prompt is printed by Ruby: `pinecall prompt` in a terminal");
    const states = Object.entries(args.state ?? {}).flatMap(([field, value]) => ["--state", `${field}=${JSON.stringify(value)}`]);
    const flags = ["--file", home.file, "--slug", home.name, ...states, ...(args.channel === undefined ? [] : ["--channel", args.channel])];
    const printed = await threadOnce(startedWith(undefined, home.file, "prompt", flags, { root: home.root }));
    if (printed.code !== 0) throw new Refused(printed.err.trim() || `the prompt could not be printed (exit ${printed.code})`);
    return { agent: home.name, prompt: printed.out };
  },
});
