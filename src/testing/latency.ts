/** Per-golden latency: the median of each turn metric. */

import { TURN_METRICS } from "../view.js";
import type { Entry } from "./gateway.js";

/** Median turn metrics in seconds, as LiveKit measured them. */
export type Medians = Partial<Record<(typeof TURN_METRICS)[number], number>>;

/**
 * Median of each metric over a call's turns. Median, not mean, so one cold first turn does not skew
 * it. Metrics never measured are omitted, not zeroed.
 */
export function mediansOf(entries: Entry[]): Medians {
  const medians: Medians = {};
  for (const name of TURN_METRICS) {
    const measured = takenPerTurn(entries, name);
    if (measured.length > 0) medians[name] = median(measured);
  }
  return medians;
}

/** Format the medians on one line, in milliseconds. */
export function latencyLine(medians: Medians): string {
  const parts = TURN_METRICS.filter((name) => medians[name] !== undefined).map(
    (name) => `${name} ${Math.round(medians[name]! * 1000)}ms`,
  );
  return parts.join(" · ");
}

// Read from each `turn.agent` entry's metrics block (LiveKit field names).
function takenPerTurn(entries: Entry[], name: string): number[] {
  const taken: number[] = [];
  for (const entry of entries) {
    if (entry.type !== "turn.agent") continue;
    const metrics = entry.data["metrics"];
    const value = typeof metrics === "object" && metrics !== null
      ? (metrics as Record<string, unknown>)[name]
      : undefined;
    if (typeof value === "number") taken.push(value);
  }
  return taken;
}

function median(values: number[]): number {
  const sorted = [...values].sort((one, two) => one - two);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
