/** `pinecall sessions`: one row per call, and one call's score as a person reads it. */

import { describe, expect, it } from "vitest";

import { costLines, lineOf, money, onOneLine, run, scoreLines, seconds } from "../src/sessions.js";
import { pointingAt } from "./home.js";

// A stream that keeps what was written, so a test can read output as a string.
function collected(): { stream: NodeJS.WritableStream; text(): string } {
  const written: string[] = [];
  const stream = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => written.join("") };
}

const A_CALL = {
  call: "call_e824ce7a",
  live: false,
  agent: "clinica-norte",
  last_seq: 58,
  status: "ended",
  channel: "web",
  direction: "inbound",
  from: "web_25068b",
  to: "clinica-norte",
  caller: null,
  started_at: 1_000,
  ended_at: 1_134,
  end_reason: "caller_hung_up",
  outcome: "Reservó el martes a las nueve",
  cost: { usd: 0.0196, rows: [], unpriced: [] },
} as unknown as Parameters<typeof lineOf>[0];

describe("one call as a row", () => {
  it("says what it was, how long, why it ended, what it cost and what came of it", () => {
    const row = lineOf(A_CALL);

    expect(row).toContain("call_e824ce7a");
    expect(row).toContain("web inbound");
    expect(row).toContain("2m 14s");
    expect(row).toContain("caller_hung_up");
    expect(row).toContain("$0.0196");
    expect(row).toContain("Reservó el martes a las nueve");
  });

  it("marks a call that is still going, and says live where the reason would be", () => {
    const row = lineOf({ ...A_CALL, live: true, ended_at: null, end_reason: null });

    expect(row.startsWith("●")).toBe(true);
    expect(row).toContain("live");
  });

  // Outcomes are model-written and can be long.
  it("keeps a row one row however many lines the outcome had", () => {
    const row = lineOf({ ...A_CALL, outcome: "Buenos días.\n\n¿Cuál es su nombre?" });

    expect(row).not.toContain("\n");
    expect(row).toContain("Buenos días. ¿Cuál es su nombre?");
  });
});

describe("the score", () => {
  const held = { name: "consent", verdict: "held", criteria: "nothing irreversible ran unasked", reason: "" };
  const broke = { name: "grounded", verdict: "broken", criteria: "what it said is in the evidence", reason: "it named a Thursday nobody wrote down" };

  it("says every judge held, with what the judging cost", () => {
    const lines = scoreLines({ passed: true, judges: [held], judge_calls: 0, judge_cost_usd: 0 });

    expect(lines[0]).toContain("every judge held");
    expect(lines[0]).toContain("1 judges");
    expect(lines[0]).toContain("0 model calls");
  });

  it("prints the reasoning only for the judge that did not hold", () => {
    const lines = scoreLines({ passed: false, judges: [held, broke], judge_calls: 1 }).join("\n");

    expect(lines).toContain("a judge answered broken");
    expect(lines).toContain("it named a Thursday nobody wrote down");
    expect(lines).not.toContain("nothing irreversible ran unasked\n     ");
  });

  it("says why nothing judged a call when nothing did", () => {
    expect(scoreLines({ not_judged: "no judge key on this box" })[0]).toContain("no judge key on this box");
  });

  it("says a call carries no score rather than pretending it passed", () => {
    expect(scoreLines(undefined)[0]).toContain("not judged");
  });
});

describe("the small stuff", () => {
  it("says seconds the way a person says them", () => {
    expect(seconds(14)).toBe("14s");
    expect(seconds(134)).toBe("2m 14s");
    expect(seconds(60)).toBe("1m 00s");
  });

  it("says a call nobody priced with a dash and never a zero", () => {
    expect(money(null)).toBe("—");
    expect(money({ usd: 0.02 } as unknown as Parameters<typeof money>[0])).toBe("$0.0200");
  });

  it("breaks a call's cost into a line per priced row, the phone leg included, then what had no rate", () => {
    const lines = costLines({
      usd: 0.0414,
      rows: [
        { provider: "Cartesia", model: "sonic-3", unit: "characters", quantity: 623, unit_price_usd: 0.00005, usd: 0.03115 },
        { provider: "twilio", model: "twilio-inbound/+1", unit: "minutes", quantity: 2, unit_price_usd: 0.0034, usd: 0.0068 },
      ],
      unpriced: [{ provider: "Deepgram", model: "flux-general-multi" }],
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("623 characters");
    expect(lines[1]).toMatch(/twilio twilio-inbound\/\+1 +2 minutes +\$0\.0068$/);
    expect(lines[2]).toContain("Deepgram flux-general-multi");
    expect(lines[2]).toContain("no rate: not counted");
    expect(costLines(null)).toEqual([]);
  });

  it("cuts a long sentence where a terminal would have wrapped it", () => {
    expect(onOneLine("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
    expect(onOneLine(null)).toBe("");
  });
});

describe("the verb itself", () => {
  it("says what it needs when no agent can be found and none was named", async () => {
    const err = collected();
    const env = pointingAt("http://127.0.0.1:1", "pc_test_a_key");

    const code = await run([], { err: err.stream, out: collected().stream, env });

    expect(code).toBe(2);
    expect(err.text()).toContain("name the agent");
  });
});
