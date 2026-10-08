// What `pinecall cases` prints: an age in its largest unit, and the next commands by where a case stands.

import { describe, expect, it } from "vitest";

import { ageOf, caseLines } from "../src/case-lines.js";
import type { EvalCase } from "../src/testing/cases.js";

const A_CASE: EvalCase = {
  id: "case_1",
  agent: "clinica-norte",
  name: "jueves-tarde",
  golden: { name: "jueves-tarde", input: ["Quiero cita el jueves"] },
  source_call: "call_1",
  source_env: "sandbox",
  held_out: true,
  author: "m_ana",
  created_at: 1790000000,
  status: "approved",
  broke: [],
  source_version: null,
  kept_in_repo: false,
  decided_by: null,
};

describe("an age", () => {
  it.each([
    [40, "40s"],
    [12 * 60, "12m"],
    [3 * 3600 + 59, "3h"],
    [2 * 86_400, "2d"],
  ])("%d seconds is %s", (seconds, said) => {
    expect(ageOf(1000, 1000 + seconds)).toBe(said);
  });
});

describe("the commands a case shown ends on", () => {
  it("offer a pull for an approved case, and no approve", () => {
    const text = caseLines(A_CASE).join("\n");

    expect(text).toContain("pinecall cases pull jueves-tarde");
    expect(text).not.toContain("pinecall cases approve");
    expect(text).toContain("held out: played only when a run names it");
    expect(text).toContain("nothing: a person kept it from a call that held");
  });

  it("offer a reopen for a dismissed case", () => {
    expect(caseLines({ ...A_CASE, status: "dismissed", decided_by: "m_ana" }).join("\n")).toContain("pinecall cases reopen jueves-tarde");
  });
});
