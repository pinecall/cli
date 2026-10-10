/** `pinecall judges`: Pinecall's judges switched on or off, the org's own and the agent's own written, and one tried on calls. */

import { parseArgs } from "node:util";

import type { JudgeList, JudgeTried, JudgeTry } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, oneHome, slugOfAgentFile } from "./home.js";
import { judgeRequestOf, judgesPath, nameRefused, tableOf, triedLines, type Asking, type Whose } from "./judge-lines.js";
import { asked, Refused, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall judges [list] [--org | --agent <name>] [--json]",
  "       pinecall judges add <name> --asks '…' [--answer verdict|score|choice:a,b,c] [--when always|simulations|trigger:'…']",
  "                           [--reads prompt,evidence,facts] [--org | --agent <name>] [--json]",
  "       pinecall judges on|off <name> [--org | --agent <name>] [--json]",
  "       pinecall judges rm <name> [--org | --agent <name>] [--json]",
  "       pinecall judges try <name> (--last <n> | --calls <id,id…>) [--asks '…' and add's flags] [--agent <name>] [--json]",
].join("\n");

export const group: Group = {
  purpose: "every judge a call meets: Pinecall's, switched on or off; the org's own and the agent's own; one tried on calls",
  usage: `${USAGE}

  Every judge is one question a model answers about a finished call, with the whole call in front
  of it — the turns, the tool calls, the positions it cites. Three lists, in the order a call meets
  them: PINECALL's library (consent, grounded, promises, disclosed, identified, honoured-stop,
  ended-well, expected-outcome on by default; relevance, repetition, sentiment off), switched on or
  off for the org (--org) or for one agent, the agent's switch winning; the ORG's own, asked of every
  agent's calls; and one AGENT's own, about its job alone. The gateway keeps all of it for both
  worlds, so the console's Judges shows the same and a change needs no deploy.

  A judge answers a verdict (held or broken), a score from 1 to 5, or one of its choices; any of
  them may answer N/A — the question did not apply, never billed. It runs on every call, only on a
  simulated one, or on a trigger: a yes-or-no asked first, and a no is N/A. Each judge that answers
  is one eval; on a model of your org's own key (\`pinecall judging --model\`) evals are not billed.

  list             every judge the list meets: whose, on or off, how it answers, when it runs
  add <name>       write one of your own: --asks is the question; the same name again replaces it
  on|off <name>    one of Pinecall's judges switched for the org (--org) or the agent
  rm <name>        one of your own dropped; Pinecall's are never dropped, only switched off
  try <name>       ask one judge of finished calls and write nothing: a written one by its name, or
                   one not yet saved, written whole with --asks and add's flags

  --asks '…'                one question about the whole call
  --answer verdict          held or broken (the default); score: 1 to 5; choice:a,b,c: one of those
  --when always             every call judged (the default); simulations: only a simulated call;
                            trigger:'…': a yes-or-no asked first, a no is N/A without the question
  --reads prompt,…          what the judge reads beside the call: the agent's prompt, the evidence
                            the call carried, the facts about it
  --last <n>, --calls a,b   try: the agent's newest n finished calls (1 to 50), or the calls named
  --org                     the org's list; --agent <name> one agent's, when the project holds more
  --json                    what the gateway answered

  Examples
    $ pinecall judges add offers-next-slot --asks "The agent offered the next free slot before the caller asked twice."
    offers-next-slot written · 12 judge(s)

    $ pinecall judges add call-reason --asks "Why did the person call?" --answer choice:book,cancel,question
    call-reason written · 13 judge(s)

    $ pinecall judges off relevance --org
    relevance off · 12 judge(s)

    $ pinecall judges try offers-next-slot --last 3
    CA_8f4a2c  ✓ held  Offered Thursday at 09:30 unasked.  [seq 14]
    CA_2b91d0  – n/a  The caller only asked the address.
    CA_77e1aa  ✗ broken  Asked twice before a slot came.  [seq 9, 17]
    3 evals · $0.0031 · nothing was written`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Judging {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

const VERBS = ["list", "add", "on", "off", "rm", "try"] as const;

const ONE_OR_THE_OTHER = "--org and --agent name two lists: the org's judges, or one agent's own";

const NONE_YET = (whose: string): string =>
  `${whose} has no judges yet: \`pinecall judges add <name> --asks '…'\` (--org for every agent's), or the console's Judges`;

const WHICH_CALLS = "try needs the calls: --last <n> (1 to 50) or --calls <id,id…>, one of them";

const NOT_A_COUNT = (said: string): string => `--last ${said} is not 1 to 50 calls`;

const TRY_IS_AN_AGENTS = "try asks one agent's calls: --agent names it, never --org";

const MOST_CALLS = 50;

// The gateway's 409 on these says what the CLI's own verb is; the hint says it in the CLI's words.
const SWITCH_IT = (name: string): string => `  pinecall judges off ${name} turns it off`;
const DROP_IT = (name: string): string => `  pinecall judges rm ${name} stops one of your own`;
const NAME_YOURS = (name: string): string => `  ${name} is Pinecall's: \`pinecall judges on|off ${name}\`, or give yours a name of its own`;

export async function run(argv: string[], how: Judging = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      asks: { type: "string" },
      answer: { type: "string" },
      when: { type: "string" },
      reads: { type: "string" },
      last: { type: "string" },
      calls: { type: "string" },
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
  let planned: Planned;
  try {
    planned = plan(verb as (typeof VERBS)[number], name, values);
  } catch (refused) {
    err.write(`${(refused as Error).message}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  const whose: Whose = values.org ? null : slugOfAgentFile((await oneHome("judges", undefined, values.agent)).file);
  try {
    return await done(door, whose, planned, values.json === true, out);
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    const hint = failed instanceof Refused && failed.status === 409 ? hintFor(verb, name!) : undefined;
    if (hint !== undefined) err.write(`${hint}\n`);
    return 1;
  }
}

/** What one invocation will ask, checked before the gateway is asked anything. */
type Planned =
  | { verb: "list" }
  | { verb: "add"; name: string; body: ReturnType<typeof judgeRequestOf> }
  | { verb: "on" | "off" | "rm"; name: string }
  | { verb: "try"; body: JudgeTry };

interface Flags extends Asking {
  last?: string | undefined;
  calls?: string | undefined;
  org?: boolean | undefined;
  agent?: string | undefined;
}

function plan(verb: (typeof VERBS)[number], name: string | undefined, values: Flags): Planned {
  if (values.org === true && values.agent !== undefined) throw new Error(ONE_OR_THE_OTHER);
  if (verb === "list") return { verb };
  const wrong = nameRefused(name!);
  if (wrong !== undefined) throw new Error(wrong);
  if (verb === "add") return { verb, name: name!, body: judgeRequestOf(values) };
  if (verb !== "try") return { verb, name: name! };
  if (values.org === true) throw new Error(TRY_IS_AN_AGENTS);
  return { verb, body: { name: name!, ...writtenInTheBody(values), ...whichCalls(values) } };
}

// A judge not yet saved travels whole; one already written, or Pinecall's, by its name alone.
function writtenInTheBody(values: Flags): Partial<JudgeTry> {
  return values.asks === undefined ? {} : judgeRequestOf(values);
}

function whichCalls(values: Flags): Pick<JudgeTry, "last" | "calls"> {
  if ((values.last === undefined) === (values.calls === undefined)) throw new Error(WHICH_CALLS);
  if (values.calls !== undefined) return { calls: values.calls.split(",").map((one) => one.trim()).filter((one) => one !== "") };
  const last = Number(values.last);
  if (!Number.isInteger(last) || last < 1 || last > MOST_CALLS) throw new Error(NOT_A_COUNT(values.last!));
  return { last };
}

async function done(door: Door, whose: Whose, planned: Planned, asJson: boolean, out: NodeJS.WritableStream): Promise<number> {
  switch (planned.verb) {
    case "list":
      return listed(whose, await asked<JudgeList>(door, judgesPath(whose)), asJson, out);
    case "add":
      return said(`${planned.name} written`, await asked<JudgeList>(door, judgesPath(whose, planned.name), { method: "PUT", body: planned.body }), asJson, out);
    case "on":
    case "off": {
      const body = { on: planned.verb === "on" };
      return said(`${planned.name} ${planned.verb}`, await asked<JudgeList>(door, judgesPath(whose, planned.name), { method: "PUT", body }), asJson, out);
    }
    case "rm":
      return said(`${planned.name} dropped`, await asked<JudgeList>(door, judgesPath(whose, planned.name), { method: "DELETE" }), asJson, out);
    case "try": {
      const tried = await asked<JudgeTried>(door, `${judgesPath(whose)}/try`, { method: "POST", body: planned.body });
      out.write(asJson ? `${JSON.stringify(tried)}\n` : `${triedLines(tried).join("\n")}\n`);
      return 0;
    }
  }
}

function hintFor(verb: string, name: string): string | undefined {
  if (verb === "rm") return SWITCH_IT(name);
  if (verb === "on" || verb === "off") return DROP_IT(name);
  if (verb === "add") return NAME_YOURS(name);
  return undefined;
}

function listed(whose: Whose, answered: JudgeList, asJson: boolean, out: NodeJS.WritableStream): number {
  if (asJson) out.write(`${JSON.stringify(answered)}\n`);
  else out.write(`${answered.judges.length === 0 ? NONE_YET(whose ?? "the org") : tableOf(answered).join("\n")}\n`);
  return 0;
}

function said(done: string, answered: JudgeList, asJson: boolean, out: NodeJS.WritableStream): number {
  out.write(asJson ? `${JSON.stringify(answered)}\n` : `${done} · ${answered.judges.length} judge(s)\n`);
  return 0;
}
