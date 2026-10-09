/** `pinecall sessions [call]`: list an agent's calls, or show one call's summary and score. */

import { parseArgs } from "node:util";

import { type Cost } from "@pinecall/agents/wire";
import { type SessionLine } from "@pinecall/agents/wire";

import { CannotRun } from "./cannot-run.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { asked, type Door } from "./testing/gateway.js";
import { agentOfThisDirectory, notASlug } from "./home.js";
import { BROKEN, HELD } from "./testing/score.js";
import { standingOf } from "./the-call.js";
import { refusal } from "./whoami.js";

const USAGE = "usage: pinecall sessions [list|show] [call] [--agent <slug>] [--limit <n>] [--json]";

// Optional sub-verbs, never read as a call id; whether a call id is present decides the mode.
const NOT_A_CALL: readonly string[] = ["list", "show"];

// Filtered server-side, so `show` is usually a single request.
const THE_ENDING = "call.summary,call.score";

// Max log pages (500 entries each) to scan for the ending; about an hour of call.
const PAGES = 6;

// Max characters of a judge's text per line; `--json` has the full text.
const ROOM = 96;

export const group: Group = {
  purpose: "list | show a call's log, with what it cost and how it was judged",
  usage: `${USAGE}

  With nothing after it: every call this agent has run, newest first — when it came in, how long
  it lasted, why it ended, what it cost and the one line the agent left as its outcome.

  With a call id: that call whole — the same facts, and the SCORE, one line per judge that ran
  over it with the question it answered and its own reasoning when it did not hold.

  The judging is ring 4's, at hang-up, in the gateway. This verb reads it back; it runs nothing.

  Examples
    $ pinecall sessions --limit 3
    clinica-norte · 3 calls

    ● call_314b0306e2a64daba6b6dbab129540c0  web inbound     16m 27s  live                    —
      call_df5aaa81ac7142f5a2c6f9b77033d23e  web inbound         31s  caller_hung_up    $0.0000  Clínica Norte, good morning…
      call_29d7c7b6cdd643de9c659984a0125c8c  web inbound          3s  caller_hung_up    $0.0205  Perfect. On Thursday we have…

    $ pinecall sessions call_5b1f0e9d2c7a4e8f9a1b3c5d7e9f1a2b
    call_5b1f0e9d2c7a4e8f9a1b3c5d7e9f1a2b

      outcome   Understood, Ana. Your Thursday appointment at ten with Dr. Vidal stands for now.
      ended     caller_hung_up · 1m 24s · 4 turns
      cost      $0.0505
                api.anthropic.com claude-haiku-5-5           17,621 input_tokens       $0.0018
                api.anthropic.com claude-haiku-5-5           312 output_tokens         $0.0002
                Cartesia sonic-3                             623 characters            $0.0312
                Deepgram flux-general-multi                  80.6 audio_seconds        $0.0105
                twilio twilio-inbound/+1                     2 minutes                 $0.0068`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Running {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

export async function run(argv: string[], how: Running = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { agent: { type: "string" }, limit: { type: "string" }, json: { type: "boolean", default: false } },
  });
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  const call = positionals.find((word) => !NOT_A_CALL.includes(word));
  try {
    const lines = call === undefined ? await listed(door, values, err) : await shown(door, call, values.json === true);
    if (lines === null) return 2;
    out.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (refused) {
    // CannotRun exits 2 via the dispatcher; a gateway refusal exits 1.
    if (refused instanceof CannotRun) throw refused;
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
}

// ── every call ──────────────────────────────────────────────────────────────────

async function listed(
  door: Door,
  values: { agent?: string | undefined; limit?: string | undefined; json?: boolean | undefined },
  err: NodeJS.WritableStream,
): Promise<string[] | null> {
  const aFile = notASlug(values.agent);
  if (aFile !== undefined) {
    err.write(`${aFile}\n`);
    return null;
  }
  const agent = values.agent ?? agentOfThisDirectory();
  if (agent === null || agent === undefined) {
    err.write(`${USAGE}\n  name the agent, or run this beside an agent file\n`);
    return null;
  }
  const limit = values.limit === undefined ? "" : `&limit=${encodeURIComponent(values.limit)}`;
  const { calls } = await asked<{ calls: SessionLine[] }>(
    door,
    `/v1/agents/${encodeURIComponent(agent)}/sessions?${limit.slice(1)}`,
  );
  if (values.json === true) return [JSON.stringify(calls)];
  if (calls.length === 0) return [`${agent} has run no calls`];
  return [`${agent} · ${calls.length} call${calls.length === 1 ? "" : "s"}`, "", ...calls.map(lineOf)];
}

/** Format one call as a list row: channel, duration, end reason, cost, outcome. */
export function lineOf(one: SessionLine): string {
  const held = one.live === true ? "●" : " ";
  const doors = `${one.channel ?? "—"} ${one.direction ?? "—"}`.padEnd(15);
  const ending = one.live === true ? "live" : (one.end_reason ?? one.status ?? "—");
  return `${held} ${one.call.padEnd(38)} ${doors} ${lasted(one).padStart(7)}  ${ending.padEnd(20)} ${money(one.cost).padStart(8)}  ${onOneLine(one.outcome)}`.trimEnd();
}

// ── one call ────────────────────────────────────────────────────────────────────

async function shown(door: Door, call: string, asJson: boolean): Promise<string[]> {
  // Checked first: the events door returns an empty page for an unknown call id.
  const standing = await standingOf(door, call);
  const ending = await theEndingOf(door, call);
  if (asJson) return [JSON.stringify(ending)];
  const summary = ending["call.summary"];
  const score = ending["call.score"];
  const lines = [call, ""];
  // A live call has no summary or score yet; say it is live rather than "not judged".
  if (standing.live) lines.push("  live      this call is still running — `pinecall supervise` is the desk for it", "");
  if (summary !== undefined) {
    lines.push(`  outcome   ${String(summary["outcome"] ?? "—")}`);
    lines.push(`  ended     ${String(summary["reason"] ?? "—")} · ${seconds(Number(summary["duration_s"] ?? 0))} · ${String(summary["turns"] ?? 0)} turns`);
    const cost = summary["cost"] as Cost | null | undefined;
    lines.push(`  cost      ${money(cost)}`, ...costLines(cost));
  }
  lines.push(...scoreLines(score));
  return lines;
}

/** Format a call.score: the verdict, then one line per judge, with the reason for failures. */
export function scoreLines(score: Record<string, unknown> | undefined): string[] {
  if (score === undefined) return ["  score     not judged: this call carries no call.score"];
  const why = score["not_judged"];
  if (typeof why === "string" && why !== "") return [`  score     not judged: ${why}`];
  const judges = (score["judges"] ?? []) as { name: string; verdict: string; criteria: string; reason: string }[];
  const held = score["passed"] === true;
  const asked = Number(score["judge_calls"] ?? 0);
  const cost = score["judge_cost_usd"];
  const paid = typeof cost === "number" ? ` · $${cost.toFixed(4)}` : "";
  const lines = [
    `  score     ${held ? HELD : BROKEN} ${held ? "every judge held" : "a judge answered broken"} · ${judges.length} judges · ${asked} model call${asked === 1 ? "" : "s"}${paid}`,
    "",
  ];
  const width = Math.max(0, ...judges.map((one) => one.name.length));
  for (const judge of judges) {
    const mark = judge.verdict === "held" ? HELD : BROKEN;
    // Folded: some judges put their whole evidence in `criteria`.
    lines.push(`  ${mark} ${judge.name.padEnd(width)}  ${onOneLine(judge.criteria, ROOM)}`);
    if (judge.verdict !== "held") lines.push(`    ${" ".repeat(width)}  ${onOneLine(judge.reason, ROOM)}`);
  }
  return lines;
}

/** Read call.summary and call.score from the log, paging at most PAGES times. */
async function theEndingOf(door: Door, call: string): Promise<Record<string, Record<string, unknown>>> {
  const found: Record<string, Record<string, unknown>> = {};
  let after = 0;
  for (let page = 0; page < PAGES; page += 1) {
    // The door answers 204 with no body once the cursor is past the end.
    const read = await asked<Page | null>(
      door,
      `/v1/calls/${encodeURIComponent(call)}/events?types=${THE_ENDING}&after=${after}`,
    );
    if (read === null || read.entries === undefined) break;
    for (const entry of read.entries) found[entry.type] = entry.data;
    if (read.next === null || read.next === undefined || read.next <= after) break;
    after = read.next;
  }
  return found;
}

/** One page of the call's event log. */
interface Page {
  entries: { seq: number; type: string; data: Record<string, unknown> }[];
  next?: number | null;
}

// ── formatting ──────────────────────────────────────────────────────────────────

/** Collapse whitespace and truncate to `width` with an ellipsis. */
export function onOneLine(said: string | null | undefined, width = 90): string {
  const folded = (said ?? "").replace(/\s+/g, " ").trim();
  return folded.length <= width ? folded : `${folded.slice(0, width - 1)}…`;
}

function lasted(one: SessionLine): string {
  if (one.started_at === null || one.started_at === undefined) return "—";
  const until = one.ended_at ?? Date.now() / 1000;
  return seconds(until - one.started_at);
}

/** Format seconds as `2m 14s`, or `42s` under a minute. */
export function seconds(total: number): string {
  const whole = Math.max(0, Math.round(total));
  const minutes = Math.floor(whole / 60);
  return minutes === 0 ? `${whole}s` : `${minutes}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** One line per priced row (the model, the ears, the voice, each phone leg), then what had no rate. */
export function costLines(cost: Cost | null | undefined): string[] {
  if (cost === null || cost === undefined) return [];
  const rows = cost.rows.map(
    (row) => `            ${`${row.provider} ${row.model}`.padEnd(44)} ${`${quantity(row.quantity)} ${row.unit}`.padEnd(26)} $${row.usd.toFixed(4)}`,
  );
  const unpriced = cost.unpriced.map((row) => `            ${row.provider} ${row.model}`.padEnd(56) + " no rate: not counted");
  return [...rows, ...unpriced];
}

function quantity(amount: number): string {
  return Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toFixed(1);
}

/** Format a call's cost in US dollars, or a dash when unpriced. */
export function money(cost: Cost | null | undefined): string {
  const total = cost?.usd;
  return typeof total === "number" ? `$${total.toFixed(4)}` : "—";
}
