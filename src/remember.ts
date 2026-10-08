/** `pinecall remember [paths]`: run memory extraction goldens against the agent. */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { type ExtractionGolden, type ExtractionRun } from "@pinecall/agents/wire";

import { whileServing, type Spawns } from "./child.js";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, oneHome } from "./home.js";
import { servingOne } from "./language.js";
import { extracted } from "./testing/gateway.js";
import { CASES, casesIn, matching, NO_CASES } from "./testing/goldens.js";
import { BROKEN, HELD } from "./testing/score.js";
import { refusal } from "./whoami.js";

/** Default location of extraction goldens, separate from the conversation goldens. */

const USAGE = "usage: pinecall remember [paths] [--agent <name>] [--file agent.tsx] [--grep x] [--json]";

export const group: Group = {
  purpose: "the goldens memory.remember is held to: what a call teaches, and what it never keeps",
  usage: `${USAGE}

  A case is one call written down — both speakers, because nothing is re-run — the facts memory
  already holds, and what must come of it: which categories got a fact, which never did, which
  values must not survive in any fact's text, and which held facts the call contradicted.

  Each case costs ONE model call, the very one a hang-up makes, run by the gateway on the org's
  own keys against the agent a process this terminal starts is holding. Every answer is judged by code: a category
  is the class's own word, a value is a literal, a supersession is an id — never one sentence
  compared to another, because two ways of writing one fact are one fact.`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Running {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  spawns?: Spawns;
}

/**
 * Serve the agent from a process this terminal starts (as `pinecall test` does) so the gateway
 * reads its memory categories off its declaration,
 * then run extraction on the gateway with the org's model and keys.
 */
export async function run(argv: string[], how: Running = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      ...AGENT_FLAG,
      grep: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  // Outside an agent folder, fall back to the default path so the error says where cases belong.
  const home = await oneHome("remember", values.file, values.agent).catch(() => undefined);
  const folder = home?.memoryCases ?? CASES;
  const paths = positionals.length > 0 ? positionals : [folder];
  if (positionals.length === 0 && !existsSync(folder)) {
    err.write(`${home === undefined ? NO_CASES : NO_CASES.replace(CASES, folder)}\n${USAGE}\n`);
    return 2;
  }
  const cases = matching(await casesIn<ExtractionGolden>(paths, CASES), values.grep);
  if (cases.length === 0) {
    err.write(`no case matched${values.grep === undefined ? "" : ` --grep ${values.grep}`}\n`);
    return 2;
  }
  // Asked again outside an agent folder, so the refusal names where an agent belongs.
  const agent = home ?? (await oneHome("remember", values.file, values.agent));
  // A console's process, so a real call never rings in a terminal running a suite.
  const started = servingOne(door, agent, { console: true });
  return await whileServing(started, agent.name, async () => {
    try {
      const answer = await extracted(door, agent.name, cases);
      out.write(values.json === true ? `${JSON.stringify(answer)}\n` : `${linesOf(answer).join("\n")}\n`);
      return answer.held === answer.cases ? 0 : 1;
    } catch (refused) {
      err.write(`${refusal(refused)}\n`);
      return 1;
    }
  }, how.spawns);
}


/** Format a run: a summary line, then details for each failed case. */
export function linesOf(answer: ExtractionRun): string[] {
  const counted = `${answer.cases} case${answer.cases === 1 ? "" : "s"}`;
  const lines = [
    `${answer.agent} · ${answer.model} · ${counted} · ${answer.held} held · ${Math.round(answer.took_ms)} ms`,
  ];
  for (const result of answer.results) {
    if (result.held) {
      lines.push(`  ${HELD} ${result.name}`);
      continue;
    }
    const broke = result.broke ?? [];
    const width = Math.max(...broke.map((one) => one.check.length));
    lines.push(`  ${BROKEN} ${result.name}`);
    for (const one of broke) lines.push(`      ${one.check.padEnd(width)}  ${one.detail}`);
    for (const wrote of result.wrote ?? []) lines.push(`      kept      ${wrote}`);
    for (const refused of result.refused ?? []) lines.push(`      refused   ${refused}`);
  }
  return lines;
}

export { CASES, NO_CASES };
