/** Console door for `runs drift`: each judge's pass rate over two time windows. */

import { A_WINDOW_OF_CALLS, THRESHOLD, theDrift, type Drift } from "../runs/drift.js";
import type { Door } from "../testing/gateway.js";
import { anObject, aString, maybeNumber } from "./asked.js";

/** Drift result with the windows (in seconds) it was computed over. */
export interface Drifted {
  agent: string;
  window: number;
  baseline: number;
  threshold: number;
  drift: Drift;
}

/** Drift door as the console server uses it. */
export interface Drifting {
  read(asked: unknown): Promise<Drifted>;
}

/** Default windows, as in `pinecall runs drift`. */
const A_WEEK = 7 * 24 * 60 * 60;
const A_MONTH = 30 * 24 * 60 * 60;

/**
 * Drift door for one `pinecall start`. Runs `theDrift` here to keep hundreds of round trips out of
 * the browser; rates are counted from existing verdicts, nothing is re-judged.
 */
export function driftingFrom(door: Door, now: () => number = () => Date.now() / 1000): Drifting {
  return {
    async read(asked: unknown): Promise<Drifted> {
      const given = anObject(asked, "a drift");
      const agent = aString(given, "agent");
      const window = maybeNumber(given, "window", 60, A_MONTH * 12) ?? A_WEEK;
      const baseline = maybeNumber(given, "baseline", 60, A_MONTH * 12) ?? A_MONTH;
      const threshold = maybeNumber(given, "threshold", 0, 100) ?? THRESHOLD;
      const drift = await theDrift(door, {
        agent,
        window,
        baseline,
        threshold,
        limit: A_WINDOW_OF_CALLS,
        now: now(),
      });
      return { agent, window, baseline, threshold, drift };
    },
  };
}
