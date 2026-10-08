/** The testing tools: the goldens run (`test`), the suites kept (`runs`), and one real call checked again by code (`eval`). */

import { join } from "node:path";

import { z } from "zod";

import { replayed } from "../../eval.js";
import { CANDIDATES, promotedTo } from "../../runs/candidate.js";
import { theDrift } from "../../runs/drift.js";
import { movedBetween } from "../../runs/suites.js";
import { aRun, oneRun, theRuns, type EvalRun, type Wanted } from "../../testing/gateway.js";
import { goldensIn, matching } from "../../testing/goldens.js";
import { modelOf } from "../../testing/models.js";
import { held, reportOfTheRun } from "../../testing/suite.js";
import type { Session } from "../session.js";
import { Refused, tool } from "../tool.js";
import { AGENT, PROD, WAIT, WAIT_S } from "./fields.js";

const DAY_S = 86_400;

export const test = tool({
  name: "test",
  description: "Run the agent's goldens through the agent this server holds, under every model named, written or said out loud; waits for the matrix.",
  schema: {
    action: z.enum(["run", "wait"]),
    agent: z.string().optional().describe("the agent's name; the only one held when left out"),
    grep: z.string().optional().describe("only goldens whose name holds this"),
    models: z.array(z.string()).optional().describe("a column per model: vendor/model, a model, or a tier (haiku); the agent's own when left out"),
    voice: z.boolean().optional().describe("say the goldens out loud on a real line"),
    background_noise: z.number().optional().describe("spoken runs: dB of noise under the caller"),
    packet_loss: z.number().min(0).max(1).optional().describe("spoken runs: the share of the caller's packets lost, 0 to 1"),
    wait_s: WAIT,
  },
  manual:
    "`test run` runs the goldens in `test/<agent>/goldens/` through the agent `start` holds, the gateway driving and scoring each conversation, a column per model in `models`. It answers the matrix once done — every golden held or broken, with the evidence, each call's latency, and a reproduction written under `.pinecall/evals/` for each that broke — or, past `wait_s`, the run's id: call `test wait` to keep waiting. One run per agent at a time. A spoken run (`voice`) can add noise and packet loss.",
  handler: async (args, session) => {
    const held_ = session.holding(args.agent);
    const waitS = args.wait_s ?? WAIT_S;
    const pending = session.runs.get(held_.home.name);
    if (args.action === "wait") {
      if (pending === undefined) throw new Refused(`no run of ${held_.home.name} in flight: call test with action run`);
      return await waited(session, held_.home.name, pending, waitS);
    }
    if (pending !== undefined) throw new Refused(`a run of ${held_.home.name} is in flight: call test with action wait for it`);
    const app = await held_.ready();
    const goldens = matching(await goldensIn([held_.home.goldens]), args.grep);
    if (goldens.length === 0) throw new Refused(`no golden${args.grep === undefined ? "" : ` matching ${args.grep}`} in ${held_.home.goldens}`);
    const models = (args.models ?? []).map((one) => {
      const model = modelOf(one);
      if (model === undefined) throw new Refused(`${one} names no model: vendor/model, a vendor's model, or haiku, sonnet, opus`);
      return model;
    });
    const wanted: Wanted = {
      agent: held_.home.name,
      goldens,
      app,
      ...(models.length > 0 ? { models } : {}),
      ...(args.voice === true ? { voice: true } : {}),
      ...(args.voice === true && args.background_noise !== undefined ? { interferer_db: args.background_noise } : {}),
      ...(args.voice === true && args.packet_loss !== undefined ? { packet_loss: args.packet_loss } : {}),
    };
    const door = held_.door;
    const started = aRun(door, wanted).then(async (run) => ({ ...(await reportOfTheRun(door, run, goldens)), held: held(run) }));
    session.runs.set(held_.home.name, started);
    return await waited(session, held_.home.name, started, waitS);
  },
});

// A run outlives the host's patience: past the wait, its id, and `test wait` picks it up.
async function waited(session: Session, agent: string, pending: Promise<unknown>, waitS: number): Promise<unknown> {
  const late = Symbol("late");
  try {
    const done = await Promise.race([pending, new Promise((rung) => setTimeout(() => rung(late), waitS * 1000))]);
    if (done !== late) {
      session.runs.delete(agent);
      return done;
    }
  } catch (failed) {
    session.runs.delete(agent);
    throw failed;
  }
  const running = (await theRuns(session.holding(agent).door, 1, agent))[0];
  return { status: "running", run: running?.id ?? null, says: "call test with action wait to keep waiting, or runs show with this id" };
}

export const runs = tool({
  name: "runs",
  description: "The suites the gateway kept: the newest, one run's matrix, what moved between two, a real call written as a golden candidate, and each judge's drift.",
  schema: {
    action: z.enum(["list", "show", "diff", "promote", "drift"]),
    agent: AGENT,
    run: z.string().optional().describe("`show`: the run's id"),
    before: z.string().optional().describe("`diff`: the earlier run"),
    after: z.string().optional().describe("`diff`: the later run"),
    call: z.string().optional().describe("`promote`: the call to write as a golden candidate"),
    name: z.string().optional().describe("`promote`: the candidate's file name"),
    window_days: z.number().min(1).optional().describe("`drift`: the recent window, 7 days when left out"),
    baseline_days: z.number().min(1).optional().describe("`drift`: the days before it compared against, 30 when left out; longer than the window"),
    threshold: z.number().min(0).optional().describe("`drift`: the drop in points that counts, 10 when left out"),
    prod: PROD,
  },
  manual:
    "`runs list` and `show` read the suites the gateway kept; `diff` says which goldens moved between two runs. `promote` writes one real, judged call as a golden candidate under `test/candidates/` — read it before you keep it. `drift` compares each judge's held-rate in the last week with the month before it and names the judges past the threshold.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "show") return await oneRun(door, needed(args.run, "run"));
    if (args.action === "diff") {
      const [was, now] = await Promise.all([oneRun(door, needed(args.before, "before")), oneRun(door, needed(args.after, "after"))]);
      return { before: was.id, after: now.id, moved: movedBetween(was, now) };
    }
    if (args.action === "promote") {
      const root = await session.project();
      return await promotedTo(door, needed(args.call, "call"), { ...(args.name === undefined ? {} : { name: args.name }), out: join(root, CANDIDATES), fromSeq: 0 });
    }
    const name = (await session.home(args.agent)).name;
    if (args.action === "list") return { runs: (await theRuns(door, 20, name)).map(summaryOf) };
    const window = (args.window_days ?? 7) * DAY_S;
    const baseline = (args.baseline_days ?? 30) * DAY_S;
    if (baseline <= window) throw new Refused("the baseline is the time before the window: make it longer than the window");
    return await theDrift(door, { agent: name, window, baseline, threshold: args.threshold ?? 10, limit: 200, now: Date.now() / 1000 });
  },
});

export const evalTool = tool({
  name: "eval",
  description: "Check one finished call again by code: consent, banned words, errors, latency, talk share, interruptions — held, broken, deferred or skipped.",
  schema: {
    call: z.string().describe("the call's id"),
    banned: z.array(z.string()).optional().describe("words the agent must not say"),
    budget: z.record(z.string(), z.number()).optional().describe("seconds per latency (e2e_latency, llm_node_ttft, tts_node_ttfb), talk_share 0..1; replaces the defaults whole"),
    prod: PROD,
  },
  manual: "`eval` rebuilds one finished call from its log and runs the six code checks on it, no model asked. A `budget` replaces the default latencies whole, so name every key you want checked.",
  handler: async (args, session) =>
    await replayed(await session.door(args.prod), args.call, { ...(args.banned === undefined ? {} : { banned: args.banned }), ...(args.budget === undefined ? {} : { budget: args.budget }) }),
});

function needed(value: string | undefined, name: string): string {
  if (value === undefined || value === "") throw new Refused(`${name} is needed for this action`);
  return value;
}

function summaryOf(run: EvalRun): Record<string, unknown> {
  return { id: run.id, status: run.status, failures: run.matrix?.failures.length ?? null, started_at: run.started_at, finished_at: run.finished_at };
}
