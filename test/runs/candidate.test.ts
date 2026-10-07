// `pinecall runs promote`: a judged call becomes a candidate; an unjudged one is refused.

import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type CallScore } from "@pinecall/agents/wire";

import { CONSENT_BANS_THE_TOOL, NOT_JUDGED, candidateOf, expectOf, promoted, theScoreIn } from "../../src/runs/candidate.js";
import type { Door, Entry } from "../../src/testing/gateway.js";
import type { Golden } from "../../src/testing/goldens.js";
import { onStderr, written } from "../said.js";

// The protocol package's golden call log: book_slot at seq 79, confirm.granted at 93 (a consent break).
const GOLDEN_LOG = fileURLToPath(new URL("./call-log.json", import.meta.url));
const THE_CALL = "CA_8f4a2c";
const GOLDEN: Entry[] = JSON.parse(readFileSync(GOLDEN_LOG, "utf8")) as Entry[];

const DOOR: Door = { url: "http://gateway", apiKey: "dev", world: "sandbox" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what a call's own verdicts say the golden must expect", () => {
  it("bans the tool a broken consent names, read at the seq the verdict cites and not from words", () => {
    const score = theScoreIn(GOLDEN);

    expect(score?.passed).toBe(false);
    // seqs are [79, 93]: the book_slot call and the confirm.granted that came after it.
    expect(expectOf(score!, GOLDEN)).toEqual({ not_tools: ["book_slot"] });
  });

  it("asks for grounding when grounded is what broke, which is a real expect field", () => {
    expect(expectOf(scoreOf({ name: "grounded", verdict: "broken", seqs: [] }), GOLDEN)).toEqual({ grounded: true });
  });

  it("expects nothing of a call where nothing broke, because a verdict is the only source", () => {
    expect(expectOf(scoreOf({ name: "consent", verdict: "held", seqs: [79] }), GOLDEN)).toEqual({});
  });

  it("writes no ban when the seqs a broken consent cites hold no tool.call this log carries", () => {
    expect(expectOf(scoreOf({ name: "consent", verdict: "broken", seqs: [93] }), GOLDEN)).toEqual({});
  });
});

describe("the candidate a real call reduces to", () => {
  it("carries the call it came from, so nobody mistakes it for a golden a person wrote", () => {
    const candidate = candidateOf(THE_CALL, GOLDEN, 0, theScoreIn(GOLDEN)!);

    expect(candidate.promoted_from).toBe(THE_CALL);
    expect(candidate.name).toBe(THE_CALL);
  });

  it("starts from the state as it stood at the cut, and from the caller's words after it", () => {
    const entries: Entry[] = [
      { seq: 2, type: "state.changed", data: { state: { stage: "identify" } } },
      { seq: 3, type: "turn.user", data: { text: "hola" } },
      { seq: 8, type: "state.changed", data: { state: { stage: "choose" } } },
      { seq: 9, type: "turn.user", data: { text: "¿el martes?" } },
    ];

    const candidate = candidateOf("CA_1", entries, 8, scoreOf({ name: "consent", verdict: "held", seqs: [] }));

    expect(candidate.state).toEqual({ stage: "choose" });
    expect(candidate.input).toEqual(["¿el martes?"]);
  });

  it("takes the whole call when nobody named a turn to start from", () => {
    const candidate = candidateOf(THE_CALL, GOLDEN, 0, theScoreIn(GOLDEN)!);

    expect(candidate.state).toBeUndefined();
    expect(candidate.input.length).toBeGreaterThan(0);
  });
});

describe("the verb, against a gateway that hands back the golden booking call", () => {
  it("writes one candidate with promoted_from, the caller's words, and the tool it must not call", async () => {
    const out = mkdtempSync(join(tmpdir(), "candidate-"));
    stub(GOLDEN);
    const said = written();

    const code = await promoted(DOOR, THE_CALL, { out, fromSeq: 0 }, said.stream);

    expect(code).toBe(0);
    expect(readdirSync(out)).toEqual([`${THE_CALL}.json`]);
    const candidate = JSON.parse(readFileSync(join(out, `${THE_CALL}.json`), "utf8")) as Golden;
    expect(candidate.expect).toEqual({ not_tools: ["book_slot"] });
    expect(candidate.input[0]).toBe("Hola, quería pedir cita con la doctora Vidal.");
    expect(candidate.promoted_from).toBe(THE_CALL);
    expect(said.text()).toContain("book_slot ran at seq 79, before its confirm.granted at seq 93");
  });

  it("says on stdout what the ban is, so nobody keeps a not_tools they never read", async () => {
    stub(GOLDEN);
    const said = written();

    await promoted(DOOR, THE_CALL, { out: mkdtempSync(join(tmpdir(), "candidate-")), fromSeq: 0 }, said.stream);

    expect(said.text()).toContain(CONSENT_BANS_THE_TOOL);
  });

  it("takes the name it was given, for the file and for the golden inside it", async () => {
    const out = mkdtempSync(join(tmpdir(), "candidate-"));
    stub(GOLDEN);

    await promoted(DOOR, THE_CALL, { out, fromSeq: 0, name: "no-reserva-antes-del-si" }, written().stream);

    expect(readdirSync(out)).toEqual(["no-reserva-antes-del-si.json"]);
  });

  it("refuses a call nobody judged and prints the reason the entry gives", async () => {
    const nobody: Entry = {
      seq: 9,
      type: "call.score",
      data: { judges: [], judge_calls: 0, not_judged: "pinecall-evals is not installed on this box" },
    };
    stub([{ seq: 1, type: "turn.user", data: { text: "hola" } }, nobody]);
    const complained = onStderr();

    const code = await promoted(DOOR, THE_CALL, { out: mkdtempSync(join(tmpdir(), "candidate-")), fromSeq: 0 }, written().stream);

    complained.restore();
    expect(code).toBe(1);
    expect(complained.text()).toContain(NOT_JUDGED);
    expect(complained.text()).toContain("pinecall-evals is not installed on this box");
  });

  it("refuses a log with no call.score at all, and says that is what is missing", async () => {
    stub([{ seq: 1, type: "turn.user", data: { text: "hola" } }]);
    const complained = onStderr();

    const code = await promoted(DOOR, THE_CALL, { out: mkdtempSync(join(tmpdir(), "candidate-")), fromSeq: 0 }, written().stream);

    complained.restore();
    expect(code).toBe(1);
    expect(complained.text()).toContain("no call.score at all");
  });
});

// A single-judge `call.score` for cases the fixture lacks.
function scoreOf(said: { name: string; verdict: string; seqs: number[] }): CallScore {
  return {
    passed: said.verdict !== "broken",
    judges: [
      {
        name: said.name,
        verdict: said.verdict as "held" | "broken" | "deferred" | "skipped",
        criteria: "the question",
        reason: "the sentence",
        evidence: { seqs: said.seqs },
      },
    ],
    judge_calls: 0,
  };
}

// Stub the events endpoint to page the given log.
function stub(entries: Entry[]): void {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ entries }), { status: 200 }));
}
