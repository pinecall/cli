// `pinecall runs diff`: changes between two runs.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { diffed, movedBetween } from "../../src/runs/suites.js";
import type { Cell, Door, EvalRun, Score } from "../../src/testing/gateway.js";

function score(metric: string, passed: boolean): Score {
  return { metric, score: passed ? 1 : 0, passed, reason: "the tool ran", criteria: "Every tool ran.", judge_calls: 0 };
}

function aRun(id: string, cells: Cell[]): EvalRun {
  return {
    id,
    agent: "clinica-norte",
    started_at: 0,
    finished_at: 1,
    status: "done",
    calls: [],
    matrix: { models: ["haiku"], goldens: [], metrics: [], judge_calls: 0, runs: cells, failures: [] },
    error: null,
  };
}

const HELD: Cell = { model: "haiku", golden: "reserva", scores: [score("tools", true)], summary: null };
const BROKEN: Cell = { model: "haiku", golden: "reserva", scores: [score("tools", false)], summary: null };

describe("what moved between two runs", () => {
  it("is the regression, named by the way it went", () => {
    const moved = movedBetween(aRun("a", [HELD]), aRun("b", [BROKEN]));

    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain("reserva  tools  held → broken");
  });

  it("is empty between two runs that answered the same, which is why a diff is worth reading", () => {
    expect(movedBetween(aRun("a", [HELD]), aRun("b", [HELD]))).toEqual([]);
  });

  it("says nothing about a golden the older run never had and that held, rather than calling it a change", () => {
    const fresh: Cell = { ...HELD, golden: "nueva" };

    expect(movedBetween(aRun("a", [HELD]), aRun("b", [HELD, fresh]))).toEqual([]);
  });

  // Failures in cells the older run lacks must still be printed.
  it("prints a broken measurement the older run never made, so no failure is silent", () => {
    const fresh: Cell = { ...BROKEN, golden: "nueva" };

    const moved = movedBetween(aRun("a", [HELD]), aRun("b", [HELD, fresh]));

    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain("nueva  tools  not measured → broken");
  });

  it("names what the newer run stopped measuring, so a golden nobody ran is not read as a fix", () => {
    const moved = movedBetween(aRun("a", [BROKEN]), aRun("b", []));

    expect(moved).toEqual(["  reserva  tools  broken → not measured"]);
  });
});

describe("--json on a diff", () => {
  it("answers the moved lines as data, and still exits 1 on a regression", async () => {
    const runs: Record<string, EvalRun> = { a: aRun("a", [HELD]), b: aRun("b", [BROKEN]) };
    const server = createServer((request, response) => {
      const id = (request.url ?? "").split("/").at(-1) ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(runs[id]));
    });
    await new Promise<void>((bound) => server.listen(0, "127.0.0.1", bound));
    const door = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "pc_a_key" } as Door;
    const written: string[] = [];
    const out = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;

    const code = await diffed(door, "a", "b", true, out);

    expect(code).toBe(1);
    expect(JSON.parse(written.join(""))).toEqual({
      before: "a",
      after: "b",
      moved: ["reserva  tools  held → broken  the tool ran"],
    });
    server.closeAllConnections();
    await new Promise<void>((closed) => server.close(() => closed()));
  });
});
