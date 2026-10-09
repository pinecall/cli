/** `pinecall personas`: list, write, try and drop an agent's synthetic callers. */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, agentFilesOfTheProject, type Home, homeOf, oneHome, slugOfAgentFile } from "./home.js";
import { asATable, linesOf, theFacts } from "./persona-lines.js";
import { aSimulationOf } from "./simulate.js";
import { TURNS } from "./simulation.js";
import { NOT_A_MODEL, theModelNamed } from "./testing/models.js";
import { personasIn as personasInFiles } from "./testing/caller.js";
import type { Door } from "./testing/gateway.js";
import { dropPersona, NOBODY, personaNamed, personasOf, writePersona, type Persona } from "./testing/personas.js";

const USAGE =
  "usage: pinecall personas [list] | show <name> | try <name>\n" +
  "       pinecall personas add <name> --goal '…' --style '…' [--about '…'] [--fact 'what=said']…\n" +
  "       pinecall personas edit <name> [--goal '…'] [--style '…'] [--about '…'] [--fact 'what=said']… [--rename <name>]\n" +
  "       … add and edit also take [--llm x] [--tts x] [--voice x] [--accepts-when '…'] [--declines-when '…']\n" +
  "       pinecall personas rm <name> · pinecall personas push [--from test/<agent>/personas]\n" +
  "       … any of them with --json, --prod for production's, and --agent <name> or\n" +
  "       --file agent.tsx when the project holds more than one agent\n";

export const group: Group = {
  purpose: "an agent's synthetic callers: list, show, add, edit, rm, try — kept by the gateway",
  usage: `${USAGE}
  A persona is a caller a model plays: a goal, a style, and the facts they may state about
  themselves. There is no script — every turn is improvised from those three. They are the
  AGENT's, kept by the gateway — one list per agent, in both worlds — so the console shows the same
  ones and a change needs no deploy. Another agent of the org has callers of its own.

  list             every caller written for the agent, with the goal each one pursues
  show <name>      that caller whole, facts and all
  add <name>       write one: --goal and --style are needed, --fact repeated for what they know
  edit <name>      change what is named and leave the rest; --rename moves it to another name
  rm <name>        the caller dropped
  try <name>       one call against the class in this directory — simulate, without the judge
  push             the personas still in files, sent to the gateway once: the migration

  --llm x              the model that plays them, as \`agent set --llm\` takes it; --tts and
                       --voice the vendor and the voice their lines are read in. Unset, the
                       runtime's: its default model, a voice the agent does not have
  --accepts-when '…'   when they hang up satisfied, and --declines-when when not: a judge named
                       persona reads every call of theirs against it at hang-up. '' clears one
  --agent <name>  whose callers: an agent of this project by its folder name or its slug.
                       The project's one agent when it holds one; push reads that agent's files
  --file agent.tsx     which class, when the directory holds more than one
  --json               what the gateway answered — the caller for show, the roster for the rest.
                       try prints a call as it happens and refuses the flag

  Examples
    $ pinecall personas
    hurried       short sentences, interrupts, gives just what is asked     move the appointment to Tuesday
    suspicious    polite and wary, answers with another question             find out the price of a crown

    $ pinecall personas add price-shopper --goal "get a price for a deep clean" \\
        --style "blunt, impatient" --fact "their name=Tom Baker"
    price-shopper written · 3 persona(s)`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Setting {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

/** Known verbs, checked before anything is loaded. */
const VERBS = ["list", "show", "add", "edit", "rm", "try", "push"] as const;

const NONE_YET = (agent: string): string =>
  `${agent} has no personas yet: \`pinecall personas add <name> --goal '…' --style '…'\`, or the console's Personas`;

// Mirrors the gateway's name rule so a bad name gets a readable error.
const A_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NAME_SHAPE = (name: string): string =>
  `${name} is no name for a caller: lower-case letters and digits joined by hyphens — apurado, price-shopper`;

const NOT_JSON = "try prints a call as it happens, not an answer the gateway gave: drop --json";

/** Flags accepted by `add` and `edit`. */
interface Asked {
  goal?: string;
  style?: string;
  about?: string;
  fact?: string[];
  rename?: string;
  llm?: string;
  tts?: string;
  voice?: string;
  "accepts-when"?: string;
  "declines-when"?: string;
}

export async function run(argv: string[], how: Setting = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      goal: { type: "string" },
      style: { type: "string" },
      about: { type: "string" },
      fact: { type: "string", multiple: true },
      rename: { type: "string" },
      llm: { type: "string" },
      tts: { type: "string" },
      voice: { type: "string" },
      "accepts-when": { type: "string" },
      "declines-when": { type: "string" },
      from: { type: "string" },
      file: { type: "string" },
      json: { type: "boolean", default: false },
      ...AGENT_FLAG,
    },
  });
  const [verb = "list", name] = positionals;
  if (!(VERBS as readonly string[]).includes(verb)) {
    err.write(USAGE);
    return 2;
  }
  const asJson = values.json === true;
  if (asJson && verb === "try") {
    err.write(`${NOT_JSON}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  if (name === undefined && verb !== "list" && verb !== "push") {
    err.write(USAGE);
    return 2;
  }
  // A persona is one agent's: every verb names it, the project's one when it holds one.
  const home = await oneHome("personas", values.file, values.agent);
  const whose: Whose = { door, agent: slugOfAgentFile(home.file) };
  if (verb === "list") return await listed(whose, asJson, out);
  if (verb === "push") return await pushed(whose, values.from ?? home.personas, asJson, out, err);
  if (name === undefined) {
    err.write(USAGE);
    return 2;
  }
  if (verb === "show") return await shown(whose, name, asJson, out, err);
  if (verb === "rm") return await dropped(whose, name, asJson, out, err);
  if (verb === "try") return await tried(whose, name, home, out, err);
  return await written(whose, name, verb === "add" ? "add" : "edit", values, asJson, out, err);
}

/** The gateway and the agent whose callers a verb reads and writes. */
interface Whose {
  door: Door;
  agent: string;
}

/** Print the roster as a table, or JSON. */
async function listed({ door, agent }: Whose, asJson: boolean, out: NodeJS.WritableStream): Promise<number> {
  const personas = await personasOf(door, agent);
  if (asJson) {
    out.write(`${JSON.stringify({ personas })}\n`);
    return 0;
  }
  if (personas.length === 0) {
    out.write(`${NONE_YET(agent)}\n`);
    return 0;
  }
  out.write(`${asATable(personas).join("\n")}\n`);
  return 0;
}

/** Print one persona in full, or JSON. */
async function shown(
  { door, agent }: Whose,
  name: string,
  asJson: boolean,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const persona = await personaNamed(door, agent, name);
  if (persona === undefined) {
    err.write(`${NOBODY(name, agent)}\n`);
    return 2;
  }
  out.write(asJson ? `${JSON.stringify(persona)}\n` : `${linesOf(persona).join("\n")}\n`);
  return 0;
}

// Both `add` and `edit` PUT the whole persona; merging with the existing one happens here.
async function written(
  { door, agent }: Whose,
  name: string,
  verb: "add" | "edit",
  values: Asked,
  asJson: boolean,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const before = await personaNamed(door, agent, name);
  if (verb === "edit" && before === undefined) {
    err.write(`${NOBODY(name, agent)}\n`);
    return 2;
  }
  if (verb === "add" && before !== undefined) {
    err.write(`${agent} has a persona called ${name} already: \`pinecall personas edit ${name}\`\n`);
    return 2;
  }
  const writing = values.rename ?? name;
  if (!A_NAME.test(writing)) {
    err.write(`${NAME_SHAPE(writing)}\n`);
    return 2;
  }
  const goal = values.goal ?? before?.goal;
  const style = values.style ?? before?.style;
  if (goal === undefined || style === undefined) {
    err.write("a persona needs --goal and --style: what they want, and how they talk\n");
    return 2;
  }
  let facts: Record<string, string>;
  try {
    facts = values.fact === undefined ? (before?.facts ?? {}) : theFacts(values.fact);
  } catch (refused) {
    err.write(`${refused instanceof Error ? refused.message : String(refused)}\n`);
    return 2;
  }
  const llm = values.llm === undefined || values.llm === "" ? values.llm : theModelNamed(values.llm);
  if (llm === undefined && values.llm !== undefined) {
    err.write(`${NOT_A_MODEL(values.llm)}\n`);
    return 2;
  }
  const kept = await writePersona(door, agent, writing, {
    goal,
    style,
    about: values.about ?? before?.about ?? "",
    facts,
    state: before?.state ?? {},
    // Unnamed fields keep their value; '' resets to the runtime default.
    llm: llm ?? before?.llm ?? null,
    tts: values.tts ?? before?.tts ?? null,
    voice: values.voice ?? before?.voice ?? null,
    accepts_when: values["accepts-when"] ?? before?.accepts_when ?? "",
    declines_when: values["declines-when"] ?? before?.declines_when ?? "",
    ...(writing === name ? {} : { was: name }),
  });
  if (asJson) {
    out.write(`${JSON.stringify({ personas: kept })}\n`);
    return 0;
  }
  const now = kept.find((one) => one.name === writing);
  out.write(`${now?.name ?? name} ${verb === "add" ? "written" : "changed"} · ${kept.length} persona(s)\n`);
  return 0;
}

// Checked first so a missing name gets the same message as elsewhere, not the gateway's JSON.
async function dropped(
  { door, agent }: Whose,
  name: string,
  asJson: boolean,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  if ((await personaNamed(door, agent, name)) === undefined) {
    err.write(`${NOBODY(name, agent)}\n`);
    return 2;
  }
  const kept = await dropPersona(door, agent, name);
  out.write(asJson ? `${JSON.stringify({ personas: kept })}\n` : `${name} dropped · ${kept.length} persona(s)\n`);
  return 0;
}

// `simulate` without the judge.
async function tried(
  { door, agent }: Whose,
  name: string,
  home: Home,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const persona = await personaNamed(door, agent, name);
  if (persona === undefined) {
    err.write(`${NOBODY(name, agent)}\n`);
    return 2;
  }
  const said = await aSimulationOf(home, persona, { door, judge: false, voice: false, turns: TURNS, out });
  return said === undefined ? 2 : 0;
}

/**
 * One-time migration of file-based personas to the gateway, as the callers of the agent whose
 * files they are. Computed state is evaluated before upload. The files are left untouched.
 */
async function pushed(
  { door, agent }: Whose,
  folder: string,
  asJson: boolean,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const inFiles = await personasInFiles(folder);
  if (inFiles.length === 0) {
    err.write(`no personas in ${folder}\n`);
    return 2;
  }
  const landed: string[] = [];
  let kept: Persona[] = [];
  for (const persona of inFiles) {
    try {
      kept = await writePersona(door, agent, persona.name, {
        goal: persona.goal,
        style: persona.style,
        about: "",
        facts: Object.fromEntries(Object.entries(persona.facts ?? {}).map(([what, said]) => [what, String(said)])),
        state: persona.state ?? {},
      });
    } catch (refused) {
      // Report exactly which personas were pushed and which remain, so a rerun can resume.
      err.write(`${halfWay(landed, inFiles.map((one) => one.name).slice(landed.length), refused)}\n`);
      return 2;
    }
    landed.push(persona.name);
    if (!asJson) out.write(`  ${persona.name}\n`);
  }
  out.write(asJson ? `${JSON.stringify({ personas: kept })}\n` : `${landed.length} persona(s) pushed from ${folder}\n`);
  return 0;
}

/** Error report for a partial push: what landed, what is left, and why it stopped. */
function halfWay(landed: string[], left: string[], refused: unknown): string {
  return [
    `${left[0]} was refused: ${refused instanceof Error ? refused.message : String(refused)}`,
    `  pushed: ${landed.length === 0 ? "nothing" : landed.join(", ")}`,
    `  still only files: ${left.join(", ")}`,
    "  nothing was undone and no file was touched: push again once it is fixed",
  ].join("\n");
}
