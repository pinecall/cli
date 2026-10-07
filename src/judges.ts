/** `pinecall judges`: list, write and drop the agent's own judges, kept by the gateway. */

import { parseArgs } from "node:util";

import { RunsOnSchema, type Judge, type JudgeList, type JudgePut, type RunsOn } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, oneHome, slugOfAgentFile } from "./home.js";
import { asked } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall judges [list] [--org | --agent <name>] [--json]",
  "       pinecall judges add <name> --asks '…' [--on every-call|simulations] [--org | --agent <name>] [--json]",
  "       pinecall judges rm <name> [--org | --agent <name>] [--json]",
].join("\n");

export const group: Group = {
  purpose: "the org's judges and the agent's own: a question asked of calls at hang-up",
  usage: `${USAGE}

  The runtime judges every finished call on its own panel — consent, grounded, promises, and the
  caller's rule on a simulation. Beside it, two lists the org writes, each judge one more question
  the judge model answers held or broken with the whole call in front of it: the ORG's, asked of
  every agent's calls (never gave medical advice), and one AGENT's own, about its job alone (did
  it offer the next free slot). Both are kept by the gateway for both worlds, so the console's
  Judges shows the same ones and a change needs no deploy. The verdict lands in call.score beside
  the panel's, under the judge's name; a panel's name, or one the org and an agent would share, is
  refused.

  list             the judges of the list named, with what each asks and which calls it reads
  add <name>       write one: --asks is the question; the same name again replaces it
  rm <name>        the judge dropped

  --asks '…'           one sentence about the whole call, held or broken
  --on every-call      every call the org judges at hang-up (the default); simulations: only a
                       call a persona played, so it costs nothing on real traffic
  --org                the org's judges, asked of every agent's calls
  --agent <name>  which agent's own, when the project holds more than one; the project's one
                       agent when neither is given
  --json               the list as the gateway answered it`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Judging {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

const VERBS = ["list", "add", "rm"] as const;

// Mirrors the gateway's name rule so a bad name gets a readable error.
const A_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NAME_SHAPE = (name: string): string =>
  `${name} is no name for a judge: lower-case letters and digits joined by hyphens — offers-next-slot`;

const NO_QUESTION = "a judge needs --asks: the one sentence the judge model answers about the call";

const NOT_WHEN = (said: string): string => `--on ${said}: every-call or simulations`;

const NONE_YET = (whose: string): string =>
  `${whose} has no judges yet: \`pinecall judges add <name> --asks '…'\` (--org for every agent's), or the console's Judges`;

const ONE_OR_THE_OTHER = "--org and --agent name two lists: the org's judges, or one agent's own";

/** Whose judges: the org's (null), or one agent's by its slug. */
type Whose = string | null;

const RUNS_ON: Record<RunsOn, string> = { "every-call": "every call", simulations: "simulations" };

export async function run(argv: string[], how: Judging = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      asks: { type: "string" },
      on: { type: "string" },
      json: { type: "boolean", default: false },
      org: { type: "boolean", default: false },
      ...AGENT_FLAG,
    },
  });
  const [verb = "list", name] = positionals;
  if (!(VERBS as readonly string[]).includes(verb) || (verb !== "list" && name === undefined)) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const refused = values.org && values.agent !== undefined ? ONE_OR_THE_OTHER : verb === "add" ? whyNot(name!, values.asks, values.on) : undefined;
  if (refused !== undefined) {
    err.write(`${refused}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  const whose: Whose = values.org ? null : slugOfAgentFile((await oneHome("judges", undefined, values.agent)).file);
  const asJson = values.json === true;
  try {
    if (verb === "list") return listed(whose, await asked<JudgeList>(door, judgesOf(whose)), asJson, out);
    if (verb === "rm") return said(`${name!} dropped`, await asked<JudgeList>(door, judgesOf(whose, name), { method: "DELETE" }), asJson, out);
    const body: JudgePut = { question: values.asks!.trim(), runs_on: RunsOnSchema.parse(values.on ?? "every-call") };
    return said(`${name!} written`, await asked<JudgeList>(door, judgesOf(whose, name), { method: "PUT", body }), asJson, out);
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return 1;
  }
}

/** What refuses an `add` before anything is asked of the gateway, or undefined. */
function whyNot(name: string, asks: string | undefined, on: string | undefined): string | undefined {
  if (!A_NAME.test(name)) return NAME_SHAPE(name);
  if (asks === undefined || asks.trim() === "") return NO_QUESTION;
  if (on !== undefined && !RunsOnSchema.safeParse(on).success) return NOT_WHEN(on);
  return undefined;
}

function judgesOf(whose: Whose, name?: string): string {
  const list = whose === null ? "/v1/org/judges" : `/v1/agents/${encodeURIComponent(whose)}/judges`;
  return `${list}${name === undefined ? "" : `/${encodeURIComponent(name)}`}`;
}

function listed(whose: Whose, answered: JudgeList, asJson: boolean, out: NodeJS.WritableStream): number {
  if (asJson) out.write(`${JSON.stringify(answered)}\n`);
  else out.write(`${answered.judges.length === 0 ? NONE_YET(whose ?? "the org") : asATable(answered.judges).join("\n")}\n`);
  return 0;
}

function said(done: string, answered: JudgeList, asJson: boolean, out: NodeJS.WritableStream): number {
  out.write(asJson ? `${JSON.stringify(answered)}\n` : `${done} · ${answered.judges.length} judge(s)\n`);
  return 0;
}

/** One line per judge: its name, which calls it reads, and its question. */
function asATable(judges: readonly Judge[]): string[] {
  const wide = Math.max(...judges.map((judge) => judge.name.length));
  return judges.map((judge) => `${judge.name.padEnd(wide)}  ${RUNS_ON[judge.runs_on].padEnd(11)}  ${judge.question}`);
}
