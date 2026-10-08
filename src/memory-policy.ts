/** `pinecall memory policy`: show or set what the agent remembers and forgets about callers. */

import { parseArgs } from "node:util";

import { type TuningAnswer } from "@pinecall/agents/wire";

import { readSettings } from "./agent-lines.js";
import { set } from "./agent-setting.js";
import { theDoor } from "./env.js";
import { agentOfThisDirectory, notASlug } from "./home.js";
import { refusal } from "./whoami.js";

const USAGE = "usage: pinecall memory policy [--agent <slug>] [--remember '…' …] [--forget '…' …] [--team] [--note '…']";

/** Output streams and environment overrides, for tests. */
export interface Keeping {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

// No lists given: print each corner's policy. Given lists replace the field whole, as `agent set --remember` does.
export async function policy(argv: string[], how: Keeping = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: "string" },
      team: { type: "boolean", default: false },
      note: { type: "string" },
      remember: { type: "string", multiple: true },
      forget: { type: "string", multiple: true },
    },
  });
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
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
  try {
    if (values.remember === undefined && values.forget === undefined) return said(agent, await readSettings(door, agent), out);
    return said(agent, await set(door, agent, { ...values, json: false }), out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
}

function said(agent: string, answer: TuningAnswer, out: NodeJS.WritableStream): number {
  out.write(`${agent} · ${answer.world}\n`);
  for (const [name, row] of [["yours", answer.yours], ["team", answer.team], ["production", answer.production]] as const) {
    const memory = row?.config.memory ?? undefined;
    if (row === null) {
      out.write(`  ${name.padEnd(12)}${name === "yours" ? "(team's)" : "nothing set"}\n`);
      continue;
    }
    if (memory === undefined) {
      out.write(`  ${name.padEnd(12)}v${row.version} · nothing remembered\n`);
      continue;
    }
    out.write(`  ${name.padEnd(12)}v${row.version}\n`);
    for (const line of memory.remember ?? []) out.write(`    remember  ${line}\n`);
    for (const line of memory.forget ?? []) out.write(`    forget    ${line}\n`);
  }
  return 0;
}
