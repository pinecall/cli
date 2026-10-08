/** The knowledge tools: the agent's `docs` (a base pushed, attached, held to its golden), its `memory` of a caller, and `remember`'s extraction cases. */

import { existsSync } from "node:fs";

import type { ContactMemory, ExtractionGolden, KnowledgeList } from "@pinecall/agents/wire";
import { z } from "zod";

import { readSettings, theCornerRead } from "../../agent-lines.js";
import { set } from "../../agent-setting.js";
import { attach, attached, detach } from "../../docs-attach.js";
import { markdownUnder, pushedTo, scoredOn, theKItIsReadWith, theQuestionsIn } from "../../docs.js";
import { recalledOn } from "../../memory.js";
import { asked, extracted } from "../../testing/gateway.js";
import { casesIn, matching } from "../../testing/goldens.js";
import { collected } from "../collected.js";
import { Refused, tool } from "../tool.js";
import { AGENT, PROD } from "./fields.js";

export const docs = tool({
  name: "docs",
  description: "The documents the agent searches: a folder pushed as a base, attached to the agent, held to its golden; the org's bases and who reads them.",
  schema: {
    action: z.enum(["push", "list", "eval", "attach", "detach", "attached"]).describe("push the agent's docs folder as a base; list the org's bases; eval scores the docs golden; attach a base to the agent; detach it; attached says which agents read which base"),
    agent: AGENT,
    base: z.string().optional().describe("the base's name; the agent's own when left out"),
    k: z.number().int().min(1).max(50).optional().describe("`attach` and `eval`: how many chunks a turn reads"),
    mode: z.enum(["retrieved", "tool"]).optional().describe("`attach`: searched before every turn, or a tool the model calls"),
    min_score: z.number().min(0).max(1).optional().describe("`attach`: chunks under this share of the best one are dropped"),
    team: z.boolean().optional().describe("`attach` and `detach`: in the team's settings instead of your own"),
    prod: PROD,
  },
  manual:
    "`docs push` sends the Markdown under `docs/<agent>/` as a base (replacing it whole: push again after every edit); `attach` makes the agent search it before every turn; `eval` scores the questions in `test/<agent>/goldens/docs.json` against it (recall@k, nDCG@10, by code). `list` and `attached` are the org's, and name no agent. Dropping a base is never a tool: `pinecall docs drop` in a terminal.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "list") return await asked<KnowledgeList>(door, "/v1/knowledge");
    if (args.action === "attached") {
      const lines = collected();
      await attached(door, lines.stream);
      return { attached: lines.lines() };
    }
    const home = await session.home(args.agent);
    const base = args.base ?? home.name;
    const team = args.team === true;
    if (args.action === "push") {
      if (!existsSync(home.docs)) throw new Refused(`nothing to push: put Markdown files under ${home.docs}, one subject a file`);
      const files = markdownUnder(home.docs);
      if (files.length === 0) throw new Refused(`no Markdown under ${home.docs}`);
      return { files: files.length, ...(await pushedTo(door, base, files)) };
    }
    if (args.action === "eval") {
      if (!existsSync(home.docsGolden)) throw new Refused(`no golden at ${home.docsGolden}: a list of {asks, expects}, the questions people ask and the chunk each should find`);
      const questions = theQuestionsIn(home.docsGolden);
      if (questions === null) throw new Refused(`${home.docsGolden} holds no question`);
      return await scoredOn(door, base, questions, args.k ?? theKItIsReadWith(await readSettings(door, home.name), base));
    }
    const lines = collected();
    if (args.action === "attach") {
      await attach(door, home.name, base, { ...(args.k === undefined ? {} : { k: args.k }), ...(args.mode === undefined ? {} : { mode: args.mode }), ...(args.min_score === undefined ? {} : { minScore: args.min_score }) }, team, lines.stream);
    } else {
      await detach(door, home.name, base, team, lines.stream, lines.stream);
    }
    return { said: lines.lines() };
  },
});

export const memory = tool({
  name: "memory",
  description: "What the agent remembers about a caller, what it is told to keep and never keep, and the recall golden held against it.",
  schema: {
    action: z.enum(["show", "policy", "eval"]).describe("show what memory kept about `contact`; policy reads, or with remember/forget writes, what the agent keeps; eval scores the memory golden"),
    agent: AGENT,
    contact: z.string().optional().describe("`show`: the caller, by number or id"),
    remember: z.array(z.string()).optional().describe("`policy`: what is worth keeping about a caller, in your own words, one phrase each"),
    forget: z.array(z.string()).optional().describe("`policy`: what is never kept"),
    k: z.number().int().min(1).max(50).optional().describe("`eval`: how many facts a turn recalls"),
    prod: PROD,
  },
  manual:
    "`memory policy` says what the agent keeps about a caller (`remember`) and never keeps (`forget`); with neither it reads them, and with no policy the agent remembers nothing. `show` reads what it kept about one caller, and names no agent; `eval` scores `test/<agent>/goldens/memory.json`. Forgetting a caller is never a tool: `pinecall memory forget` in a terminal.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "show") {
      if (args.contact === undefined) throw new Refused("show takes the caller: a number or a contact id");
      return await asked<ContactMemory>(door, `/v1/contacts/${encodeURIComponent(args.contact)}/memory`);
    }
    const home = await session.home(args.agent);
    if (args.action === "eval") {
      if (!existsSync(home.memoryGolden)) throw new Refused(`no golden at ${home.memoryGolden}: a list of {holds, asks, expects}`);
      const questions = theQuestionsIn(home.memoryGolden);
      if (questions === null) throw new Refused(`${home.memoryGolden} holds no question`);
      return await recalledOn(door, questions, args.k);
    }
    if (args.remember === undefined && args.forget === undefined) {
      const policy = theCornerRead(await readSettings(door, home.name))?.config.memory;
      return { agent: home.name, remember: policy?.remember ?? [], forget: policy?.forget ?? [] };
    }
    return await set(door, home.name, { team: false, json: false, ...(args.remember === undefined ? {} : { remember: args.remember }), ...(args.forget === undefined ? {} : { forget: args.forget }) });
  },
});

export const remember = tool({
  name: "remember",
  description: "Hold memory's writing to its cases: each written call in test/<agent>/memory/ run through one extraction, and what it kept checked by code.",
  schema: { agent: AGENT, grep: z.string().optional().describe("only cases whose name holds this") },
  manual:
    "`remember` runs the extraction cases under `test/<agent>/memory/` — a written call and what memory must and must never keep from it — through the agent `start` holds, scored by code.",
  handler: async (args, session) => {
    const held = session.holding(args.agent);
    await held.ready();
    if (!existsSync(held.home.memoryCases)) throw new Refused(`no extraction cases at ${held.home.memoryCases}: one written call each, and what must and must never be kept`);
    const cases = matching(await casesIn<ExtractionGolden>([held.home.memoryCases], held.home.memoryCases), args.grep);
    if (cases.length === 0) throw new Refused(`no case matched${args.grep === undefined ? "" : ` ${args.grep}`}`);
    return await extracted(held.door, held.home.name, cases);
  },
});
