// Rendering call.score: passed, failed, and unjudged (absent `passed`).

import { type Judgment } from "@pinecall/agents/wire";
import { type CallScore } from "@pinecall/agents/wire";
import { describe, expect, it } from "vitest";

import { linesOfScore } from "../../src/testing/score.js";

function judgment(name: string, verdict: Judgment["verdict"], reason: string, seqs: number[] = []): Judgment {
  return { name, verdict, criteria: `Every ${name} rule held.`, reason, evidence: { seqs } };
}

function score(said: Partial<CallScore>): CallScore {
  return { judges: [], judge_calls: 0, ...said } as CallScore;
}

describe("the headline", () => {
  it("says every judge held when one answered and none answered broken", () => {
    const lines = linesOfScore(score({ passed: true, judges: [judgment("consent", "held", "")] }));

    expect(lines[0]).toBe("✓ every judge held");
  });

  it("says a judge answered broken when one did", () => {
    const lines = linesOfScore(score({ passed: false, judges: [judgment("consent", "broken", "x")] }));

    expect(lines[0]).toBe("✗ a judge answered broken");
  });

  // Absent `passed` is neither pass nor fail; print the entry's reason instead.
  it("says nobody judged the call, with the entry's own reason, when passed is absent", () => {
    const lines = linesOfScore(score({ not_judged: "the judges are not installed on this box" }));

    expect(lines[0]).toBe("· nobody judged this call: the judges are not installed on this box");
    expect(lines[0]).not.toContain("✓");
    expect(lines[0]).not.toContain("✗");
  });
});

describe("the judges", () => {
  it("prints one line per judge, with the seqs its own sentence named", () => {
    const broke = judgment("consent", "broken", "book ran at seq 79, before its grant at seq 93", [79, 93]);

    const lines = linesOfScore(score({ passed: false, judges: [broke] }));

    expect(lines[1]).toContain("✗ consent");
    expect(lines[1]).toContain("book ran at seq 79");
    expect(lines[1]).toContain("[seq 79, 93]");
  });

  it("marks a judge nobody put the question to as skipped and not as a failure", () => {
    const unasked = judgment("grounded", "skipped", "the ceiling was $0: nothing was asked");

    const lines = linesOfScore(score({ passed: true, judges: [unasked] }));

    expect(lines[1]).toContain("· grounded");
  });
});

describe("what the asking cost", () => {
  it("counts the questions that reached a model and prices them when the entry has a price", () => {
    const lines = linesOfScore(score({ passed: true, judges: [], judge_calls: 2, judge_cost_usd: 0.0013 }));

    expect(lines.at(-1)).toBe("  2 judge calls · $0.0013");
  });

  // Unknown cost is omitted, not shown as zero.
  it("says nothing at all about a bill it was not given", () => {
    const lines = linesOfScore(score({ passed: true, judges: [], judge_calls: 0 }));

    expect(lines.at(-1)).toBe("  0 judge calls");
  });
});
