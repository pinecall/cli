/** The `cases` tool: the org's dataset — real calls kept as cases — read, decided, pulled into the repository, kept and forgotten, over the cores `pinecall cases` runs. */

import { z } from "zod";

import { A_NOTE_ALONE, casesOf, caseNamed, decided, forgotten, keptAsCase, pulled, STATUSES } from "../../testing/cases.js";
import { Refused, tool } from "../tool.js";
import { AGENT, PROD } from "./fields.js";

export const cases = tool({
  name: "cases",
  description: "The org's dataset: real calls kept as cases — the inbox, one case whole, approved into the nightly, dismissed, reopened, pulled into the repository as a golden, a call kept, one forgotten.",
  schema: {
    action: z
      .enum(["list", "show", "approve", "dismiss", "reopen", "pull", "keep", "forget"])
      .describe("list the agent's cases, the pending first; show one whole; approve it into the nightly; dismiss it; reopen it as pending; pull its golden into the agent's goldens folder and mark it kept in the repository; keep a finished call as a case; forget one"),
    agent: AGENT,
    name: z.string().min(1).optional().describe("the case's name within the agent; `keep`: the name the new case is played by"),
    status: z.enum(STATUSES).optional().describe("`list`: only the cases in this status; every status when left out"),
    call: z.string().min(1).optional().describe("`keep`: the finished call to keep as an approved case"),
    held_out: z.boolean().optional().describe("`keep`: played only when a run names it, never by the nightly"),
    judge_was_wrong: z.string().min(1).optional().describe("`dismiss`: the judge that broke and should have held, kept as a calibration label of the call"),
    note: z.string().optional().describe("`dismiss`: why, kept on that label; only beside judge_was_wrong"),
    prod: PROD,
  },
  manual:
    "`cases` is the dataset real calls make: a call a judge broke on is kept at hang-up as a pending case — its caller's lines, the state it opened in, and an expect that says what must not happen again. `list` answers the agent's cases and how many wait; `show` one whole. Reproduce one with `test` and `case`, fix the agent, then `approve` it (the nightly, `test` with `dataset`, plays it) or `dismiss` it — `judge_was_wrong` when the judge that broke should have held. `pull` writes its golden into `test/<agent>/goldens/` and marks it kept in the repository, so the nightly plays the file. `keep` keeps a finished call as an approved case. A case is named within the agent.",
  handler: async (args, session) => {
    const door = await session.door(args.prod);
    if (args.action === "keep") {
      if (args.call === undefined || args.name === undefined) throw new Refused("keep takes the finished call and the name the case is played by");
      return await keptAsCase(door, { call: args.call, name: args.name, ...(args.held_out === true ? { held_out: true } : {}) });
    }
    const home = await session.home(args.agent);
    if (args.action === "list") return await casesOf(door, home.name, args.status);
    const name = args.name;
    if (name === undefined) throw new Refused(`${args.action} takes the case's name: \`cases\` with action list names them`);
    if (args.action === "show") return await caseNamed(door, home.name, name);
    if (args.action === "approve") return await decided(door, home.name, name, { status: "approved" });
    if (args.action === "reopen") return await decided(door, home.name, name, { status: "pending" });
    if (args.action === "pull") return await pulled(door, home.name, name, home.goldens);
    if (args.action === "forget") {
      const gone = await forgotten(door, home.name, name);
      return { forgotten: gone.name, source_call: gone.source_call };
    }
    if (args.note !== undefined && args.judge_was_wrong === undefined) throw new Refused(A_NOTE_ALONE);
    return await decided(door, home.name, name, {
      status: "dismissed",
      ...(args.judge_was_wrong === undefined ? {} : { judge_was_wrong: args.judge_was_wrong }),
      ...(args.note === undefined ? {} : { note: args.note }),
    });
  },
});
