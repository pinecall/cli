/** `pinecall eval <call-id>`: re-evaluate one real call with the runtime's code checks (ring 3). */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { readNamedJson } from "./named-file.js";
import { asked, type Door } from "./testing/gateway.js";

/** One check's result from `POST /v1/evals/replay/{call}`. */
export interface Verdict {
  check: string;
  status: string;
  detail: string;
}

/** The replay response for one call. */
export interface Answer {
  call: string;
  agent: string;
  passed: boolean;
  verdicts: Verdict[];
}

/** Replay policy: banned phrases and latency budgets. */
export interface Case {
  banned?: string[];
  budget?: Record<string, number>;
}

export const group: Group = {
  purpose: "ring 3: one real call, re-evaluated",
  usage: `usage: pinecall eval <call-id> [--policy policy.json] [--json]

  One finished call rebuilt from its log and answered by the runtime's four CODE checks —
  consent, register, errors, latency. Nothing is re-run and no model is asked; the verdicts are
  the operator's vocabulary (passed · failed · deferred · skipped), never a judge's four words.
  Exits 1 when a check did not hold.

  --policy file   {"banned": ["…"], "budget": {"llm_ttft": 1.5}} — the words this business will
                  not have its agent say, and the latencies it holds a call to
  --json          the answer as the door wrote it`,
  run,
};

/** Run the replay on the gateway and print the verdicts; exits 1 when a check fails. */
export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: "boolean", default: false }, policy: { type: "string" } },
  });
  const call = positionals[0];
  if (call === undefined) {
    process.stderr.write("usage: pinecall eval <call-id> [--policy policy.json] [--json]\n");
    return 2;
  }
  const door = await theDoor();
  if (door === undefined) return 2;
  // Read the policy before any request, so a bad path fails as a usage error.
  const policy = theCase(values.policy);
  let answer: Answer;
  try {
    answer = await replayed(door, call, policy);
  } catch (refused) {
    process.stderr.write(`${refused instanceof Error ? refused.message : String(refused)}\n`);
    return 1;
  }
  out.write(values.json === true ? `${JSON.stringify(answer)}\n` : `${linesOf(answer).join("\n")}\n`);
  return answer.passed ? 0 : 1;
}

/** Replay the code checks over one call. Also used by `simulate --judge` after every turn. */
export async function replayed(door: Door, call: string, said: Case): Promise<Answer> {
  return asked<Answer>(door, replayPath(call), { method: "POST", body: said });
}

/** The replay endpoint path for a call. */
export function replayPath(call: string): string {
  return `/v1/evals/replay/${encodeURIComponent(call)}`;
}

/** The full replay URL for a call. */
export function replayUrl(base: string, call: string): string {
  return `${base.replace(/\/$/, "")}${replayPath(call)}`;
}

/** Format the answer: a header line, then one aligned line per check. */
export function linesOf(answer: Answer): string[] {
  const width = Math.max(...answer.verdicts.map((verdict) => verdict.check.length));
  return [
    `${answer.call}  ${answer.agent}`,
    ...answer.verdicts.map(
      (verdict) => `  ${verdict.check.padEnd(width)}  ${verdict.status.padEnd(8)}  ${verdict.detail}`,
    ),
  ];
}

function theCase(policy: string | undefined): Case {
  if (policy === undefined) return {};
  return readNamedJson<Case>("--policy", policy);
}
