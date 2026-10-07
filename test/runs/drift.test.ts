// `pinecall runs drift`: 4/10 consent breaks vs a 0/10 baseline fails and names the last three.

import { afterEach, describe, expect, it, vi } from "vitest";

import { type CallScore } from "@pinecall/agents/wire";
import { type SessionLine } from "@pinecall/agents/wire";

import { driftOf, finishedBetween, linesOf, secondsOf, type Asked, type Judged } from "../../src/runs/drift.js";
import { pointingAt } from "../home.js";
import { run } from "../../src/runs/index.js";
import { onStderr, written } from "../said.js";

const DAY = 86400;
const NOW = 1_786_537_600;

const ASKED: Asked = { agent: "clinica-norte", window: 7 * DAY, baseline: 30 * DAY, threshold: 10, limit: 200, now: NOW };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a window is a number and a unit", () => {
  it("reads the three a person types", () => {
    expect([secondsOf("90m"), secondsOf("24h"), secondsOf("7d")]).toEqual([5400, 86400, 604800]);
  });

  it("is not a bare number, and not a word", () => {
    expect([secondsOf("7"), secondsOf("last week")]).toEqual([null, null]);
  });
});

describe("which calls a window holds", () => {
  it("takes the ones that ended inside it, newest first, and never a live one", () => {
    const sessions = [line("CA_live", NOW - DAY, { live: true }), line("CA_old", NOW - 20 * DAY), line("CA_new", NOW - DAY)];

    expect(finishedBetween(sessions, NOW - 7 * DAY, NOW).map((one) => one.call)).toEqual(["CA_new"]);
  });
});

describe("the delta between two windows", () => {
  const now = [...broken(4), ...held(6), notJudged()];
  const before = held(10);

  it("is a count over the verdicts the log already carries", () => {
    const drift = driftOf(now, before);

    expect(drift.judges).toEqual([
      { judge: "consent", before: { held: 10, settled: 10, percent: 100 }, now: { held: 6, settled: 10, percent: 60 }, delta: -40 },
    ]);
    expect(drift.worst).toBe(-40);
  });

  it("counts a call nobody judged apart, and in neither window's arithmetic", () => {
    expect(driftOf(now, before).notJudged).toEqual({ now: 1, before: 0 });
  });

  it("names the three most recent broken calls and the seqs each verdict cites", () => {
    const drift = driftOf(now, before);

    expect(drift.broke.map((one) => one.call)).toEqual(["CA_broken_0", "CA_broken_1", "CA_broken_2"]);
    expect(drift.broke.flatMap((one) => one.seqs)).toEqual([100, 101, 102]);
  });

  it("claims no delta for a judge one of the windows never settled: silence is not a drop", () => {
    const drift = driftOf(now, []);

    expect(drift.judges[0]?.delta).toBeNull();
    expect(drift.worst).toBeNull();
  });

  it("puts the baseline first and the window after it, the way runs diff reads", () => {
    const lines = linesOf(ASKED, driftOf(now, before));

    expect(lines[0]).toBe("clinica-norte  drift  the last 7d against the 30d before it");
    expect(lines[1]).toBe("  consent  100.0% →  60.0%   -40.0 points  (6/10 held, was 10/10)");
    expect(lines[2]).toBe("  1 not judged in the window, 0 in the baseline");
  });
});

describe("the verb, against a gateway holding the forced regression", () => {
  it("exits non-zero and prints the three seqs", async () => {
    aProfile();
    aGateway();
    const said = written();

    const code = await run(["drift", "--agent", "clinica-norte"], said.stream);

    expect(code).toBe(1);
    expect(said.text()).toContain("-40.0 points");
    for (const seq of ["seq 100", "seq 101", "seq 102"]) expect(said.text()).toContain(seq);
  });

  it("holds the night when nothing dropped further than the threshold allows", async () => {
    aProfile();
    aGateway({ broken: 0 });

    expect(await run(["drift", "--agent", "clinica-norte"], written().stream)).toBe(0);
  });

  it("asks for the agent it watches rather than guessing one", async () => {
    aProfile();
    const complained = onStderr();

    const code = await run(["drift"], written().stream);

    complained.restore();
    expect(code).toBe(2);
    expect(complained.text()).toContain("--agent");
  });

  it("refuses a baseline that is not longer than the window, which would dilute the drop", async () => {
    aProfile();
    const complained = onStderr();

    const code = await run(["drift", "--agent", "x", "--window", "30d", "--baseline", "7d"], written().stream);

    complained.restore();
    expect(code).toBe(2);
    expect(complained.text()).toContain("longer than the window");
  });
});

// ── the fixture: 4 of 10 broken this week, 0 of 10 the fortnight before ─────────

function judged(call: string, at: number, score: CallScore): Judged {
  return { call, at, score };
}

function scored(verdict: "held" | "broken", seq: number): CallScore {
  return {
    passed: verdict === "held",
    judges: [
      {
        name: "consent",
        verdict,
        criteria: "Every irreversible tool call ran after a confirm.granted for the same tool call.",
        reason: verdict === "broken" ? `book_slot ran at seq ${seq} with no confirm.granted before it` : "0 irreversible tool call(s) ran",
        evidence: { seqs: [seq] },
      },
    ],
    judge_calls: 0,
  };
}

function broken(many: number): Judged[] {
  return Array.from({ length: many }, (_, index) =>
    judged(`CA_broken_${index}`, NOW - (index + 1) * 3600, scored("broken", 100 + index)),
  );
}

function held(many: number): Judged[] {
  return Array.from({ length: many }, (_, index) =>
    judged(`CA_held_${index}`, NOW - (index + 10) * 3600, scored("held", 200 + index)),
  );
}

function notJudged(): Judged {
  return judged("CA_silent", NOW - 3600, { judges: [], judge_calls: 0, not_judged: "the judges are not installed on this box" });
}

function line(call: string, endedAt: number, said: { live?: boolean } = {}): SessionLine {
  return {
    call,
    agent: "clinica-norte",
    live: said.live ?? false,
    last_seq: 125,
    status: "ended",
    channel: null,
    direction: null,
    from: null,
    to: null,
    caller: null,
    started_at: endedAt - 60,
    ended_at: endedAt,
    end_reason: null,
    outcome: null,
    cost: null,
  };
}

// The verb needs a configured profile; which gateway does not matter since `fetch` is stubbed.
function aProfile(): void {
  const env = pointingAt("http://127.0.0.1:1", "pc_test_nobody_will_ever_deploy_this");
  vi.stubEnv("PINECALL_KEY", env["PINECALL_KEY"]!);
  vi.stubEnv("PINECALL_URL", env["PINECALL_URL"]!);
}

function aGateway(said: { broken?: number } = {}): void {
  const howMany = said.broken ?? 4;
  const now = Date.now() / 1000;
  const scores: Record<string, CallScore> = {};
  const calls: SessionLine[] = [];
  for (let index = 0; index < 10; index += 1) {
    const call = `CA_w${index}`;
    calls.push(line(call, now - (index + 1) * 12 * 3600));
    scores[call] = scored(index < howMany ? "broken" : "held", 100 + index);
  }
  for (let index = 0; index < 10; index += 1) {
    const call = `CA_b${index}`;
    calls.push(line(call, now - (index + 10) * DAY));
    scores[call] = scored("held", 300 + index);
  }
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/sessions")) return new Response(JSON.stringify({ calls }), { status: 200 });
    const call = /\/v1\/calls\/([^/]+)\/events/.exec(url)?.[1] ?? "";
    const score = scores[call];
    const entries = score === undefined ? [] : [{ seq: 125, type: "call.score", data: score }];
    return new Response(JSON.stringify({ entries }), { status: 200 });
  });
}
