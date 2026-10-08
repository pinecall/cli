/** `pinecall cases`: the org's dataset — real calls kept as cases — read, decided, pulled into the repository, kept and forgotten. */

import { parseArgs } from "node:util";

import { caseLines, inboxLines } from "./case-lines.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, oneHome, slugOfAgentFile } from "./home.js";
import { A_NOTE_ALONE, casesOf, caseNamed, decided, forgotten, keptAsCase, pulled, STATUSES, type CaseStatus, type EvalCase } from "./testing/cases.js";
import type { Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall cases [list] [--status pending|approved|dismissed] [--agent <name>] [--json]",
  "       pinecall cases show <name> · approve <name> · reopen <name> · forget <name>",
  "       pinecall cases dismiss <name> [--judge-was-wrong <judge>] [--note '…']",
  "       pinecall cases pull <name> [--out test/<agent>/goldens]",
  "       pinecall cases keep <call-id> --name x [--held-out]",
  "       … any of them with --json, and --agent <name> when the project holds more than one agent",
].join("\n");

export const group: Group = {
  purpose: "the org's dataset: real calls kept as cases — read, approve, dismiss, pull into the repository",
  usage: `${USAGE}

  A call a judge broke on is kept at hang-up as a PENDING case: its caller's lines, the state it
  opened in, the facts it was given, and an expect that says what must not happen again. A person
  reads it, reproduces it (\`pinecall test --case <name>\`), fixes the agent, and approves it into
  the nightly (\`pinecall test --dataset\`) or dismisses it. A case is addressed by its name within
  the agent.

  list             one line a case, the pending first: status, name, the judges that broke, the
                   world the call ran in, its age; and how many wait of how many may
  show <name>      the case whole: what broke and why, the caller's lines, the state, the expect,
                   the call it came from and its settings version, and what to type next
  approve <name>   the nightly plays it from now on
  dismiss <name>   nothing to fix. --judge-was-wrong <judge> says the judge that broke should have
                   held, kept as a calibration label of the call; --note goes on that label
  reopen <name>    pending again
  pull <name>      its golden written as <name>.json in the agent's goldens folder (--out moves
                   it), and the case marked as kept in the repository: the nightly plays the file
  keep <call-id>   a finished call kept as an approved case, named --name; --held-out plays it only
                   when a run names it. Its expect is the one the call's broken verdicts give
  forget <name>    the case dropped; the call it came from stays

  --agent <name>   whose cases, when the project holds more than one agent
  --json           what the gateway answered`,
  run,
};

/** Output streams, the environment and the clock, for tests. */
export interface Casing {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

const VERBS = ["list", "show", "approve", "dismiss", "reopen", "pull", "keep", "forget"] as const;

type Verb = (typeof VERBS)[number];

// The flags each verb takes beside --agent and --json; any other is refused there.
const FLAGS: Record<Verb, readonly string[]> = {
  list: ["status"],
  show: [],
  approve: [],
  dismiss: ["judge-was-wrong", "note"],
  reopen: [],
  pull: ["out"],
  keep: ["name", "held-out"],
  forget: [],
};

const NOT_A_STATUS = (said: string): string => `--status ${said}: ${STATUSES.join(", ")}`;

const NOT_ITS_FLAG = (flag: string, verb: Verb): string => `--${flag} means nothing to \`cases ${verb}\`: \`pinecall cases --help\` says which verb takes it`;

const KEEP_NEEDS_A_NAME = "keep names the case it makes: --name x, the name `pinecall test --case` plays it by";

/** The flags as parsed. */
interface Asked {
  status?: string;
  "judge-was-wrong"?: string;
  note?: string;
  out?: string;
  name?: string;
  "held-out"?: boolean;
  agent?: string;
  json?: boolean;
}

export async function run(argv: string[], how: Casing = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      status: { type: "string" },
      "judge-was-wrong": { type: "string" },
      note: { type: "string" },
      out: { type: "string" },
      name: { type: "string" },
      "held-out": { type: "boolean" },
      json: { type: "boolean", default: false },
      ...AGENT_FLAG,
    },
  });
  const [verb = "list", named] = positionals;
  if (!isVerb(verb) || (verb !== "list" && named === undefined)) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const refused = whyNot(verb, values);
  if (refused !== undefined) {
    err.write(`${refused}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === "keep") return printed(await keptAsCase(door, { call: named!, name: values.name!, ...(values["held-out"] === true ? { held_out: true } : {}) }), keptLine, values, out);
    const home = await oneHome("cases", undefined, values.agent);
    const agent = slugOfAgentFile(home.file);
    if (verb === "list") return await listed(door, agent, values, out, (how.now ?? (() => Date.now() / 1000))());
    return await onOne(door, { agent, name: named!, goldens: values.out ?? home.goldens }, verb, values, out);
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return 1;
  }
}

function isVerb(said: string): said is Verb {
  return (VERBS as readonly string[]).includes(said);
}

function isStatus(said: string): said is CaseStatus {
  return (STATUSES as readonly string[]).includes(said);
}

/** What refuses the line before the gateway is asked, or undefined. */
function whyNot(verb: Verb, values: Asked): string | undefined {
  const taken = new Set(["agent", "json", ...FLAGS[verb]]);
  const stray = Object.keys(values).find((flag) => !taken.has(flag));
  if (stray !== undefined) return NOT_ITS_FLAG(stray, verb);
  if (values.status !== undefined && !isStatus(values.status)) return NOT_A_STATUS(values.status);
  if (values.note !== undefined && values["judge-was-wrong"] === undefined) return `--${A_NOTE_ALONE}`;
  if (verb === "keep" && (values.name === undefined || values.name.trim() === "")) return KEEP_NEEDS_A_NAME;
  return undefined;
}

async function listed(door: Door, agent: string, values: Asked, out: NodeJS.WritableStream, now: number): Promise<number> {
  const status = values.status !== undefined && isStatus(values.status) ? values.status : undefined;
  const list = await casesOf(door, agent, status);
  out.write(values.json === true ? `${JSON.stringify(list)}\n` : `${inboxLines(agent, list, now).join("\n")}\n`);
  return 0;
}

/** One case of one agent, and the goldens folder a pull writes it into. */
interface Named {
  agent: string;
  name: string;
  goldens: string;
}

/** A verb on one case by its name. */
async function onOne(door: Door, named: Named, verb: Exclude<Verb, "list" | "keep">, values: Asked, out: NodeJS.WritableStream): Promise<number> {
  const { agent, name } = named;
  if (verb === "show") return printed(await caseNamed(door, agent, name), (one) => caseLines(one).join("\n"), values, out);
  if (verb === "forget") return printed(await forgotten(door, agent, name), (one) => `${one.name} forgotten: the call it came from, ${one.source_call}, stays`, values, out);
  if (verb === "pull") {
    const { path, case: marked } = await pulled(door, agent, name, named.goldens);
    out.write(values.json === true ? `${JSON.stringify({ path, case: marked })}\n` : `${path}\n${marked.name} is kept in the repository now: the nightly plays the file, not the case\n`);
    return 0;
  }
  if (verb === "approve") return printed(await decided(door, agent, name, { status: "approved" }), (one) => `${one.name} approved: the nightly plays it`, values, out);
  if (verb === "reopen") return printed(await decided(door, agent, name, { status: "pending" }), (one) => `${one.name} pending again`, values, out);
  const wrong = values["judge-was-wrong"];
  const decision = { status: "dismissed" as const, ...(wrong === undefined ? {} : { judge_was_wrong: wrong }), ...(values.note === undefined ? {} : { note: values.note }) };
  return printed(await decided(door, agent, name, decision), (one) => `${one.name} dismissed${wrong === undefined ? "" : ` · ${wrong} labelled as wrong on ${one.source_call}`}`, values, out);
}

function keptLine(one: EvalCase): string {
  return `${one.name} kept · ${one.status} · ${one.agent} · from ${one.source_call}\n  expect  ${JSON.stringify(one.golden.expect ?? {})}`;
}

// The case as the gateway answered under --json, else the one line saying what happened to it.
function printed(one: EvalCase, line: (one: EvalCase) => string, values: Asked, out: NodeJS.WritableStream): number {
  out.write(values.json === true ? `${JSON.stringify(one)}\n` : `${line(one)}\n`);
  return 0;
}
