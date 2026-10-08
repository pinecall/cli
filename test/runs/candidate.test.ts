// `pinecall runs promote`: the golden the gateway derives from a call, written as a candidate, with a note for each field of its expect.

import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_BANS_THE_TOOL, GROUNDED_IS_ASKED, JUDGES_ASKED_AGAIN, NOTHING_BROKE, promoted } from "../../src/runs/candidate.js";
import type { Door } from "../../src/testing/gateway.js";
import type { Golden } from "../../src/testing/goldens.js";
import { written } from "../said.js";

const THE_CALL = "CA_8f4a2c";

const DOOR: Door = { url: "http://gateway", apiKey: "dev", world: "sandbox" };

// As `GET /v1/calls/{call}/golden` answers a call where consent broke.
const BOOKED_UNASKED: Golden = {
  name: THE_CALL,
  state: {},
  input: ["Hola, quería pedir cita con la doctora Vidal."],
  memory: [],
  events: [],
  today: "2026-09-29",
  expect: { not_tools: ["book_slot"] },
  promoted_from: THE_CALL,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the verb, against a gateway that derives the golden", () => {
  it("asks the call's golden door with the cut and the name, and writes what it answered as the candidate", async () => {
    const out = mkdtempSync(join(tmpdir(), "candidate-"));
    const asked = stub({ ...BOOKED_UNASKED, name: "no-reserva-antes-del-si" });

    const code = await promoted(DOOR, THE_CALL, { out, fromSeq: 8, name: "no-reserva-antes-del-si" }, written().stream);

    expect(code).toBe(0);
    expect(asked).toEqual([`http://gateway/v1/calls/${THE_CALL}/golden?from_seq=8&name=no-reserva-antes-del-si`]);
    expect(readdirSync(out)).toEqual(["no-reserva-antes-del-si.json"]);
    expect(JSON.parse(readFileSync(join(out, "no-reserva-antes-del-si.json"), "utf8"))).toEqual({ ...BOOKED_UNASKED, name: "no-reserva-antes-del-si" });
  });

  it("names no name when none was given, so the gateway names it after the call", async () => {
    const asked = stub(BOOKED_UNASKED);

    await promoted(DOOR, THE_CALL, { out: mkdtempSync(join(tmpdir(), "candidate-")), fromSeq: 0 }, written().stream);

    expect(asked).toEqual([`http://gateway/v1/calls/${THE_CALL}/golden?from_seq=0`]);
  });

  it.each([
    [{ not_tools: ["book_slot"] }, [CONSENT_BANS_THE_TOOL]],
    [{ grounded: true }, [GROUNDED_IS_ASKED]],
    [{ judges: ["promises", "offers-next-slot"] }, [JUDGES_ASKED_AGAIN(["promises", "offers-next-slot"])]],
    [{}, [NOTHING_BROKE]],
  ])("says on stdout what an expect of %j means, so nobody keeps a field they never read", async (expected, notes) => {
    stub({ ...BOOKED_UNASKED, expect: expected });
    const said = written();

    await promoted(DOOR, THE_CALL, { out: mkdtempSync(join(tmpdir(), "candidate-")), fromSeq: 0 }, said.stream);

    expect(said.text().split("\n").slice(1, -1)).toEqual(notes.map((note) => `  ${note}`));
  });

  it("prints the gateway's refusal and exits 1, writing nothing", async () => {
    const out = mkdtempSync(join(tmpdir(), "candidate-"));
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: `call ${THE_CALL} is still going: a case is made of a call that ended` }), { status: 409 }));
    const err = written();

    const code = await promoted(DOOR, THE_CALL, { out, fromSeq: 0 }, written().stream, err.stream);

    expect(code).toBe(1);
    expect(err.text()).toContain("is still going");
    expect(readdirSync(out)).toEqual([]);
  });
});

// Answer every request with this golden; returns the URLs asked.
function stub(golden: Golden): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => (asked.push(url), new Response(JSON.stringify(golden), { status: 200 })));
  return asked;
}
