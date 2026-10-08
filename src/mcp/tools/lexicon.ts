/** The `lexicon` tool: how the agent's voice says a word, and the words its ears must know. */

import type { LexiconAnswer, LexiconHistory } from "@pinecall/agents/wire";
import { z } from "zod";

import { changed, lexiconOf } from "../../lexicon.js";
import { asked } from "../../testing/gateway.js";
import { Refused, tool } from "../tool.js";
import { AGENT, PROD } from "./fields.js";

export const lexicon = tool({
  name: "lexicon",
  description: "The agent's words: how its voice says one (`add`), the words its ears must catch (`hear`), taking them out (`rm`), and its versions.",
  schema: {
    action: z.enum(["show", "add", "hear", "rm", "history"]),
    agent: AGENT,
    word: z.string().optional().describe("`add`: the word as written"),
    say: z.string().optional().describe("`add`: how the voice says it"),
    words: z.array(z.string()).optional().describe("`hear` and `rm`: the words"),
    team: z.boolean().optional().describe("write the team's lexicon instead of your own"),
    note: z.string().optional().describe("a note kept with the version written"),
    prod: PROD,
  },
  manual: "`lexicon` fixes words the voice says wrong (`add`, with how to say it) and names the words the ears must catch (`hear`): a brand, a doctor's name, a street. Each change is a version, kept without a deploy.",
  handler: async (args, session) => {
    const name = (await session.home(args.agent)).name;
    const door = await session.door(args.prod);
    const path = lexiconOf(name);
    const team = args.team === true;
    if (args.action === "history") return await asked<LexiconHistory>(door, `${path}/history?team=${team}`);
    if (args.action === "show") return await asked<LexiconAnswer>(door, path);
    if (args.action === "add") {
      if (args.word === undefined || args.say === undefined) throw new Refused("add takes the word and how the voice says it");
      return await changed(door, path, team, args.note, (words) => ({ ...words, said: { ...words.said, [args.word!]: args.say! } }));
    }
    const named = args.words ?? [];
    if (named.length === 0) throw new Refused(`${args.action} takes the words`);
    if (args.action === "hear") return await changed(door, path, team, args.note, (words) => ({ ...words, heard: [...new Set([...words.heard, ...named])] }));
    return await changed(door, path, team, args.note, (words) => ({
      said: Object.fromEntries(Object.entries(words.said).filter(([word]) => !named.includes(word))),
      heard: words.heard.filter((word) => !named.includes(word)),
    }));
  },
});
