/** `pinecall lexicon`: an agent's versioned pronunciations and recognition hints. */

import { parseArgs } from "node:util";

import { type LexiconAnswer, type LexiconBody, type LexiconHistory, type LexiconRow } from "@pinecall/agents/wire";

import { theCornerRead, theRowToStartFrom, theVersionGuarded } from "./agent-lines.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { dayAndTime } from "./docs.js";
import { AGENT_FLAG, agentOfThisDirectory, notASlug } from "./home.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall lexicon [--agent <slug>] [--json]",
  "       pinecall lexicon add <word> --say '…' [--agent <slug>] [--team] [--note '…']",
  "       pinecall lexicon hear <word> [<word> …] [--agent <slug>] [--team] [--note '…']",
  "       pinecall lexicon rm <word> [<word> …] [--agent <slug>] [--team]",
  "       pinecall lexicon history [--agent <slug>] [--team]",
].join("\n");

export const lexiconOf = (agent: string): string => `/v1/agents/${encodeURIComponent(agent)}/lexicon`;

export const group: Group = {
  purpose: "an agent's words: how the voice says them and what the ears must know",
  usage: `${USAGE}

  The lexicon is the agent's says and hears, which the class never sets: the agent of this
  directory, or the one --agent names by its slug. add says how a word is spoken; hear names the
  words the ears must know; rm takes words out of both. Whole and versioned like the settings: the
  corner is yours (--team: the org's own), and a save over a corner that moved is told so.

  A supervisor's or a manager's key opens this door: the person who hears a word said wrong forty
  times a day fixes it, without a developer and without a deploy — with --prod, in production,
  when their org lets them act there.

  Examples
    $ pinecall lexicon add DKV --say "de ka uve"
    lexicon · sandbox · your corner
      said     DKV → "de ka uve"
      heard    —
    $ pinecall lexicon hear "Vidal Ferrán"
    lexicon · sandbox · your corner
      said     DKV → "de ka uve"
      heard    Vidal Ferrán
    $ pinecall lexicon history
    lexicon · sandbox · corner m_berna_default
      v3 · m_berna_default · 2026-10-09 12:18   said 1 · heard 1`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Wording {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

export async function run(argv: string[], how: Wording = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...AGENT_FLAG,
      json: { type: "boolean", default: false },
      team: { type: "boolean", default: false },
      say: { type: "string" },
      note: { type: "string" },
    },
  });
  const aFile = notASlug(values.agent);
  if (aFile !== undefined) {
    err.write(`${aFile}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  const agent = values.agent ?? agentOfThisDirectory();
  if (agent === null) {
    err.write(`${USAGE}\n  name the agent, or run this beside an agent file\n`);
    return 2;
  }
  const lexicon = lexiconOf(agent);
  const [verb, ...words] = positionals;
  const team = values.team === true;
  try {
    if (verb === undefined) return said(await asked<LexiconAnswer>(door, lexicon), values.json === true, out);
    if (verb === "add" && words[0] !== undefined && values.say !== undefined) {
      return said(await changed(door, lexicon, team, values.note, (words_) => ({ ...words_, said: { ...words_.said, [words[0]!]: values.say! } })), values.json === true, out);
    }
    if (verb === "hear" && words.length > 0) {
      return said(await changed(door, lexicon, team, values.note, (words_) => ({ ...words_, heard: [...new Set([...words_.heard, ...words])] })), values.json === true, out);
    }
    if (verb === "rm" && words.length > 0) {
      return said(
        await changed(door, lexicon, team, values.note, (words_) => ({
          said: Object.fromEntries(Object.entries(words_.said).filter(([word]) => !words.includes(word))),
          heard: words_.heard.filter((word) => !words.includes(word)),
        })),
        values.json === true,
        out,
      );
    }
    if (verb === "history") return await history(door, lexicon, team, out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

/** Editable form of the lexicon: word → spoken form, plus the heard list. */
export interface Words {
  said: Record<string, string>;
  heard: string[];
}

function wordsOf(body: LexiconBody | undefined): Words {
  return { said: Object.fromEntries((body?.said ?? []).map((one) => [one.word, one.spoken])), heard: [...(body?.heard ?? [])] };
}

function bodyOf(words: Words): LexiconBody {
  return { said: Object.entries(words.said).map(([word, spoken]) => ({ word, spoken })), heard: words.heard };
}

// Read-modify-write of the whole row, guarded by the version it was read at.
export async function changed(door: Door, lexicon: string, team: boolean, note: string | undefined, change: (words: Words) => Words): Promise<LexiconAnswer> {
  const standing = await asked<LexiconAnswer>(door, lexicon);
  // The words start from what this key reads; the guard is the version of the corner the gateway
  // writes, or two saves at once overwrite each other, or a person's first one is refused.
  const row = theRowToStartFrom(standing, team);
  return await asked<LexiconAnswer>(door, lexicon, {
    method: "PUT",
    body: { lexicon: bodyOf(change(wordsOf(row?.lexicon))), if_version: theVersionGuarded(standing, team, door), note: note ?? null, team },
  });
}

async function history(door: Door, lexicon: string, team: boolean, out: NodeJS.WritableStream): Promise<number> {
  const kept = await asked<LexiconHistory>(door, `${lexicon}/history?team=${team}`);
  out.write(`lexicon · ${kept.world} · ${kept.holder === "" ? "the org's own corner" : `corner ${kept.holder}`}\n`);
  if (kept.rows.length === 0) out.write("  nothing set yet\n");
  for (const row of kept.rows) out.write(`  ${rowLine(row)}   said ${row.lexicon.said.length} · heard ${row.lexicon.heard.length}\n`);
  return 0;
}

function rowLine(row: LexiconRow): string {
  const said = [`v${row.version}`, row.author, dayAndTime(row.set_at)];
  if (row.note !== null) said.push(`"${row.note}"`);
  return said.join(" · ");
}

function said(answer: LexiconAnswer, asJson: boolean, out: NodeJS.WritableStream): number {
  out.write(asJson ? `${JSON.stringify(answer)}\n` : `${linesOf(answer).join("\n")}\n`);
  return 0;
}

/** Render the effective lexicon, then each corner's version. */
export function linesOf(answer: LexiconAnswer): string[] {
  const read = theCornerRead(answer);
  const lines = [`lexicon · ${answer.world}${answer.yours === null ? "" : " · your corner"}`];
  if (read === null) lines.push("  nothing set: the voice says every word as it is written");
  else {
    const spoken = read.lexicon.said.map((one) => `${one.word} → "${one.spoken}"`).join(" · ");
    lines.push(`  said     ${spoken || "—"}`);
    lines.push(`  heard    ${read.lexicon.heard.join(" · ") || "—"}`);
  }
  lines.push("");
  const corners: [string, LexiconRow | null][] = [["yours", answer.yours], ["team", answer.team], ["production", answer.production]];
  lines.push(`  ${corners.map(([name, row]) => `${name}: ${row === null ? "nothing set" : rowLine(row)}`).join(" · ")}`);
  return lines;
}
