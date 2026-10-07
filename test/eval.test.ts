// `pinecall eval`: the door it calls, its output, and its preconditions.

import { describe, expect, it, vi } from "vitest";

import { NO_KEY } from "../src/env.js";
import { linesOf, replayUrl, run, type Answer } from "../src/eval.js";
import { onStderr } from "./said.js";

const ANSWERED: Answer = {
  call: "CA_8f4a2c",
  agent: "clinica-norte",
  passed: true,
  verdicts: [
    { check: "consent", status: "deferred", detail: "the confirmation gate is deferred (2026-09-06)" },
    { check: "latency", status: "passed", detail: "e2e_latency 1.040s <= 2.000s over 2 turns" },
  ],
};

describe("the door the verb knocks at", () => {
  it("is the replay door of the gateway this terminal points at", () => {
    expect(replayUrl("http://localhost:8080", "CA_8f4a2c")).toBe("http://localhost:8080/v1/evals/replay/CA_8f4a2c");
  });

  it("keeps one slash whatever the URL ended with, and escapes the id it was handed", () => {
    expect(replayUrl("http://box:8080/", "CA/8f")).toBe("http://box:8080/v1/evals/replay/CA%2F8f");
  });
});

describe("what a person reads", () => {
  it("puts the call on top and one aligned line per check", () => {
    expect(linesOf(ANSWERED)).toEqual([
      "CA_8f4a2c  clinica-norte",
      "  consent  deferred  the confirmation gate is deferred (2026-09-06)",
      "  latency  passed    e2e_latency 1.040s <= 2.000s over 2 turns",
    ]);
  });
});

describe("what eval needs before it can ask", () => {
  // No key and no `.env`: the folder is unlinked, and the refusal names the linking verb.
  it("names `pinecall link` when this folder holds no key at all", async () => {
    vi.stubEnv("PINECALL_KEY", "");
    const said = onStderr();

    const code = await run(["CA_8f4a2c"]);

    said.restore();
    vi.unstubAllEnvs();
    expect(code).toBe(2);
    expect(said.text()).toBe(`${NO_KEY}\n`);
  });

  it("asks for a call id rather than evaluating whatever was typed first", async () => {
    const said = onStderr();

    const code = await run([]);

    said.restore();
    expect(code).toBe(2);
    expect(said.text()).toContain("usage: pinecall eval <call-id>");
  });
});
