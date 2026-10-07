// Per-golden latency medians from turn metrics.

import { describe, expect, it } from "vitest";

import type { Entry } from "../../src/testing/gateway.js";
import { latencyLine, mediansOf } from "../../src/testing/latency.js";

function aTurn(seq: number, metrics: Record<string, number>): Entry {
  return { seq, type: "turn.agent", data: { text: "…", metrics } };
}

describe("the latency of a call", () => {
  it("is the median of its agent turns, so one cold turn does not stand for the call", () => {
    const entries = [
      aTurn(2, { e2e_latency: 1.0 }),
      aTurn(4, { e2e_latency: 1.2 }),
      aTurn(6, { e2e_latency: 9.0 }),
    ];

    expect(mediansOf(entries).e2e_latency).toBeCloseTo(1.2);
  });

  it("averages the middle two when the call had an even number of turns", () => {
    const entries = [aTurn(2, { llm_node_ttft: 0.6 }), aTurn(4, { llm_node_ttft: 0.8 })];

    expect(mediansOf(entries).llm_node_ttft).toBeCloseTo(0.7);
  });

  it("leaves out a metric the session never measured rather than reporting a zero", () => {
    const medians = mediansOf([aTurn(2, { e2e_latency: 1.0 })]);

    expect(medians.tts_node_ttfb).toBeUndefined();
    expect(latencyLine(medians)).toBe("e2e_latency 1000ms");
  });

  it("reads nothing off a caller's turn or off an entry with no metrics at all", () => {
    const entries: Entry[] = [
      { seq: 1, type: "turn.user", data: { text: "hola", metrics: { e2e_latency: 5 } } },
      { seq: 3, type: "turn.agent", data: { text: "buenas" } },
    ];

    expect(mediansOf(entries)).toEqual({});
    expect(latencyLine({})).toBe("");
  });
});
