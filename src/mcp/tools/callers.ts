/** The caller tools: a persona's call (`simulate`), the agent's `personas`, and the `judges` asked of calls at hang-up. */

import type { JudgeList, JudgePut } from "@pinecall/agents/wire";
import { z } from "zod";

import { aSimulation, TURNS } from "../../simulation.js";
import { asked } from "../../testing/gateway.js";
import { NOT_A_MODEL, theModelNamed } from "../../testing/models.js";
import { dropPersona, personaNamed, personasOf, writePersona } from "../../testing/personas.js";
import { collected } from "../collected.js";
import { Refused, tool } from "../tool.js";

const A_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const simulate = tool({
  name: "simulate",
  description: "A model plays one of the agent's personas against the agent this server holds, written or spoken, and the call is judged at hang-up.",
  schema: {
    persona: z.string().describe("the persona's name, from `personas`"),
    agent: z.string().optional().describe("the agent's name; the only one held when left out"),
    turns: z.number().int().min(1).max(40).optional().describe("how many turns the caller improvises; 15 when left out"),
    voice: z.boolean().optional().describe("a spoken call on a real line, the caller in a voice of its own"),
    background_noise: z.number().optional().describe("spoken calls: dB of noise under the caller"),
    packet_loss: z.number().min(0).max(100).optional().describe("spoken calls: the percent of the caller's packets lost"),
  },
  manual:
    "`simulate` runs one call a model improvises as the persona — its goal, its manner, its facts, no script — against the agent `start` holds, and answers the conversation and every judge's verdict: the platform's own, the persona's rule for hanging up satisfied, and your own judges.",
  handler: async (args, session) => {
    const held = session.holding(args.agent);
    const app = await held.ready();
    const persona = await personaNamed(held.door, held.home.name, args.persona);
    if (persona === undefined) throw new Refused(`${held.home.name} has no persona called ${args.persona}: \`personas\` lists them`);
    const spoken = args.voice === true;
    const degraded =
      spoken && (args.background_noise !== undefined || args.packet_loss !== undefined)
        ? { interferer_db: args.background_noise ?? 15, packet_loss: (args.packet_loss ?? 2) / 100 }
        : undefined;
    const lines = collected();
    const said = await aSimulation(persona, {
      served: { slug: held.home.name, app: () => app },
      judge: true,
      voice: spoken,
      turns: args.turns ?? TURNS,
      out: lines.stream,
      door: held.door,
      ...(degraded === undefined ? {} : { degraded }),
    });
    return { call: said?.call ?? null, transcript: lines.lines(), score: said?.score ?? null };
  },
});

export const personas = tool({
  name: "personas",
  description: "The agent's simulated callers: listed, shown, written (a goal, a manner, facts, a rule for hanging up satisfied), edited, dropped.",
  schema: {
    action: z.enum(["list", "show", "add", "edit", "rm"]),
    agent: z.string().optional().describe("the agent's name; the project's only agent when left out"),
    name: z.string().optional().describe("the persona's name: lowercase letters, digits and dashes"),
    goal: z.string().optional().describe("what the caller wants"),
    style: z.string().optional().describe("how they talk"),
    about: z.string().optional().describe("who they are, in a line"),
    facts: z.record(z.string(), z.string()).optional().describe("what they know and say when asked: their name, an order number…"),
    accepts_when: z.string().optional().describe("when they hang up satisfied: a judge, never told to the caller"),
    declines_when: z.string().optional().describe("when they hang up unhappy"),
    llm: z.string().optional().describe("the model that plays them; the runtime's when left out"),
    voice: z.string().optional().describe("their voice on a spoken call"),
    rename: z.string().optional().describe("`edit`: a new name"),
  },
  manual:
    "`personas` keeps the callers a model plays against the agent. A persona is a goal, a manner and the facts it knows; `accepts_when` is its own rule for hanging up satisfied, judged at hang-up and never told to the model playing it. `simulate` runs one.",
  handler: async (args, session) => {
    const agent = (await session.home(args.agent)).name;
    const door = await session.door();
    if (args.action === "list") return { personas: await personasOf(door, agent) };
    const name = args.name;
    if (name === undefined) throw new Refused(`${args.action} takes the persona's name`);
    if (args.action === "show") return (await personaNamed(door, agent, name)) ?? { refused: `no persona called ${name}` };
    if (args.action === "rm") return { personas: await dropPersona(door, agent, name) };
    const before = await personaNamed(door, agent, name);
    if (args.action === "add" && before !== undefined) throw new Refused(`${agent} has a persona called ${name} already: edit it`);
    if (args.action === "edit" && before === undefined) throw new Refused(`${agent} has no persona called ${name}: add it`);
    const writing = args.rename ?? name;
    if (!A_NAME.test(writing)) throw new Refused(`${writing} cannot be a persona's name: lowercase letters, digits and dashes`);
    const goal = args.goal ?? before?.goal;
    const style = args.style ?? before?.style;
    if (goal === undefined || style === undefined) throw new Refused("a persona needs a goal and a style: what they want, and how they talk");
    const llm = args.llm === undefined ? undefined : theModelNamed(args.llm);
    if (args.llm !== undefined && llm === undefined) throw new Refused(NOT_A_MODEL(args.llm));
    return {
      personas: await writePersona(door, agent, writing, {
        goal,
        style,
        about: args.about ?? before?.about ?? "",
        facts: args.facts ?? before?.facts ?? {},
        state: before?.state ?? {},
        llm: llm ?? before?.llm ?? null,
        tts: before?.tts ?? null,
        voice: args.voice ?? before?.voice ?? null,
        accepts_when: args.accepts_when ?? before?.accepts_when ?? "",
        declines_when: args.declines_when ?? before?.declines_when ?? "",
        ...(writing === name ? {} : { was: name }),
      }),
    };
  },
});

export const judges = tool({
  name: "judges",
  description: "Your own judges: a question asked of the agent's calls (or every agent's, with `org`) at hang-up, on every call or on simulations only.",
  schema: {
    action: z.enum(["list", "add", "rm"]),
    agent: z.string().optional().describe("the agent's name; the project's only agent when left out"),
    org: z.boolean().optional().describe("the org's judges, asked of every agent's calls"),
    name: z.string().optional().describe("the judge's name: lowercase letters, digits and dashes"),
    asks: z.string().optional().describe("`add`: the question, settled held or broken with the whole call in front of the judge model"),
    on: z.enum(["every-call", "simulations"]).optional().describe("`add`: which calls it reads; every call when left out"),
  },
  manual:
    "`judges` writes the questions about your business a model answers of every finished call — held or broken, citing the turns. The platform's own (consent, grounded, promises, disclosed, identified, honoured_stop, persona, heard) run anyway, and their names are taken.",
  handler: async (args, session) => {
    const door = await session.door();
    const whose = args.org === true ? null : (await session.home(args.agent)).name;
    const path = (name?: string): string =>
      `${whose === null ? "/v1/org/judges" : `/v1/agents/${encodeURIComponent(whose)}/judges`}${name === undefined ? "" : `/${encodeURIComponent(name)}`}`;
    if (args.action === "list") return await asked<JudgeList>(door, path());
    const name = args.name;
    if (name === undefined || !A_NAME.test(name)) throw new Refused("a judge's name is lowercase letters and digits joined by dashes");
    if (args.action === "rm") return await asked<JudgeList>(door, path(name), { method: "DELETE" });
    if (args.asks === undefined || args.asks.trim() === "") throw new Refused("add takes the question the judge asks");
    const body: JudgePut = { question: args.asks.trim(), runs_on: args.on ?? "every-call" };
    return await asked<JudgeList>(door, path(name), { method: "PUT", body });
  },
});
