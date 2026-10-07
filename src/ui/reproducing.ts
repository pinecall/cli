/** Console door for reading the reproduction files a failed suite wrote locally. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPRODUCTIONS } from "../testing/reproduction.js";
import { anObject, aString } from "./asked.js";
import { Refusal } from "./refusal.js";

/** Goldens of one run that left a reproduction, and their folder. */
export interface Written {
  run: string;
  folder: string;
  goldens: string[];
}

/** Reproduction door as the console server uses it. */
export interface Reproducing {
  /** List the goldens of a run that left a file. A green run leaves none. */
  roster(asked: unknown): Promise<Written>;
  /** Read one reproduction: golden, requests, verdicts and log. */
  read(asked: unknown): Promise<unknown>;
}

const A_RUN = /^[A-Za-z0-9_-]{1,64}$/;
const A_GOLDEN = /^[^/\\]{1,120}$/;

const NOT_HERE = (run: string): string =>
  `no reproduction of ${run} under ${REPRODUCTIONS}: the suite writes them where it was run, ` +
  "and a run that was green wrote none";

/**
 * Reproduction door for one `pinecall start`. Files live at `.pinecall/evals/<run>/<golden>.json`
 * and hold the full model requests, which the log stores only as hashes.
 */
export function reproducingFrom(under: string = REPRODUCTIONS): Reproducing {
  return {
    async roster(asked: unknown): Promise<Written> {
      const run = theRun(asked);
      const folder = join(under, run);
      if (!existsSync(folder)) throw new Refusal(404, NOT_HERE(run));
      const goldens = readdirSync(folder)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .sort();
      return { run, folder, goldens };
    },

    async read(asked: unknown): Promise<unknown> {
      const given = anObject(asked, "a reproduction");
      const run = theRun(given);
      const golden = aString(given, "golden");
      // Path-traversal guard: run and golden are shape-checked before joining.
      if (!A_GOLDEN.test(golden)) throw new Refusal(422, "a golden is a name, not a path");
      const file = join(under, run, `${golden}.json`);
      if (!existsSync(file)) throw new Refusal(404, `no reproduction of ${golden} in ${join(under, run)}`);
      return JSON.parse(readFileSync(file, "utf8"));
    },
  };
}

function theRun(asked: unknown): string {
  const run = aString(anObject(asked, "a reproduction"), "run");
  if (!A_RUN.test(run)) throw new Refusal(422, "a run is an id, not a path");
  return run;
}
