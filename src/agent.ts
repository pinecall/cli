/** `pinecall agent`: read and write an agent's settings per corner, and manage its processes. */

import { parseArgs } from "node:util";

import { type TuningAnswer, type TuningBody } from "@pinecall/agents/wire";

import { FIELDS, linesOf, readSettings, theCornerToWrite, WIRE, type Field } from "./agent-lines.js";
import { filesRun } from "./agent-files.js";
import { knowledgeRun } from "./agent-knowledge.js";
import { listed, stopped } from "./agent-processes.js";
import { versionsRun } from "./agent-versions.js";
import { inTheEditor, type Editor } from "./editor.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { agentOfThisDirectory, notASlug } from "./home.js";
import { asked, type Door } from "./testing/gateway.js";
import { NOT_A_MODEL, theModelNamed } from "./testing/models.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall agent [--agent <slug>] [--json]",
  "       pinecall agent list · stop <app>",
  "       pinecall agent set [--voice x] [--tts x] [--tts-model x] [--stt x] [--llm x] [--language en|es|pt-BR…]",
  "                          [--greeting '…' | --reply '…']",
  "                          [--hangup '…'] [--endpointing-ms n] [--min-interruption-words n] [--record on|off]",
  "                          [--max-duration 1-60|off]",
  "                          [--eot-threshold 0.5-0.9] [--eager-eot-threshold 0.3-0.9]",
  "                          [--remember '…' …] [--forget '…' …] [--team] [--note '…']",
  "       pinecall agent knowledge [--team] · knowledge edit [--team] [--note '…']",
  "       pinecall agent clear [voice|tts|tts-model|stt|llm|language|greeting|hangup|turn|memory|record|max-duration|knowledge|bases …] [--team]",
  "       pinecall agent history [--team] · diff [--against team|production] · rollback <version> [--team]",
  "       pinecall agent pull [--team] · push <file> [--team]",
].join("\n");

export const group: Group = {
  purpose: "what the org set over the class — yours, the team's, production's — setting it, and the processes that hold it",
  usage: `${USAGE}

  With nothing after it: the agent's settings as your key sees them, three corners side by side —
  your own sandbox corner, the team's, and production's — a row per field, and which version each
  corner is at. A corner that set nothing reads as what it falls back to.

  set writes a NEW version in your own corner: what you set is yours, and a colleague's next call
  does not hear it. --team writes the org's own corner instead, which every corner falls back to.
  --prod writes production's, if your org lets you act there. The whole set travels with the version it was read at, so two people
  saving at once never write over each other: the second is told where the corner is now. A model
  knob reads four ways — \`--llm anthropic/claude-haiku-4-5\`, \`--llm cartesia\` (a vendor, its own
  model), \`--llm claude-haiku-4-5\` (a model, the vendor in use), and \`--llm haiku\` (a tier, which
  is expanded here to the id its provider answers to, as \`pinecall test --model\` expands it). A
  name that means no model at all is refused rather than written. --language is the tag the voice
  and the ears are set to — \`en\`, \`es\`, \`pt-BR\` — and a blank one is refused; the prompt's
  own rules are English either way, and the agent answers in the language the caller speaks.
  --greeting sets the words said as the call opens; --reply what the model reads before it finds
  its own. --remember and --forget replace those lists whole. A field nobody names is left as it
  stands.

  knowledge is what the agent knows by heart — the business as the org describes it, in Markdown,
  read whole on every call. Alone it prints the corner's text; \`edit\` opens it in $EDITOR and
  saves what you wrote as the next version (an empty file takes it out). It is not the RAG: the
  documents a turn searches are \`pinecall docs\`, attached as \`bases\`.

  clear takes fields out of the corner's own row, so the runtime's default stands for them again;
  with no name, every field. There is no blank value.

  history, diff and rollback are the versions: every one kept, who set it and why; this corner
  against the team's or production's; one version back as the next one — with --prod, production's.
  pull prints the corner's config as JSON; push sends a file as the next version, --team to the
  team's corner.

  list prints every process holding this org's agents in the world asked — one line an app: its id,
  the agents it holds, whose corner, the machine and the address it connected from, the SDK, and
  since when. stop <app> closes that app's socket; a pinecall that hears it exits instead of
  dialling back, so its agents are free — though a supervisor (systemd, pm2) starts it again.`,
  run,
};


// Only checks (0, 1] locally; the gateway enforces Deepgram's bands.
const NOT_A_CONFIDENCE = (flag: string, said: string): string =>
  `--${flag} ${said} is not a confidence: a number above 0 and no higher than 1`;

// `on|off` rather than a boolean flag, so the setting can be turned off explicitly.
const NOT_ON_OR_OFF = (said: string): string => `--record ${said} is not on or off`;

function switched(said: string | undefined): boolean | undefined {
  return said === "on" ? true : said === "off" ? false : undefined;
}

// Minutes 1-60 (the runtime's range) or `off`; sent as seconds, with 0 meaning no limit.
const NOT_A_LIMIT = (said: string): string => `--max-duration ${said} is not 1 to 60 minutes, or off`;
const LONGEST_MINUTES = 60;

// A blank tag would read as set while leaving every vendor on its own default; `clear` says that.
const NO_LANGUAGE = "--language needs a tag, such as en, es or pt-BR: pinecall agent clear language takes it out";

function limitOf(said: string | undefined): number | undefined {
  if (said === undefined) return undefined;
  if (said === "off") return 0;
  const minutes = Number(said);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= LONGEST_MINUTES ? minutes * 60 : undefined;
}

function fraction(said: string | undefined): number | undefined {
  if (said === undefined) return undefined;
  const number = Number(said);
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : undefined;
}

/** Output streams, environment and editor overrides, for tests. */
export interface Setting {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Editor for `knowledge edit`; defaults to $EDITOR. */
  editor?: Editor;
}

/** Every flag the sub-verbs take, in one table because parseArgs is strict. */
export const OPTIONS = {
  agent: { type: "string" },
  json: { type: "boolean", default: false },
  team: { type: "boolean", default: false },
  note: { type: "string" },
  voice: { type: "string" },
  tts: { type: "string" },
  "tts-model": { type: "string" },
  stt: { type: "string" },
  llm: { type: "string" },
  language: { type: "string" },
  greeting: { type: "string" },
  reply: { type: "string" },
  hangup: { type: "string" },
  "endpointing-ms": { type: "string" },
  "eot-threshold": { type: "string" },
  "eager-eot-threshold": { type: "string" },
  "min-interruption-words": { type: "string" },
  record: { type: "string" },
  "max-duration": { type: "string" },
  remember: { type: "string", multiple: true },
  forget: { type: "string", multiple: true },
  against: { type: "string" },
} as const;

export type Typed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

export async function run(argv: string[], how: Setting = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const llm = values.llm === undefined ? undefined : theModelNamed(values.llm);
  if (values.llm !== undefined && llm === undefined) {
    err.write(`${NOT_A_MODEL(values.llm)}\n`);
    return 2;
  }
  // Validate before any request, so nothing is read or written.
  for (const flag of ["eot-threshold", "eager-eot-threshold"] as const) {
    const said = values[flag];
    if (said !== undefined && fraction(said) === undefined) {
      err.write(`${NOT_A_CONFIDENCE(flag, said)}\n`);
      return 2;
    }
  }
  if (values.record !== undefined && switched(values.record) === undefined) {
    err.write(`${NOT_ON_OR_OFF(values.record)}\n`);
    return 2;
  }
  if (values["max-duration"] !== undefined && limitOf(values["max-duration"]) === undefined) {
    err.write(`${NOT_A_LIMIT(values["max-duration"])}\n`);
    return 2;
  }
  if (values.language !== undefined && values.language.trim() === "") {
    err.write(`${NO_LANGUAGE}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  const [verb, ...rest] = positionals;
  try {
    if (verb === "list") return await listed(door, out);
    if (verb === "stop") return await stopped(door, rest[0], out, err);
    const aFile = notASlug(values.agent);
    if (aFile !== undefined) {
      err.write(`${aFile}\n`);
      return 2;
    }
    const agent = values.agent ?? agentOfThisDirectory();
    if (agent === null || agent === undefined) {
      err.write(`${USAGE}\n  name the agent, or run this beside an agent file\n`);
      return 2;
    }
    if (verb === undefined) return said(agent, await readSettings(door, agent), values.json === true, out);
    if (verb === "set") {
      return said(agent, await set(door, agent, { ...values, ...(llm === undefined ? {} : { llm }) }), values.json === true, out);
    }
    if (verb === "clear") return said(agent, await clear(door, agent, rest, values.team === true), values.json === true, out);
    if (verb === "history" || verb === "diff" || verb === "rollback") {
      return await versionsRun(door, agent, verb, rest, values, out, err);
    }
    if (verb === "pull" || verb === "push") return await filesRun(door, agent, verb, rest, values, out, err);
    if (verb === "knowledge") return await knowledgeRun(door, agent, rest[0], values, out, err, how.editor ?? inTheEditor);
  } catch (refused) {
    // The gateway's refusal message is specific; print it as-is.
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

// ── the verbs ───────────────────────────────────────────────────────────────────

// The door replaces the whole set, so unnamed fields are carried over from the current row.
async function set(door: Door, agent: string, values: Typed): Promise<TuningAnswer> {
  const corner = await theCornerToWrite(door, agent, values.team === true);
  return await corner.write((config) => ({ ...config, ...typed(values, config) }), values.note ?? null);
}

async function clear(door: Door, agent: string, named: string[], team: boolean): Promise<TuningAnswer> {
  const unknown = named.filter((name) => !(FIELDS as readonly string[]).includes(name));
  if (unknown.length > 0) throw new Error(`no field called ${unknown.join(", ")}: ${FIELDS.join(" · ")}`);
  const corner = await theCornerToWrite(door, agent, team);
  return await corner.write(
    (standing) => {
      const config: TuningBody = named.length === 0 ? {} : { ...standing };
      for (const name of named) delete config[WIRE[name as Field]];
      return config;
    },
    named.length === 0 ? "cleared" : `cleared ${named.join(", ")}`,
  );
}

/** The fields this command line sets, under wire names, merged over the current row where nested. */
export function typed(values: Typed, standing: TuningBody): Partial<TuningBody> {
  const wanted: Partial<TuningBody> = {};
  for (const field of ["voice", "tts", "tts-model", "stt", "llm", "language"] as const) {
    const value = values[field];
    if (typeof value === "string") (wanted as Record<string, unknown>)[WIRE[field]] = value;
  }
  if (values.greeting !== undefined) wanted.greeting = { say: values.greeting };
  else if (values.reply !== undefined) wanted.greeting = { reply: values.reply };
  if (values.hangup !== undefined) wanted.hangup = { when: values.hangup };
  const endpointing = numberOf(values["endpointing-ms"]);
  const words = numberOf(values["min-interruption-words"]);
  // Confidences are fractions, not integers.
  const sure = fraction(values["eot-threshold"]);
  const eager = fraction(values["eager-eot-threshold"]);
  if ([endpointing, words, sure, eager].some((set) => set !== undefined)) {
    wanted.turn = { ...(standing.turn ?? {}) };
    if (endpointing !== undefined) wanted.turn.endpointing_ms = endpointing;
    if (words !== undefined) wanted.turn.min_interruption_words = words;
    if (sure !== undefined) wanted.turn.eot_threshold = sure;
    if (eager !== undefined) wanted.turn.eager_eot_threshold = eager;
  }
  const records = switched(values.record);
  if (records !== undefined) wanted.record = records;
  const limit = limitOf(values["max-duration"]);
  if (limit !== undefined) wanted.max_duration_s = limit;
  if (values.remember !== undefined || values.forget !== undefined) {
    wanted.memory = {
      remember: values.remember ?? standing.memory?.remember ?? [],
      forget: values.forget ?? standing.memory?.forget ?? [],
    };
  }
  return wanted;
}

function numberOf(said: string | undefined): number | undefined {
  if (said === undefined) return undefined;
  const number = Number(said);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${said} is not a whole number`);
  return number;
}

function said(agent: string, answer: TuningAnswer, asJson: boolean, out: NodeJS.WritableStream): number {
  out.write(asJson ? `${JSON.stringify(answer)}\n` : `${linesOf(agent, answer).join("\n")}\n`);
  return 0;
}
