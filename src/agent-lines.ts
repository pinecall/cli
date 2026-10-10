/** Render an agent's settings in its three corners, and read them from the gateway. */

import { type TuningAnswer, type TuningBody, type TuningRow } from "@pinecall/agents/wire";

import { dayAndTime } from "./docs.js";
import { asked, type Door } from "./testing/gateway.js";
import { SANDBOX } from "./world.js";

/** The gateway path of an agent's settings. */
export function settingsPath(agent: string): string {
  return `/v1/agents/${encodeURIComponent(agent)}/settings`;
}

/** Read the three corners as this key sees them: its own, the team's, production's. */
export async function readSettings(door: Door, agent: string): Promise<TuningAnswer> {
  return await asked<TuningAnswer>(door, settingsPath(agent));
}

/**
 * Whether this key writes a corner of its own: a person's key in the sandbox. A server's token
 * (`pc_test_` is the sandbox's), and every key in production, writes the org's own — the gateway's
 * `scope_of`. A person whose corner is still empty reads `yours: null` too, which is why the
 * answer alone cannot say.
 */
export function holdsACorner(door: Door): boolean {
  return door.world === SANDBOX && !door.apiKey.startsWith("pc_test_");
}

/** The row a write lands on: the team's on `--team` or for a key with no corner, else this key's own, null until its first write. */
export function theCornerWritten<Row>(standing: { yours: Row | null; team: Row | null }, team: boolean, door: Door): Row | null {
  return team || !holdsACorner(door) ? standing.team : standing.yours;
}

/** The version a write is guarded by: the newest of the corner it lands on, 0 when that corner is empty. */
export function theVersionGuarded(standing: { yours: { version: number } | null; team: { version: number } | null }, team: boolean, door: Door): number {
  return theCornerWritten(standing, team, door)?.version ?? 0;
}

/** The row a write starts from: the team's on `--team`, else what this key reads, so the whole set travels. */
export function theRowToStartFrom<Row>(standing: { yours: Row | null; team: Row | null }, team: boolean): Row | null {
  return team ? standing.team : theCornerRead(standing);
}

/** Map the current config to the next one. */
export type Change = (config: TuningBody) => TuningBody;

/** A corner read once, with a writer for its next version. */
export interface TheCorner {
  /** The row the write starts from: what this key reads, or the team's on `--team`. */
  row: TuningRow | null;
  /** The whole set, with this change made, as the next version. */
  write(change: Change, note: string | null): Promise<TuningAnswer>;
}

/**
 * Read the corner a write will land on. Every settings write goes through here: the door takes
 * the whole set with its read version, so a body built on the wrong row erases fields silently.
 */
export async function theCornerToWrite(door: Door, agent: string, team: boolean): Promise<TheCorner> {
  const standing = await readSettings(door, agent);
  const row = theRowToStartFrom(standing, team);
  const ifVersion = theVersionGuarded(standing, team, door);
  return {
    row,
    write: async (change: Change, note: string | null) =>
      await asked<TuningAnswer>(door, settingsPath(agent), {
        method: "PUT",
        body: { config: change(row?.config ?? {}), if_version: ifVersion, note, team },
      }),
  };
}

/** The corner this key reads: its own if it has one, else the team's. */
export function theCornerRead<Row>(standing: { yours: Row | null; team: Row | null }): Row | null {
  return standing.yours ?? standing.team;
}

/** The name of the corner a write lands on, for output. */
export function theCornerCalled(standing: TuningAnswer, team: boolean, door: Door): string {
  if (standing.world === "production") return "production";
  return team || !holdsACorner(door) ? "the team's corner" : "your corner";
}

/** Settings fields in display order, as typed on the command line. */
export const FIELDS = [
  "voice",
  "tts",
  "tts-model",
  "tts-builds",
  "tts-options",
  "stt",
  "stt-builds",
  "stt-options",
  "llm",
  "temperature",
  "llm-builds",
  "llm-options",
  "language",
  "greeting",
  "hangup",
  "turn",
  "memory",
  "record",
  "max-duration",
  "knowledge",
  "bases",
] as const;
export type Field = (typeof FIELDS)[number];

/** Command-line field name to wire field name. */
export const WIRE: Record<Field, keyof TuningBody> = {
  voice: "voice",
  tts: "tts",
  "tts-model": "tts_model",
  "tts-builds": "tts_builds",
  "tts-options": "tts_options",
  stt: "stt",
  "stt-builds": "stt_builds",
  "stt-options": "stt_options",
  llm: "llm",
  temperature: "temperature",
  "llm-builds": "llm_builds",
  "llm-options": "llm_options",
  language: "language",
  greeting: "greeting",
  hangup: "hangup",
  turn: "turn",
  memory: "memory",
  record: "record",
  "max-duration": "max_duration_s",
  knowledge: "knowledge",
  bases: "bases",
};

/** What the class calls the setting a field is part of: a field it declares is fixed, and set by it. */
export const DECLARED_AS: Partial<Record<Field, string>> = {
  voice: "voice",
  tts: "voice",
  "tts-model": "voice",
  "tts-builds": "voice",
  "tts-options": "voice",
  stt: "stt",
  "stt-builds": "stt",
  "stt-options": "stt",
  llm: "llm",
  temperature: "llm",
  "llm-builds": "llm",
  "llm-options": "llm",
  language: "language",
  greeting: "greeting",
  hangup: "hangup",
  turn: "turn",
  memory: "memory",
  record: "record",
  knowledge: "knowledge",
  bases: "docs",
};

// Max cell width; longer values are truncated so three columns fit.
const A_CELL = 40;

/** One field of one config, as a cell of the page; undefined when the config does not set it. */
export function shown(config: TuningBody, field: Field): string | undefined {
  // The wire sends either absent or null for "not set".
  if (field === "greeting") {
    const greeting = config.greeting ?? undefined;
    if (greeting === undefined) return undefined;
    const say = greeting.say ?? undefined;
    return say !== undefined ? `"${say}"` : `reply: ${greeting.reply ?? ""}`;
  }
  if (field === "hangup") {
    const hangup = config.hangup ?? undefined;
    if (hangup === undefined) return undefined;
    return hangup.when === "" || hangup.when === null || hangup.when === undefined ? "may hang up" : `when ${hangup.when}`;
  }
  if (field === "turn") {
    const turn = config.turn ?? undefined;
    if (turn === undefined) return undefined;
    const said: string[] = [];
    if (turn.endpointing_ms !== undefined && turn.endpointing_ms !== null) said.push(`endpointing ${turn.endpointing_ms} ms`);
    if (turn.min_interruption_words !== undefined && turn.min_interruption_words !== null) said.push(`interrupt at ${turn.min_interruption_words} words`);
    if (turn.eot_threshold !== undefined && turn.eot_threshold !== null) said.push(`sure at ${turn.eot_threshold}`);
    if (turn.eager_eot_threshold !== undefined && turn.eager_eot_threshold !== null) said.push(`guesses at ${turn.eager_eot_threshold}`);
    return said.join(" · ");
  }
  if (field === "memory") {
    const memory = config.memory ?? undefined;
    if (memory === undefined) return undefined;
    return `remember ${memory.remember?.length ?? 0} · forget ${memory.forget?.length ?? 0}`;
  }
  // false is meaningful (no audio kept); undefined falls through to the next corner.
  if (field === "record") {
    const records = config.record ?? undefined;
    return records === undefined ? undefined : records ? "keeps the audio" : "keeps no audio";
  }
  // Zero means no limit.
  if (field === "max-duration") {
    const seconds = config.max_duration_s ?? undefined;
    return seconds === undefined ? undefined : seconds === 0 ? "no limit" : `${seconds / 60} min`;
  }
  if (field === "temperature") {
    const temperature = config.temperature ?? undefined;
    return temperature === undefined ? undefined : String(temperature);
  }
  if (field === "llm-options" || field === "stt-options" || field === "tts-options") {
    const options = config[WIRE[field] as "llm_options"] ?? undefined;
    if (options === undefined) return undefined;
    return Object.entries(options).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" · ");
  }
  if (field === "knowledge") {
    const text = config.knowledge ?? undefined;
    return text === undefined ? undefined : `${text.length.toLocaleString("en-US")} chars`;
  }
  if (field === "bases") {
    const bases = config.bases ?? undefined;
    if (bases === undefined || bases.length === 0) return undefined;
    return bases.map((one) => `${one.base}${one.k === undefined || one.k === null ? "" : ` (k ${one.k})`}`).join(" · ");
  }
  const value = config[WIRE[field]];
  return typeof value === "string" ? value : undefined;
}

/** One version as a line: number, author, time and note. */
export function versionLine(row: TuningRow): string {
  const said = [`v${row.version}`, row.author, dayAndTime(row.set_at)];
  if (row.note !== null) said.push(`"${row.note}"`);
  return said.join(" · ");
}

/**
 * Render the settings table: one column per corner, one row per field, then each corner's
 * version. An unset corner shows what it falls back to, e.g. `(team's)`; a field the class fixes
 * says `class` in every corner, since no corner's value is read for it.
 */
export function linesOf(agent: string, answer: TuningAnswer): string[] {
  const corners: { name: string; row: TuningRow | null; fallsTo: string }[] = [
    { name: "yours", row: answer.yours, fallsTo: "(team's)" },
    { name: "team", row: answer.team, fallsTo: "—" },
    { name: "production", row: answer.production, fallsTo: "—" },
  ];
  const fixed = new Set(answer.fixed);
  const cell = (corner: (typeof corners)[number], field: Field): string => {
    const declared = DECLARED_AS[field];
    if (declared !== undefined && fixed.has(declared)) return "class";
    if (corner.row === null) return corner.fallsTo;
    const value = shown(corner.row.config, field);
    if (value === undefined) return "—";
    return value.length > A_CELL ? `${value.slice(0, A_CELL - 1)}…` : value;
  };
  const widths = corners.map((corner) => Math.max(corner.name.length, ...FIELDS.map((field) => cell(corner, field).length)) + 2);
  const lines = [`${agent} · ${answer.world}`, ""];
  lines.push(`  ${"".padEnd(14)}${corners.map((corner, at) => corner.name.padEnd(widths[at]!)).join("")}`.trimEnd());
  for (const field of FIELDS) {
    lines.push(`  ${field.replace("-", " ").padEnd(14)}${corners.map((corner, at) => cell(corner, field).padEnd(widths[at]!)).join("")}`.trimEnd());
  }
  lines.push("");
  lines.push(`  ${corners.map((corner) => `${corner.name}: ${corner.row === null ? "nothing set" : versionLine(corner.row)}`).join(" · ")}`);
  return lines;
}
