/** The `agent` tool: the agent's settings — read, set, cleared, versioned, rolled back — and what it knows by heart. */

import type { TuningAnswer, TuningDiff, TuningHistory } from "@pinecall/agents/wire";
import { z } from "zod";

import { knowledgeWritten } from "../../agent-knowledge.js";
import { FIELDS, readSettings, settingsPath, theRowToStartFrom } from "../../agent-lines.js";
import { clear, fraction, limitOf, set, switched, type Typed } from "../../agent-setting.js";
import { asked, type Door } from "../../testing/gateway.js";
import { NOT_A_MODEL, theModelNamed } from "../../testing/models.js";
import { Refused, tool } from "../tool.js";
import { AGENT, PROD } from "./fields.js";

// What `set` takes, under the CLI's own flag names, so one function turns either into a version.
const SETTINGS = z
  .object({
    voice: z.string(),
    tts: z.string(),
    "tts-model": z.string(),
    stt: z.string(),
    llm: z.string(),
    language: z.string().min(1),
    greeting: z.string(),
    reply: z.string(),
    hangup: z.string(),
    "endpointing-ms": z.number().int().min(0),
    "min-interruption-words": z.number().int().min(0),
    "eot-threshold": z.number(),
    "eager-eot-threshold": z.number(),
    record: z.enum(["on", "off"]),
    "max-duration": z.union([z.number().int().min(1).max(60), z.literal("off")]),
    remember: z.array(z.string()),
    forget: z.array(z.string()),
  })
  .partial();

export const agent = tool({
  name: "agent",
  description: "The agent's settings — voice, models, language, greeting, memory policy, knowledge by heart: read, set, cleared, history, diff, rollback.",
  schema: {
    action: z.enum(["show", "set", "clear", "history", "diff", "rollback", "knowledge"]).describe("show reads the settings; set writes the fields named as a new version; clear takes fields out; history lists the versions; diff compares with the team's or production's; rollback brings a version back; knowledge reads or writes what the agent knows by heart"),
    agent: AGENT,
    settings: SETTINGS.optional().describe("`set`: the fields to set, named as `pinecall agent set` names its flags"),
    fields: z.array(z.enum(FIELDS)).optional().describe("`clear`: the fields to take out; every one when left out"),
    team: z.boolean().optional().describe("write the team's settings (the org's own) instead of your own"),
    against: z.enum(["team", "production"]).optional().describe("`diff`: what yours are compared with; production when left out"),
    version: z.number().int().min(1).optional().describe("`rollback`: the version to bring back"),
    text: z.string().optional().describe("`knowledge`: what the agent knows by heart, written whole; read when left out; empty takes it out"),
    note: z.string().optional().describe("a note kept with the version written"),
    prod: PROD,
  },
  manual:
    "`agent` reads and writes the agent's settings in the sandbox — the voice, the models, the language, the greeting, the memory policy, what it knows by heart — each change a new version, changed without a deploy. They are your own settings unless `team` writes the team's. `history`, `diff` and `rollback` read and undo versions. A model is named as `vendor/model`, a vendor, a model, or a tier (`haiku`).",
  handler: async (args, session) => {
    const name = (await session.home(args.agent)).name;
    const door = await session.door(args.prod);
    const team = args.team === true;
    switch (args.action) {
      case "set":
        return await set(door, name, flagsOf(args.settings ?? {}, team, args.note));
      case "clear":
        return await clear(door, name, args.fields ?? [], team);
      case "history":
        return await asked<TuningHistory>(door, `${settingsPath(name)}/history?team=${team}`);
      case "diff":
        return await asked<TuningDiff>(door, `${settingsPath(name)}/diff?against=${args.against ?? "production"}`);
      case "rollback":
        if (args.version === undefined) throw new Refused("rollback takes the version to bring back: `history` lists them");
        return await asked<TuningAnswer>(door, `${settingsPath(name)}/rollback`, { method: "POST", body: { version: args.version, team } });
      case "knowledge":
        return await knowledgeOf(door, name, team, args.text, args.note);
      default:
        return await readSettings(door, name);
    }
  },
});

// The checks the CLI makes before it writes, in the same words; numbers are said as its flags are, as text.
function flagsOf(settings: z.infer<typeof SETTINGS>, team: boolean, note: string | undefined): Typed {
  const flags: Typed = { team, json: false };
  if (note !== undefined) flags.note = note;
  for (const field of ["voice", "tts", "tts-model", "stt", "language", "greeting", "reply", "hangup", "record"] as const) {
    const value = settings[field];
    if (value !== undefined) flags[field] = value;
  }
  for (const field of ["endpointing-ms", "min-interruption-words", "eot-threshold", "eager-eot-threshold", "max-duration"] as const) {
    const value = settings[field];
    if (value !== undefined) flags[field] = String(value);
  }
  if (settings.remember !== undefined) flags.remember = settings.remember;
  if (settings.forget !== undefined) flags.forget = settings.forget;
  if (settings.llm !== undefined) {
    const llm = theModelNamed(settings.llm);
    if (llm === undefined) throw new Refused(NOT_A_MODEL(settings.llm));
    flags.llm = llm;
  }
  for (const flag of ["eot-threshold", "eager-eot-threshold"] as const) {
    if (flags[flag] !== undefined && fraction(flags[flag]) === undefined) throw new Refused(`${flag} ${flags[flag]} is not a confidence: a number above 0 and no higher than 1`);
  }
  if (flags.record !== undefined && switched(flags.record) === undefined) throw new Refused(`record ${flags.record} is not on or off`);
  if (flags["max-duration"] !== undefined && limitOf(flags["max-duration"]) === undefined) throw new Refused(`max-duration ${flags["max-duration"]} is not 1 to 60 minutes, or off`);
  return flags;
}

async function knowledgeOf(door: Door, name: string, team: boolean, text: string | undefined, note: string | undefined): Promise<unknown> {
  if (text === undefined) {
    const row = theRowToStartFrom(await readSettings(door, name), team);
    return { agent: name, knowledge: row?.config.knowledge ?? null };
  }
  const version = await knowledgeWritten(door, name, text, team, note);
  return { agent: name, knowledge: text.trim() === "" ? "taken out" : `${text.length} characters`, version: version ?? null };
}
