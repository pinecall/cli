/** `pinecall memory`: show or forget a contact's memory, and score recall against a golden. */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import { type ContactFact, type ContactMemory, type Forgotten, type MemoryScore } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { dayAndTime, theQuestionsIn } from "./docs.js";
import { AGENT_FLAG, homeOf, oneHome, theAgentHere } from "./home.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall memory <contact>
       pinecall memory forget <contact> [--yes]
       pinecall memory policy [--remember '…' …] [--forget '…' …] [--team] [--note '…'] [--agent <slug>]
       pinecall memory eval [golden.json] [--k <n>] [--agent <name>] [--file agent.tsx]`;

// Takes the whole golden; each question carries its own facts, so no contact is involved.
const EVAL = "/v1/contacts/memory/eval";

/** Error messages for a missing or empty golden, shared by the terminal and the console. */
export const NO_GOLDEN = (golden: string): string => `no golden at ${golden}: a JSON list of {holds, asks, expects}`;
export const AN_EMPTY_GOLDEN = (golden: string): string =>
  `${golden} holds no questions: a golden is a JSON list of {holds, asks, expects}`;

// An erasure is never done on nobody's word: `data erase` asks for --yes the same way.
export const SAY_YES = (contact: string): string =>
  `forgetting ${contact} cannot be undone, and nobody is at a terminal to say so: run it again with --yes`;

// Superseded facts are dimmed on a TTY.
const DIM = "\u001b[2m";
const PLAIN = "\u001b[0m";

export const group: Group = {
  purpose: "what memory kept about a contact, forget it on request, and what a golden says of recall",
  usage: `${USAGE}

  With a contact — the caller's number, or the id the app named — prints everything memory ever
  kept about them: the current facts first, then the ones a later call superseded, with the date
  they stopped holding. forget erases all of it, the right to be forgotten; on a terminal it asks
  once, and it prints how many facts went. Without a terminal (a script, CI) it erases only with
  --yes, which also skips the question.

  eval asks recall every question of a golden — a JSON list of {holds, asks, expects}, where holds
  is what memory holds about that question's contact — and prints recall@k and nDCG@10, computed by
  code with no model in the loop, plus every question it did not answer whole. No contact of yours
  is read or written: each question's facts go to a scratch contact and are deleted again. A golden
  is fixed and the ranking is the variable: never soften a question so a change can pass.

  policy is what the agent keeps about a caller and what it never does — the org's to say, set in
  the world beside the agent's other settings (\`pinecall agent\`), and a supervisor's or a
  manager's key opens it. With nothing typed it prints the policy of the three corners.`,
  run,
};

/** Test overrides: streams, environment and the forget confirmation. */
export interface Recalling {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Ask the person to confirm a forget; without it, a terminal is asked, and no terminal is no. */
  confirm?: (question: string) => Promise<boolean>;
}

/** Dispatch `memory` subcommands. */
export async function run(argv: string[], how: Recalling = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  // `policy` has its own flags, so it parses its own argv.
  if (argv[0] === "policy") return await (await import("./memory-policy.js")).policy(argv.slice(1), how);
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { file: { type: "string" }, k: { type: "string" }, yes: { type: "boolean", default: false }, ...AGENT_FLAG },
  });
  const [verb, second] = positionals;
  // Refused before the gateway is asked: nothing is read or erased on nobody's word.
  const asking = values.yes === true ? undefined : (how.confirm ?? (process.stdin.isTTY === true ? askOnATerminal : undefined));
  if (verb === "forget" && second !== undefined && values.yes !== true && asking === undefined) {
    err.write(`${SAY_YES(second)}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === "eval") {
      const file = second === undefined ? (await oneHome("memory eval", values.file, values.agent)).file : values.file;
      return await evaluate(door, second, values.k, file, out, err);
    }
    if (verb === "forget" && second !== undefined) {
      return await forget(door, second, asking, out);
    }
    if (verb !== undefined && verb !== "forget") return await history(door, verb, out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

async function history(door: Door, contact: string, out: NodeJS.WritableStream): Promise<number> {
  const remembered = await asked<ContactMemory>(door, memoryPath(contact));
  if (remembered.facts.length === 0) {
    out.write(`nothing remembered about ${contact}\n`);
    return 0;
  }
  const dim = (out as { isTTY?: boolean }).isTTY === true;
  for (const fact of remembered.facts) {
    out.write(`${factLine(fact, dim)}\n`);
  }
  return 0;
}

async function forget(
  door: Door,
  contact: string,
  confirm: ((question: string) => Promise<boolean>) | undefined,
  out: NodeJS.WritableStream,
): Promise<number> {
  if (confirm !== undefined && !(await confirm(`forget everything memory kept about ${contact}? [y/N] `))) {
    out.write("nothing forgotten\n");
    return 0;
  }
  const gone = await asked<Forgotten>(door, memoryPath(contact), { method: "DELETE" });
  out.write(`forgotten: ${gone.forgotten}\n`);
  return 0;
}

async function evaluate(
  door: Door,
  file: string | undefined,
  k: string | undefined,
  agent: string | undefined,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const golden = resolve(file ?? homeOf(agent ?? theAgentHere()).memoryGolden);
  if (!existsSync(golden)) {
    err.write(`${NO_GOLDEN(golden)}\n`);
    return 2;
  }
  const questions = theQuestionsIn(golden);
  if (questions === null) {
    err.write(`${AN_EMPTY_GOLDEN(golden)}\n`);
    return 2;
  }
  const score = await recalledOn(door, questions, k === undefined ? undefined : Number(k));
  out.write(`${recallLines(score).join("\n")}\n`);
  return score.misses.length === 0 ? 0 : 1;
}

/** Run a golden's questions against recall and return recall@k and nDCG@10. */
export async function recalledOn(door: Door, questions: unknown[], k: number | undefined): Promise<MemoryScore> {
  return await asked<MemoryScore>(door, EVAL, { method: "POST", body: { questions, ...(k === undefined ? {} : { k }) } });
}

/** Format a recall score: a summary line, then one line per missed question. */
export function recallLines(score: MemoryScore): string[] {
  const figures =
    `memory · ${score.model} · ${score.questions} questions · ` +
    `recall@${score.k} ${score.recall_at_k.toFixed(2)} · nDCG@10 ${score.ndcg_at_10.toFixed(2)} · ` +
    `${Math.round(score.took_ms)} ms`;
  return [
    figures,
    ...score.misses.map(
      (missed) => `  missed: ${missed.asks} → wanted ${missed.missing.join(", ")}, got ${missed.found[0] ?? "nothing"}`,
    ),
  ];
}

/** Format a fact with its category and, if superseded, the date it stopped holding (dimmed). */
export function factLine(fact: ContactFact, dim: boolean): string {
  const said = [`- ${fact.text}`];
  if (fact.category) said.push(`(${fact.category})`);
  if (fact.invalidated_at === null) return said.join(" ");
  said.push(`· until ${dayAndTime(fact.invalidated_at)}`);
  const line = said.join(" ");
  return dim ? `${DIM}${line}${PLAIN}` : line;
}

function memoryPath(contact: string): string {
  return `/v1/contacts/${encodeURIComponent(contact)}/memory`;
}

async function askOnATerminal(question: string): Promise<boolean> {
  const reading = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((typed) => reading.question(question, typed));
  reading.close();
  return /^y(es)?$/i.test(answer.trim());
}
