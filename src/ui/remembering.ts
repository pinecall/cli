/** Console door for memory goldens: recall ranking and hang-up extraction. */

import { existsSync } from "node:fs";

import { type ExtractionGolden, type ExtractionRun, type MemoryScore } from "@pinecall/agents/wire";


import { theQuestionsIn } from "../docs.js";
import { AN_EMPTY_GOLDEN, NO_GOLDEN, recalledOn } from "../memory.js";
import { CASES, NO_CASES } from "../remember.js";
import { extracted } from "../testing/gateway.js";
import type { Door } from "../testing/gateway.js";
import { casesIn } from "../testing/goldens.js";
import { MEMORY_GOLDEN, type Home } from "../home.js";
import { anObject, aString, maybeNumber } from "./asked.js";
import { Refusal } from "./refusal.js";

/** This directory's recall golden and extraction cases. */
export interface Roster {
  agent: string | null;
  golden: string | null;
  questions: number;
  cases: string[];
}

/** Memory door as the console server uses it. */
export interface Remembering {
  roster(): Promise<Roster>;
  /** Score the recall golden against the gateway's ranking. */
  recall(asked: unknown): Promise<MemoryScore>;
  /** Run each extraction case through one hang-up model call, judged by code. */
  extract(asked: unknown): Promise<ExtractionRun>;
}

const NOT_THIS_DIRECTORY = (asked: string, here: string | null): string =>
  here === null
    ? `no agent class in this directory: run \`pinecall start\` where ${asked}'s agent.tsx is`
    : `this process runs in ${here}'s directory: to run ${asked}'s memory goldens, run \`pinecall start\` there`;

/** Injectable parts of a run, replaceable in tests. */
export interface Pieces {
  /** Read this directory's extraction cases. */
  cases: () => Promise<ExtractionGolden[]>;
  /** Run the cases against the agent this `pinecall start` holds. */
  extract: (door: Door, cases: ExtractionGolden[]) => Promise<ExtractionRun>;
  /** Path of the recall golden and the slug of this directory's class. */
  golden: () => Promise<{ agent: string | null; golden: string | null }>;
}

/**
 * Memory door for one `pinecall start`. Both goldens are local files (`memory/golden.json`,
 * `test/memory`); the gateway runs the models, so no key leaves this process.
 */
export function rememberingFrom(
  door: Door,
  agent: string | null,
  pieces: Pieces,
): Remembering {
  return {
    async roster(): Promise<Roster> {
      const { golden } = await pieces.golden();
      const questions = golden !== null && existsSync(golden) ? theQuestionsIn(golden) : null;
      return {
        agent,
        golden: golden !== null && existsSync(golden) ? golden : null,
        questions: questions?.length ?? 0,
        cases: (await pieces.cases()).map((one) => one.name),
      };
    },

    async recall(asked: unknown): Promise<MemoryScore> {
      const given = anObject(asked, "a golden");
      mine(aString(given, "agent"), agent);
      const { golden } = await pieces.golden();
      if (golden === null || !existsSync(golden)) throw new Refusal(404, NO_GOLDEN(golden ?? MEMORY_GOLDEN));
      const questions = theQuestionsIn(golden);
      if (questions === null) throw new Refusal(422, AN_EMPTY_GOLDEN(golden));
      return await recalledOn(door, questions, maybeNumber(given, "k", 1, 100));
    },

    async extract(asked: unknown): Promise<ExtractionRun> {
      mine(aString(anObject(asked, "a run"), "agent"), agent);
      const cases = await pieces.cases();
      if (cases.length === 0) throw new Refusal(404, NO_CASES);
      return await pieces.extract(door, cases);
    },
  };
}

function mine(asked: string, here: string | null): void {
  if (asked !== here) throw new Refusal(409, NOT_THIS_DIRECTORY(asked, here));
}

/** Memory parts for one agent of a project; the gateway reads its categories off the `pinecall start` holding it. */
export function rememberingPiecesFor(home: Home): Pieces {
  return {
    cases: async () => (existsSync(home.memoryCases) ? await casesIn<ExtractionGolden>([home.memoryCases], CASES) : []),
    extract: async (door, cases) => await extracted(door, home.name, cases),
    golden: async () => ({ agent: home.name, golden: home.memoryGolden }),
  };
}
