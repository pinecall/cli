/** `pinecall runs list | show | diff | promote | drift`: inspect eval runs on this gateway. */

import { parseArgs } from "node:util";

import { theDoor } from "../env.js";
import type { Group } from "../groups.js";
import type { Door } from "../testing/gateway.js";
import { CANDIDATES, promoted } from "./candidate.js";
import { A_WINDOW_OF_CALLS, drifted, secondsOf, THRESHOLD } from "./drift.js";
import { DEFAULT_LIMIT, diffed, listed, shown } from "./suites.js";

const USAGE = [
  "usage: pinecall runs list [--limit n] | show <id> | diff <a> <b>",
  "       pinecall runs promote <call-id> [--name x] [--out test/candidates] [--from-seq n]",
  "       pinecall runs drift --agent <slug> [--window 7d] [--baseline 30d] [--threshold 10]",
  "                … any of them with --json: what the gateway answered, for a pipe",
  "",
].join("\n");

export const group: Group = {
  purpose: "the runs this gateway has done: list, show, diff, promote a call, watch the drift",
  usage: `${USAGE}  list    one line per run, newest first: when, which agent, how much held
  show    one run as \`pinecall test\` printed it when it happened
  diff    what moved between two runs, golden by golden
  promote one real call written down as a golden CANDIDATE in test/candidates, with an expect
          derived from what the judges answered. --from-seq cuts the call: the state as it stood
          there, and every caller turn after it
  drift   each judge's held-rate over two windows of finished calls, and the points between
          them. Exits 1 when a judge fell further than --threshold allows`,
  run,
};

/** Error for an invalid `--window` or `--baseline`. */
const NOT_A_WINDOW = "a window is a number and one of s, m, h, d — 90m, 24h, 7d";

export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      limit: { type: "string" },
      json: { type: "boolean", default: false },
      "from-seq": { type: "string" },
      name: { type: "string" },
      out: { type: "string" },
      agent: { type: "string" },
      window: { type: "string" },
      baseline: { type: "string" },
      threshold: { type: "string" },
    },
  });
  const door = await theDoor();
  if (door === undefined) return 2;
  const [verb, ...rest] = positionals;
  const asJson = values.json === true;
  if (verb === "list") return await listed(door, Number(values.limit ?? DEFAULT_LIMIT), asJson, out);
  if (verb === "show" && rest[0] !== undefined) return await shown(door, rest[0], asJson, out);
  if (verb === "diff" && rest[1] !== undefined) return await diffed(door, rest[0]!, rest[1], asJson, out);
  if (verb === "promote" && rest[0] !== undefined) {
    const wanted = {
      out: values.out ?? CANDIDATES,
      fromSeq: seqOf(values["from-seq"]),
      ...(values.name === undefined ? {} : { name: values.name }),
    };
    return await promoted(door, rest[0], wanted, out, process.stderr, asJson);
  }
  if (verb === "drift") return await theDrift(door, values, out, asJson);
  process.stderr.write(USAGE);
  return 2;
}

/** Validate the drift flags and run it. */
async function theDrift(
  door: Door,
  values: { agent?: string; window?: string; baseline?: string; threshold?: string; limit?: string },
  out: NodeJS.WritableStream,
  asJson: boolean,
): Promise<number> {
  if (values.agent === undefined) {
    process.stderr.write(`pinecall runs drift needs the agent it watches: --agent <slug>\n`);
    return 2;
  }
  const [window, baseline] = [secondsOf(values.window ?? "7d"), secondsOf(values.baseline ?? "30d")];
  if (window === null || baseline === null) {
    process.stderr.write(`${NOT_A_WINDOW}\n`);
    return 2;
  }
  // The windows are disjoint; a baseline containing the window would dilute the drop.
  if (baseline <= window) {
    process.stderr.write(`the baseline has to be longer than the window: it is the time BEFORE it\n`);
    return 2;
  }
  const asked = {
    agent: values.agent,
    window,
    baseline,
    threshold: Number(values.threshold ?? THRESHOLD),
    limit: Number(values.limit ?? A_WINDOW_OF_CALLS),
    now: Date.now() / 1000,
  };
  return await drifted(door, asked, out, asJson);
}

// Default seq 0: the whole call.
function seqOf(said: string | undefined): number {
  return said === undefined ? 0 : Number(said);
}
