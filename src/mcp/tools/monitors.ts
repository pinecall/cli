/** The `monitors` tool: the numbers the org watches, the line each must not cross, one added or forgotten. */

import { z } from "zod";

import { METRICS, type Monitor } from "../../monitors.js";
import { asked } from "../../testing/gateway.js";
import { Refused, tool } from "../tool.js";
import { PROD } from "./fields.js";

export const monitors = tool({
  name: "monitors",
  description: "The numbers the org watches over a window — latency, the judges' held rate, escalations, tool failures, spend, calls — and the line each must not cross; list them, add one, forget one.",
  schema: {
    action: z.enum(["list", "add", "rm"]).describe("list says every monitor with the last day it fired; add watches a number; rm forgets one by id"),
    name: z.string().min(1).optional().describe("add: the monitor's name, as the alert will read"),
    metric: z.enum(METRICS).optional().describe("add: the number watched; the rates are shares from 0 to 1, the latencies seconds at the median, spend dollars"),
    above: z.boolean().optional().describe("add: true fires when the number is over the line, false when it is under (a held_rate floor)"),
    threshold: z.number().optional().describe("add: the line"),
    window_days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional().describe("add: the days the number is read over; 7 when left out"),
    agent: z.string().optional().describe("add: one agent's calls alone; every agent's when left out"),
    id: z.string().optional().describe("rm: the monitor's id, from list"),
    prod: PROD,
  },
  manual:
    "`monitors list` says what the org watches in the world — each monitor's rule, who set it, the last day it fired and the value that crossed. `add` watches one number of the observability series (the same the console's Observability screen draws) over 1, 7 or 30 days, for every agent or one, and fires once a day as `monitor.fired` on the agent's log the first time a call's seal finds it on the wrong side of the line. `rm` forgets one. Use it when the person asks to be told when latency, the judges, escalations, tool failures, spend or volume slip.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "rm") {
      if (args.id === undefined) throw new Refused("rm names the monitor's id");
      await asked(door, `/v1/monitors/${args.id}`, { method: "DELETE" });
      return { forgotten: args.id };
    }
    if (args.action === "add") {
      if (args.name === undefined || args.metric === undefined || args.above === undefined || args.threshold === undefined) {
        throw new Refused("add names the monitor, its metric, whether it fires above or below, and the threshold");
      }
      const body = {
        name: args.name,
        metric: args.metric,
        above: args.above,
        threshold: args.threshold,
        window_days: args.window_days ?? 7,
        ...(args.agent === undefined ? {} : { agent: args.agent }),
      };
      return { monitor: await asked<Monitor>(door, "/v1/monitors", { method: "POST", body }) };
    }
    return await asked<{ monitors: Monitor[] }>(door, "/v1/monitors");
  },
});
