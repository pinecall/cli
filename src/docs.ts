/** `pinecall docs push | list | drop | eval | attach | detach | attached`: manage knowledge bases. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { type KnowledgeFile } from "@pinecall/agents/wire";
import { type TuningAnswer } from "@pinecall/agents/wire";
import { type KnowledgeList, type KnowledgePushed, type KnowledgeScore } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { readSettings, theCornerRead } from "./agent-lines.js";
import { attach, attached, attachingOf, detach } from "./docs-attach.js";
import { AGENT_FLAG, agentOfThisDirectory, type Home, homeOf, homesFor, notASlug, oneHome, theAgentHere } from "./home.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall docs push [dir] [--base <name>] [--agent <name>] [--file agent.tsx]
       pinecall docs list
       pinecall docs drop <base>
       pinecall docs eval [docs.json] [--base <name>] [--k <n>] [--agent <name>] [--file agent.tsx]
       pinecall docs attach <base> [--k <n>] [--mode retrieved|tool] [--min-score <x>] [--agent <slug>] [--team]
       pinecall docs detach <base> [--agent <slug>] [--team]
       pinecall docs attached
                                        … and any of them with --prod, in production`;

/** Errors raised locally before anything is sent. */
export const NO_DIRECTORY = (directory: string): string => `no documents directory at ${directory}`;
export const NO_MARKDOWN = (directory: string): string => `no *.md under ${directory}: nothing to push`;
export const NO_GOLDEN = (golden: string): string => `no golden at ${golden}: a JSON list of {asks, expects}`;
export const AN_EMPTY_GOLDEN = (golden: string): string =>
  `${golden} holds no questions: a golden is a JSON list of {asks, expects}`;

export const group: Group = {
  purpose: "the documents the agent searches: pushed as a base, listed, dropped, held to a golden, attached",
  usage: `${USAGE}

  push reads every *.md under the directory (docs/<name>/ of the project when none is named) and
  sends the folder whole to PUT /v1/knowledge/<base>: the base is replaced, never merged. The base
  is the agent's slug unless --base says otherwise. list prints every base this org has pushed in
  the world asked; drop removes one. These are the documents a turn SEARCHES — the RAG. What the
  agent knows by heart is not a document: it is its settings' knowledge (\`pinecall agent
  knowledge\`), read whole on every call.

  attach says an agent reads a base — in your own corner, or the team's with --team, or in
  production with --prod — with how a turn reads it: --k chunks, --mode (retrieved: the platform
  searches before the turn; tool: the model decides when), --min-score. It is one field of the
  agent's settings (\`pinecall agent\`), written as the next version. detach takes it out;
  attached prints which agents read which base in the world asked.

  eval asks the base every question of a golden — test/<name>/goldens/docs.json, a JSON list of
  {asks, expects}, where expects is the heading path the answer should carry — and prints
  recall@k and nDCG@10, computed by code with no model in the loop, plus every question it
  missed and what came back instead. A golden is fixed and the index is the variable: never
  soften a question so a change can pass.

  Examples
    $ pinecall docs push
    clinica-norte · 7 files · 41 chunks · 812 ms      # base · sent · became · took

    $ pinecall docs attach clinica-norte --k 4
    clinica-norte · clinica-norte attached · your corner v4
    $ pinecall docs attached
    clinica-norte · read by clinica-norte`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Pushing {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

/** Parse the sub-verb and run it. */
export async function run(argv: string[], how: Pushing = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      file: { type: "string" },
      k: { type: "string" },
      mode: { type: "string" },
      "min-score": { type: "string" },
      team: { type: "boolean", default: false },
      ...AGENT_FLAG,
    },
  });
  const [verb, ...rest] = positionals;
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === "attached") return await attached(door, out);
    if ((verb === "attach" || verb === "detach") && rest[0] !== undefined) {
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
      if (verb === "attach") return await attach(door, agent, rest[0], attachingOf(values), values.team, out);
      return await detach(door, agent, rest[0], values.team, out, err);
    }
    if (verb === "push" || verb === "eval") {
      // With no dir/golden/base given, a project root means every agent that has docs or a golden.
      const typed = rest[0] !== undefined || values.base !== undefined;
      const homes = typed ? [] : await homesFor(values.file, values.agent);
      if (homes.length > 1) {
        let worst = 0;
        for (const home of homes) {
          const has = verb === "push" ? existsSync(home.docs) : existsSync(home.docsGolden);
          if (!has) {
            out.write(`${home.name} · no ${verb === "push" ? `documents at ${home.docs}` : `golden at ${home.docsGolden}`}\n`);
            continue;
          }
          worst = Math.max(worst, verb === "push" ? await pushHome(door, home, out, err) : await evaluateHome(door, home, values.k, out, err));
        }
        return worst;
      }
      if (homes.length === 1 && !typed) {
        return verb === "push" ? await pushHome(door, homes[0]!, out, err) : await evaluateHome(door, homes[0]!, values.k, out, err);
      }
    }
    // Resolve the agent's file only when the base or path is not given explicitly.
    const theFile = async (): Promise<string | undefined> =>
      values.base !== undefined && rest[0] !== undefined ? values.file : (await oneHome(`docs ${verb}`, values.file, values.agent)).file;
    if (verb === "push") return await push(door, rest[0], values.base, await theFile(), out, err);
    if (verb === "list") return await list(door, out);
    if (verb === "drop" && rest[0] !== undefined) return await drop(door, rest[0], out);
    if (verb === "eval") return await evaluate(door, rest[0], values.base, values.k, await theFile(), out, err);
  } catch (refused) {
    // Print the gateway's refusal as-is; it names the fix.
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

// Dir and base default to the agent's `docs/<name>/` and slug.
async function push(
  door: Door,
  dir: string | undefined,
  base: string | undefined,
  agent: string | undefined,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const home = dir === undefined || base === undefined ? homeOf(agent ?? theAgentHere()) : undefined;
  const directory = resolve(dir ?? home!.docs);
  const name = base ?? home!.name;
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    err.write(`${NO_DIRECTORY(directory)}\n`);
    return 2;
  }
  const files = markdownUnder(directory);
  if (files.length === 0) {
    err.write(`${NO_MARKDOWN(directory)}\n`);
    return 2;
  }
  out.write(`${pushedLine(await pushedTo(door, name, files), files.length)}\n`);
  return 0;
}

async function list(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const answered = await asked<KnowledgeList>(door, "/v1/knowledge");
  if (answered.bases.length === 0) {
    out.write(`no base pushed yet: pinecall docs push sends docs/<name>/ under the agent's slug\n`);
    return 0;
  }
  for (const base of answered.bases) {
    out.write(`${base.base} · ${base.chunks} chunks · pushed ${dayAndTime(base.pushed_at)}\n`);
  }
  return 0;
}

async function drop(door: Door, base: string, out: NodeJS.WritableStream): Promise<number> {
  await asked(door, `/v1/knowledge/${encodeURIComponent(base)}`, { method: "DELETE" });
  out.write(`dropped ${base}\n`);
  return 0;
}

async function evaluate(
  door: Door,
  file: string | undefined,
  base: string | undefined,
  k: string | undefined,
  agent: string | undefined,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
  // The agent whose attachment supplies k when none is given.
  readBy?: string,
): Promise<number> {
  const home = file === undefined || base === undefined ? homeOf(agent ?? theAgentHere()) : undefined;
  const golden = resolve(file ?? home!.docsGolden);
  const name = base ?? home!.name;
  const reader = readBy ?? home?.name;
  if (!existsSync(golden)) {
    err.write(`${NO_GOLDEN(golden)}\n`);
    return 2;
  }
  const questions = theQuestionsIn(golden);
  if (questions === null) {
    err.write(`${AN_EMPTY_GOLDEN(golden)}\n`);
    return 2;
  }
  // Default k: the agent's attachment for this base, else the gateway's default.
  const attachment = reader === undefined ? null : await readSettings(door, reader).catch(() => null);
  const asked = k === undefined ? theKItIsReadWith(attachment, name) : Number(k);
  const score = await scoredOn(door, name, questions, asked);
  out.write(`${scoreLines(score).join("\n")}\n`);
  return score.misses.length === 0 ? 0 : 1;
}

// Evaluate at the k the agent actually reads the base with, not the gateway's default (8):
// otherwise recall is measured at a k no call uses. Undefined when the agent doesn't read the base.
export function theKItIsReadWith(standing: TuningAnswer | null, base: string): number | undefined {
  const corner = standing === null ? null : theCornerRead(standing);
  return (corner?.config.bases ?? []).find((one) => one.base === base)?.k ?? undefined;
}

/** Upload files as a base; the base is replaced, never merged. */
export async function pushedTo(door: Door, base: string, files: KnowledgeFile[]): Promise<KnowledgePushed> {
  return await asked<KnowledgePushed>(door, `/v1/knowledge/${encodeURIComponent(base)}`, {
    method: "PUT",
    body: { files },
  });
}

/** Score a golden's questions against a base (recall@k and nDCG@10). */
export async function scoredOn(
  door: Door,
  base: string,
  questions: unknown[],
  k: number | undefined,
): Promise<KnowledgeScore> {
  return await asked<KnowledgeScore>(door, `/v1/knowledge/${encodeURIComponent(base)}/eval`, {
    method: "POST",
    body: { questions, ...(k === undefined ? {} : { k }) },
  });
}

/** The questions in a golden file, or null when it has none. */
export function theQuestionsIn(golden: string): unknown[] | null {
  const questions: unknown = JSON.parse(readFileSync(golden, "utf8"));
  return Array.isArray(questions) && questions.length > 0 ? questions : null;
}

/** Format a score: a summary line, then one line per missed question. */
export function scoreLines(score: KnowledgeScore): string[] {
  const figures =
    `${score.base} · ${score.model} · ${score.questions} questions · ` +
    `recall@${score.k} ${score.recall_at_k.toFixed(2)} · nDCG@10 ${score.ndcg_at_10.toFixed(2)} · ` +
    `${Math.round(score.took_ms)} ms`;
  return [
    figures,
    ...score.misses.map(
      (missed) => `  missed: ${missed.asks} → wanted ${missed.expects}, got ${missed.found[0] ?? "nothing"}`,
    ),
  ];
}

/** The line a push prints: base, files, chunks and time taken. */
export function pushedLine(pushed: KnowledgePushed, files: number): string {
  return `${pushed.base} · ${files} files · ${pushed.chunks} chunks · ${Math.round(pushed.took_ms)} ms`;
}

/** Every *.md under a directory, recursively, with POSIX paths relative to it. */
export function markdownUnder(directory: string): KnowledgeFile[] {
  const found: KnowledgeFile[] = [];
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(entry.parentPath, entry.name);
    found.push({ path: relative(directory, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
  }
  return found.sort((one, other) => (one.path < other.path ? -1 : 1));
}

/** Format Unix seconds as `YYYY-MM-DD HH:MM` in UTC. */
export function dayAndTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** Push one agent's docs to the base named by its slug. */
async function pushHome(door: Door, home: Home, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  return await push(door, home.docs, home.name, home.file, out, err);
}

/** Evaluate one agent's golden against its base. */
async function evaluateHome(
  door: Door,
  home: Home,
  k: string | undefined,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  return await evaluate(door, home.docsGolden, home.name, k, home.file, out, err, home.name);
}
