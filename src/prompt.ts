/** `pinecall prompt [agent.tsx] --state file`: the prompt a state produces, printed by the agent's serve entry. */

import { parseArgs } from "node:util";

import { cannotRun } from "./cannot-run.js";
import { runOnce } from "./child.js";
import { AGENT_FLAG, oneHome } from "./home.js";
import type { Group } from "./groups.js";
import { startedWith, type Started } from "./language.js";
import { readNamedJson } from "./named-file.js";

/** One case of a goldens file; only its starting state is read here. */
interface Case {
  state?: Record<string, unknown>;
}

export const group: Group = {
  purpose: "the exact prompt a state would produce, offline",
  offline: true,
  usage: `usage: pinecall prompt [agent.tsx] [--state <file>] [--case n] [--agent <name>]
                       [--channel phone|web|whatsapp] [--medium voice|text]

  The three regions of the prompt as the model would receive them — the static prefix, the
  history, the dynamic blocks at the end — and under them the stage and the tools that stage
  shows. No gateway, no key, no call: the agent's own serve entry loads the class and puts it in
  the state the file describes, so this answers in the time it takes to save the file.

  --agent <name>  which agent of a project of several, by its folder's name
  --state file    a goldens file: an array of cases, each with its own \`state\`, or one object;
                  without it, the state the class opens a call in
  --case n        which case of that file, when it holds several (default 0)
  --channel name  the call the prompt is for, which picks its <channel> block (default phone)
  --medium how    voice or text; without it, the one the channel implies (whatsapp is text)

  Examples
    $ pinecall prompt --state test/clinica-norte/goldens/identifica-al-paciente.json
    ── identity (static) ──
    You are the front desk of Clínica Norte. Formal, short sentences. …

    ── knowledge (static) ──

    ── tools (static) ──
    <tools>
    - findPatient: Finds the patient's file … `,
  run,
};

/** What `prompt` runs the serve entry with; a test hands in its own. */
export type RunOnce = (started: Started, out: NodeJS.WritableStream, err: NodeJS.WritableStream) => Promise<number>;

/** Print the prompt the case's state produces, through the agent's serve entry. No gateway needed. */
export async function run(
  argv: string[],
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
  runs: RunOnce = runOnce,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      state: { type: "string" },
      case: { type: "string" },
      channel: { type: "string", default: "phone" },
      medium: { type: "string" },
      ...AGENT_FLAG,
    },
  });
  const home = await oneHome("prompt", positionals[0], values.agent);
  // No file is the state the class opens a call in.
  const state = values.state === undefined ? {} : firstState(values.state, values.case);
  const pairs = Object.entries(state).flatMap(([field, value]) => ["--state", `${field}=${JSON.stringify(value)}`]);
  const medium = values.medium === undefined ? [] : ["--medium", values.medium];
  const args = ["--file", home.file, "--slug", home.name, ...pairs, "--channel", values.channel, ...medium, "--show-machine"];
  return await runs(startedWith(undefined, home.file, "prompt", args, { root: home.root }), out, err);
}

/** The state of case `which` (default 0) in a goldens file; a single object counts as one case. */
export function firstState(file: string, which: string | undefined): Record<string, unknown> {
  const parsed = readNamedJson<Case | Case[]>("--state", file);
  const cases = Array.isArray(parsed) ? parsed : [parsed];
  const index = which === undefined ? 0 : Number(which);
  const chosen = cases[index];
  if (chosen === undefined) throw cannotRun(`${file} has no case ${index}`);
  return chosen.state ?? {};
}
