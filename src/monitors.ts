/** `pinecall monitors`: the numbers this org watches, the line each must not cross, and when it last did. */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall monitors                                                   what this org watches
       pinecall monitors add <name> --metric <metric> --above <n> | --below <n> [--days 1|7|30] [--agent <name>]
       pinecall monitors rm <id>`;

const PATH = "/v1/monitors";
const NONE = "this org watches nothing · `pinecall monitors add` names a number and its line";

/** The numbers a monitor can watch, as the gateway names them. */
export const METRICS = ["e2e_median_s", "llm_median_s", "held_rate", "escalated_rate", "tool_failure_rate", "spend_usd", "calls"] as const;
const WINDOWS = ["1", "7", "30"] as const;

export const group: Group = {
  purpose: "the numbers this org watches — latency, the judges, escalations, tools, spend — and the line each must not cross",
  usage: `${USAGE}

  A monitor watches one number of the observability series over a window of days, for every agent
  or one, and fires — once a day, as monitor.fired on the agent's log, where the console and
  \`sessions\` show it — the first seal of a call that finds it on the wrong side of the line:

    e2e_median_s       the caller's wait from their last word to the agent's first, median, seconds
    llm_median_s       the model's time to its first token, median, seconds
    held_rate          the share of the judges' verdicts that held, 0 to 1 (--below)
    escalated_rate     the share of calls a person took over, 0 to 1
    tool_failure_rate  the share of tool calls that failed, 0 to 1
    spend_usd          what the calls cost, dollars
    calls              how many calls there were

  --above fires when the number is over the line, --below when it is under; --days is the window
  (7 when left out). The list says, per monitor, the last day it fired and the value that crossed.

  Examples
    $ pinecall monitors add "slow answers" --metric e2e_median_s --above 2 --days 7
    mon_3f9a1c2b4d5e · slow answers · e2e_median_s above 2 over 7 days · every agent
    $ pinecall monitors add "judges slipping" --metric held_rate --below 0.9 --agent front-desk
    mon_8b1d2e3f4a5c · judges slipping · held_rate below 0.9 over 7 days · front-desk
    $ pinecall monitors
    mon_3f9a1c2b4d5e  slow answers     e2e_median_s above 2 over 7 days   every agent  fired 2026-10-08 at 2.41
    mon_8b1d2e3f4a5c  judges slipping  held_rate below 0.9 over 7 days    front-desk   never fired
    $ pinecall monitors rm mon_8b1d2e3f4a5c
    mon_8b1d2e3f4a5c forgotten`,
  run,
};

/** Test overrides: streams and environment. */
export interface Watching {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

/** One monitor as the gateway lists it. */
export interface Monitor {
  id: string;
  name: string;
  metric: string;
  above: boolean;
  threshold: number;
  window_days: number;
  agent: string | null;
  created_by: string;
  fired_on: string | null;
  fired_value: number | null;
}

/** Dispatch `monitors` subcommands. */
export async function run(argv: string[], how: Watching = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const [verb, ...rest] = argv;
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === undefined) return await list(door, out);
    if (verb === "add") return await add(door, rest, out, err);
    if (verb === "rm" && rest.length === 1) return await rm(door, rest[0]!, out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

async function list(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const { monitors } = await asked<{ monitors: Monitor[] }>(door, PATH);
  out.write(monitors.length === 0 ? `${NONE}\n` : `${table(monitors).join("\n")}\n`);
  return 0;
}

async function add(door: Door, argv: string[], out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      metric: { type: "string" },
      above: { type: "string" },
      below: { type: "string" },
      days: { type: "string", default: "7" },
      agent: { type: "string" },
    },
  });
  const [name] = positionals;
  const line = values.above ?? values.below;
  const refused = aRefusal(name, positionals.length, values.metric, values.above, values.below, values.days);
  if (refused !== undefined || name === undefined || line === undefined) {
    err.write(`${refused ?? USAGE}\n`);
    return 2;
  }
  const body = {
    name,
    metric: values.metric,
    above: values.above !== undefined,
    threshold: Number(line),
    window_days: Number(values.days),
    ...(values.agent === undefined ? {} : { agent: values.agent }),
  };
  const kept = await asked<Monitor>(door, PATH, { method: "POST", body });
  out.write(`${kept.id} · ${kept.name} · ${rule(kept)} · ${kept.agent ?? "every agent"}\n`);
  return 0;
}

async function rm(door: Door, id: string, out: NodeJS.WritableStream): Promise<number> {
  await asked(door, `${PATH}/${id}`, { method: "DELETE" });
  out.write(`${id} forgotten\n`);
  return 0;
}

// Every refusal of the flags before a door is knocked; undefined when they read.
function aRefusal(name: string | undefined, named: number, metric: string | undefined, above: string | undefined, below: string | undefined, days: string): string | undefined {
  if (name === undefined || named > 1) return USAGE;
  if (metric === undefined || !(METRICS as readonly string[]).includes(metric)) return `--metric names one of ${METRICS.join(", ")}`;
  if ((above === undefined) === (below === undefined)) return "the line is --above <n> or --below <n>, one of them";
  if (!Number.isFinite(Number(above ?? below))) return `the line is a number, not ${above ?? below}`;
  if (!(WINDOWS as readonly string[]).includes(days)) return `--days is 1, 7 or 30, not ${days}`;
  return undefined;
}

/** One monitor's rule, in words: `e2e_median_s above 2 over 7 days`. */
export function rule(monitor: Monitor): string {
  return `${monitor.metric} ${monitor.above ? "above" : "below"} ${monitor.threshold} over ${monitor.window_days} day${monitor.window_days === 1 ? "" : "s"}`;
}

/** The list, one monitor per line, columns aligned. */
export function table(monitors: Monitor[]): string[] {
  const rows = monitors.map((monitor) => [monitor.id, monitor.name, rule(monitor), monitor.agent ?? "every agent", fired(monitor)]);
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!))).join("  "));
}

function fired(monitor: Monitor): string {
  return monitor.fired_on === null ? "never fired" : `fired ${monitor.fired_on} at ${monitor.fired_value}`;
}
