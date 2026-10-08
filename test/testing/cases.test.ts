// The dataset's doors as data: the defaults a gateway leaves out written in, a case found by its name, a pull that writes before it marks.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { caseNamed, casesOf, pulled } from "../../src/testing/cases.js";
import type { Door } from "../../src/testing/gateway.js";

const DOOR: Door = { url: "http://gateway", apiKey: "dev", world: "sandbox" };

// As the gateway may send it: no status, no broke, nothing decided.
const BARE = {
  id: "case_1",
  agent: "clinica-norte",
  name: "jueves-tarde",
  golden: { name: "jueves-tarde", input: ["Quiero cita el jueves"], expect: { says_any: ["jueves"] } },
  source_call: "call_1",
  source_env: "sandbox",
  held_out: false,
  author: "m_ana",
  created_at: 1790000000.1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the cases of an agent", () => {
  it("carry the defaults the gateway left out, so every front reads one shape", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ cases: [BARE] })));

    expect(await casesOf(DOOR, "clinica-norte")).toEqual({
      cases: [{ ...BARE, status: "approved", broke: [], source_version: null, kept_in_repo: false, decided_by: null }],
      pending: 0,
      pending_at_most: 0,
    });
  });

  it("name the one asked for, or say the agent has none called that", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ cases: [BARE] })));

    expect((await caseNamed(DOOR, "clinica-norte", "jueves-tarde")).id).toBe("case_1");
    await expect(caseNamed(DOOR, "clinica-norte", "viernes")).rejects.toThrow("clinica-norte has no case named viernes");
  });
});

describe("a pull", () => {
  it("leaves the file written when the gateway refuses the mark, so the case is never played by nothing", async () => {
    const folder = mkdtempSync(join(tmpdir(), "pinecall-pull-"));
    vi.stubGlobal("fetch", async (_url: string, sent: { method: string }) =>
      sent.method === "PATCH" ? new Response(JSON.stringify({ detail: "no" }), { status: 500 }) : new Response(JSON.stringify({ cases: [BARE] })),
    );

    await expect(pulled(DOOR, "clinica-norte", "jueves-tarde", folder)).rejects.toThrow("the gateway answered 500");
    expect(existsSync(join(folder, "jueves-tarde.json"))).toBe(true);
  });
});
