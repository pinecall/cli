// Run report: failure reasons, judge counts, and multi-model columns.

import { describe, expect, it } from "vitest";

import type { Cell, EvalRun, Score } from "../../src/testing/gateway.js";
import { reportOf } from "../../src/testing/matrix.js";
import { reasonOf } from "../../src/testing/score.js";

// A broken hard policy reports its seqs only in the reason text.
const BROKEN_CONSENT = "book ran at seq 79, before its confirm.granted at seq 93";

const CRITERIA = "Every irreversible tool call ran after a confirm.granted.";

function score(metric: string, passed: boolean, reason = BROKEN_CONSENT, judge_calls = 0): Score {
  return { metric, score: passed ? 1 : 0, passed, reason, criteria: CRITERIA, judge_calls };
}

function cell(model: string, golden: string, scores: Score[], usd = 0.002): Cell {
  return { model, golden, scores, summary: { duration_s: 2, turns: 4, cost: { usd } } };
}

function aRun(cells: Cell[]): EvalRun {
  return {
    id: "run_1",
    agent: "clinica-norte",
    started_at: 1000,
    finished_at: 1041,
    status: "done",
    calls: cells.map((one) => ({ golden: one.golden, model: one.model, call: `CA_${one.golden}` })),
    matrix: {
      models: [...new Set(cells.map((one) => one.model))],
      goldens: [...new Set(cells.map((one) => one.golden))],
      metrics: ["consent"],
      judge_calls: cells.reduce((total, one) => total + one.scores.reduce((n, s) => n + s.judge_calls, 0), 0),
      runs: cells,
      failures: cells.flatMap((one) =>
        one.scores.filter((s) => !s.passed).map((s) => ({ model: one.model, golden: one.golden, metric: s.metric })),
      ),
    },
    error: null,
  };
}

describe("what a person reads back", () => {
  it("names the agent, the goldens and the model on the first line", () => {
    const run = aRun([cell("haiku", "identifica", [score("consent", true)])]);

    expect(reportOf(run, {}, "haiku")[0]).toBe("clinica-norte · 1 golden · haiku");
  });

  it("gives a golden that held one line, with the medians of its own call beside it", () => {
    const run = aRun([cell("haiku", "identifica", [score("consent", true)])]);

    const lines = reportOf(run, { CA_identifica: { e2e_latency: 1.204 } }, "haiku");

    expect(lines[1]).toBe("  ✓ identifica  e2e_latency 1204ms");
  });

  it("prints the evidence under a failure, and the call to open at the seqs it names", () => {
    const run = aRun([cell("haiku", "no-reserva", [score("consent", false)])]);

    const lines = reportOf(run, {}, "haiku");

    expect(lines[1]).toBe("  ✗ no-reserva");
    expect(lines[2]).toContain("book ran at seq 79, before its confirm.granted at seq 93");
    expect(lines[3]).toContain("CA_no-reserva");
  });

  it("closes with how many held, what the judge was asked, the cost and the wait", () => {
    const run = aRun([
      cell("haiku", "identifica", [score("consent", true)]),
      cell("haiku", "no-reserva", [score("consent", false)]),
    ]);

    expect(reportOf(run, {}, "haiku").at(-1)).toBe("  1/2 · 0 judge calls · $0.0040 · 41s");
  });

  it("names the golden two models do not agree about, and nothing they agree on", () => {
    const run = aRun([
      cell("haiku", "identifica", [score("consent", true)]),
      cell("gpt", "identifica", [score("consent", false)]),
    ]);

    const lines = reportOf(run, {}, "haiku");

    expect(lines).toContain("  divergences");
    expect(lines.some((line) => line.includes("identifica  consent  ✓ haiku   ✗ gpt"))).toBe(true);
  });

  it("says what stopped a run under the cells it did score, so a fragment never reads as a score", () => {
    const left: EvalRun = {
      ...aRun([cell("haiku", "identifica", [score("consent", true)])]),
      status: "failed",
      error: "the app detached after 1 of 3 goldens (clinica-norte): the socket holding the agent closed",
    };

    const lines = reportOf(left, {}, "haiku");

    expect(lines.at(-2)).toBe("  1/1 · 0 judge calls · $0.0020 · 41s");
    expect(lines.at(-1)).toBe(`  ${left.error}`);
  });

  it("says what stopped a run that never produced a matrix, instead of an empty table", () => {
    const broke: EvalRun = { ...aRun([]), status: "failed", matrix: null, error: "nobody is serving it" };

    expect(reportOf(broke, {}, "haiku")).toEqual(["clinica-norte  failed: nobody is serving it"]);
  });
});

describe("what a run cost", () => {
  it("says how many questions reached a model, which the matrix counted and nobody priced", () => {
    const run = aRun([
      cell("haiku", "one", [score("consent", true), score("tone", true, "warm enough", 1)], 0),
    ]);

    expect(reportOf(run, {}, "haiku").at(-1)).toBe("  1/1 · 1 judge call · $0.0000 · 41s");
  });

  it("adds up the calls' own euros, which are not the judge's dollars", () => {
    const run = aRun([cell("haiku", "one", [score("consent", true)], 0.0031)]);

    expect(reportOf(run, {}, "haiku").at(-1)).toContain("$0.0031");
  });
});

describe("the sentence a judge wrote", () => {
  it("is the judgment's own reasoning, seqs and all", () => {
    expect(reasonOf(score("consent", false))).toBe(BROKEN_CONSENT);
  });

  it("says so plainly when a judgment came back with no reasoning at all", () => {
    const silent: Score = { metric: "tone", score: 0, passed: false, reason: "", criteria: CRITERIA, judge_calls: 1 };

    expect(reasonOf(silent)).toBe("no reason was written down");
  });
});
