/** An agent's settings written: the fields a person names, checked and turned into the next version of a corner — for any front. */

import { parseArgs } from "node:util";

import { type TuningAnswer, type TuningBody } from "@pinecall/agents/wire";

import { FIELDS, theCornerToWrite, WIRE, type Field } from "./agent-lines.js";
import type { Door } from "./testing/gateway.js";

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

// Only checks (0, 1] locally; the gateway enforces Deepgram's bands.
export const NOT_A_CONFIDENCE = (flag: string, said: string): string =>
  `--${flag} ${said} is not a confidence: a number above 0 and no higher than 1`;

// `on|off` rather than a boolean flag, so the setting can be turned off explicitly.
export const NOT_ON_OR_OFF = (said: string): string => `--record ${said} is not on or off`;

export function switched(said: string | undefined): boolean | undefined {
  return said === "on" ? true : said === "off" ? false : undefined;
}

// Minutes 1-60 (the runtime's range) or `off`; sent as seconds, with 0 meaning no limit.
export const NOT_A_LIMIT = (said: string): string => `--max-duration ${said} is not 1 to 60 minutes, or off`;
const LONGEST_MINUTES = 60;

// A blank tag would read as set while leaving every vendor on its own default; `clear` says that.
export const NO_LANGUAGE = "--language needs a tag, such as en, es or pt-BR: pinecall agent clear language takes it out";

export function limitOf(said: string | undefined): number | undefined {
  if (said === undefined) return undefined;
  if (said === "off") return 0;
  const minutes = Number(said);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= LONGEST_MINUTES ? minutes * 60 : undefined;
}

export function fraction(said: string | undefined): number | undefined {
  if (said === undefined) return undefined;
  const number = Number(said);
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : undefined;
}


// The door replaces the whole set, so unnamed fields are carried over from the current row.
export async function set(door: Door, agent: string, values: Typed): Promise<TuningAnswer> {
  const corner = await theCornerToWrite(door, agent, values.team === true);
  return await corner.write((config) => ({ ...config, ...typed(values, config) }), values.note ?? null);
}

export async function clear(door: Door, agent: string, named: string[], team: boolean): Promise<TuningAnswer> {
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
