// Suite progress output: header, per-golden rows, a bar, and no redrawing off a TTY.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Cell, Door, EvalRun, Score } from "../../src/testing/gateway.js";
import { followed, header, type Watched } from "../../src/testing/progress.js";

const DOOR: Door = { url: "http://gateway.test", apiKey: "dev", world: "sandbox" };

const WATCHED: Watched = { agent: "clinica-norte", goldens: 2, models: ["haiku"], declaredAs: "haiku" };

const CLIMB = /\x1b\[\d+A/;

function score(metric: string, passed: boolean, reason = "every tool ran"): Score {
  return { metric, score: passed ? 1 : 0, passed, reason, criteria: "Every tool ran.", judge_calls: 0 };
}

function cell(golden: string, scores: Score[]): Cell {
  return { model: "declared", golden, scores, summary: { duration_s: 2, turns: 4, cost: { usd: 0.001 } } };
}

// A run row as the runner updates it.
function row(status: EvalRun["status"], calls: string[], cells: Cell[]): EvalRun {
  return {
    id: "run_4c67ab12ef34",
    agent: "clinica-norte",
    started_at: 1000,
    finished_at: status === "running" ? null : 1030,
    status,
    calls: calls.map((golden) => ({ golden, model: "declared", call: `call_${golden}0000000000` })),
    matrix:
      cells.length === 0
        ? null
        : {
            models: ["declared"],
            goldens: cells.map((one) => one.golden),
            metrics: ["tools"],
            judge_calls: 0,
            runs: cells,
            failures: cells.flatMap((one) =>
              one.scores.filter((s) => !s.passed).map((s) => ({ model: "declared", golden: one.golden, metric: s.metric })),
            ),
          },
    error: null,
  };
}

const HELD = cell("identifica-al-paciente", [score("tools", true)]);
const BROKEN = cell("no-reserva-antes-del-si", [
  score("not_tools", false, "the golden forbids book, and this call ran book at seq 12"),
]);

const ROWS = [
  row("running", ["identifica-al-paciente"], []),
  row("running", ["identifica-al-paciente"], [HELD]),
  row("running", ["identifica-al-paciente", "no-reserva-antes-del-si"], [HELD]),
  row("running", ["identifica-al-paciente", "no-reserva-antes-del-si"], [HELD, BROKEN]),
];
const DONE = row("done", ["identifica-al-paciente", "no-reserva-antes-del-si"], [HELD, BROKEN]);

// Fake gateway: serves rows in order; the POST resolves after the last row, or after 750 ms.
const A_TICK_AND_A_HALF_MS = 750;

function aGateway(onServed: (rowsServed: number) => void = () => {}): { pending: Promise<EvalRun> } {
  let served = 0;
  let finish: (run: EvalRun) => void = () => {};
  const pending = new Promise<EvalRun>((resolve) => (finish = resolve));
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/v1/evals/runs?")) {
      setTimeout(() => served === 0 && finish(DONE), A_TICK_AND_A_HALF_MS);
      return new Response(JSON.stringify({ runs: [ROWS[0]] }));
    }
    const current = ROWS[Math.min(served, ROWS.length - 1)]!;
    served += 1;
    if (served >= ROWS.length) setTimeout(() => finish(DONE), 0);
    onServed(served);
    return new Response(JSON.stringify(current));
  });
  return { pending };
}

function aStream(terminal: boolean): { stream: NodeJS.WritableStream; writes: string[] } {
  const writes: string[] = [];
  const stream = {
    write: (chunk: string) => writes.push(chunk),
    isTTY: terminal,
    columns: 120,
  } as unknown as NodeJS.WritableStream;
  return { stream, writes };
}

function timesIn(chunk: string, name: string): number {
  return chunk.split(name).length - 1;
}

afterEach(() => vi.unstubAllGlobals());

describe("what the terminal shows while the run is going", () => {
  it("prints the header the moment the run has an id, and the goldens as they settle", async () => {
    const { pending } = aGateway();
    const { stream, writes } = aStream(true);

    const run = await followed(DOOR, WATCHED, pending, stream, false);

    expect(run.status).toBe("done");
    expect(writes[0]).toBe("clinica-norte · 2 goldens · haiku · run_4c67ab12ef34\n");
    const drawn = writes.join("");
    expect(drawn).toContain("  ○ identifica-al-paciente  call_identif…  reading…");
    expect(drawn).toContain("  ✓ identifica-al-paciente\n");
    expect(drawn).toContain("  ○ no-reserva-antes-del-si  call_no-rese…  reading…");
    expect(drawn).toContain("  ✗ no-reserva-antes-del-si\n");
    expect(drawn).toContain("not_tools  broken   the golden forbids book, and this call ran book at seq 12");
    expect(drawn).toContain("] 0/2 · ");
    expect(drawn).toContain("] 2/2 · ");
  });

  it("redraws the block in place, and takes it away when the run is over", async () => {
    const { pending } = aGateway();
    const { stream, writes } = aStream(true);

    await followed(DOOR, WATCHED, pending, stream, false);

    const redraws = writes.slice(1);
    expect(redraws[0]).not.toMatch(CLIMB);
    for (const redraw of redraws.slice(1)) expect(redraw).toMatch(CLIMB);
    // The last write clears the bar so the final matrix prints in its place.
    expect(redraws.at(-1)).toMatch(/^\x1b\[\d+A\x1b\[0J$/);
  });

  it("gets out of the way of a write from anywhere else, and draws the whole block again under it", async () => {
    const foreign = "NotOnTheTable: el jueves a las diez no está entre las horas libres\n";
    let stream: NodeJS.WritableStream;
    // A foreign write mid-run, as a console.log inside a tool would produce.
    const { pending } = aGateway((rowsServed) => rowsServed === 2 && stream.write(foreign));
    const drawn = aStream(true);
    stream = drawn.stream;

    await followed(DOOR, WATCHED, pending, stream, false, []);

    const writes = drawn.writes;
    const at = writes.indexOf(foreign);
    expect(at).toBeGreaterThan(1);
    // The block is cleared before the line and redrawn below it.
    expect(writes[at - 1]).toMatch(/^\x1b\[\d+A\x1b\[0J$/);
    expect(writes[at + 1]).not.toMatch(CLIMB);
    const last = writes.filter((chunk) => chunk.includes("identifica-al-paciente")).at(-1) ?? "";
    expect(timesIn(last, "✓ identifica-al-paciente")).toBe(1);
    expect(timesIn(last, "✗ no-reserva-antes-del-si")).toBe(1);
    expect(last).toContain("] 2/2 · ");
  });

  it("writes the header and nothing else when the stream is not a terminal", async () => {
    const { pending } = aGateway();
    const { stream, writes } = aStream(false);

    const run = await followed(DOOR, WATCHED, pending, stream, false);

    expect(run.status).toBe("done");
    expect(writes).toEqual(["clinica-norte · 2 goldens · haiku · run_4c67ab12ef34\n"]);
  });

  it("writes nothing at all under --json, terminal or not", async () => {
    const { pending } = aGateway();
    const { stream, writes } = aStream(true);

    const run = await followed(DOOR, WATCHED, pending, stream, true);

    expect(run.status).toBe("done");
    expect(writes).toEqual([]);
  });

  it("counts one golden without the plural, and names every model asked for", () => {
    const compared = { ...WATCHED, goldens: 1, models: ["anthropic/claude-haiku-5-5", "openai/gpt-5-mini"] };

    expect(header(compared, "run_1")).toBe(
      "clinica-norte · 1 golden · anthropic/claude-haiku-5-5 · openai/gpt-5-mini · run_1",
    );
  });
});
