// The ring-routing sentence `pinecall line` and `pinecall start` print. It shows emails, never
// member ids.

import { describe, expect, it } from "vitest";

import { calling, describing, forgotten, letGo } from "../src/line.js";
import { type TheLine } from "@pinecall/agents/wire";

const AGENT = "tienda-sur";

function said(over: Partial<TheLine> = {}): TheLine {
  return { agent: AGENT, env: "sandbox", held: true, yours: true, waiting: [], calling: [], ...over };
}

const BERNA = { holder: "m_berna", name: "berna@clinica.test" };
const CARLA = { holder: "m_carla", name: "carla@clinica.test" };

describe("the line, as a person reads it", () => {
  it("says the ring lands here, and nothing else, for the one developer running the agent", () => {
    expect(describing(said({ holding: BERNA }))).toBe("rings in this terminal");
  });

  it("names who else is running it, so the person holding it knows they are not alone", () => {
    const line = said({ holding: BERNA, waiting: [CARLA] });

    expect(describing(line)).toBe("rings in this terminal · also running: carla@clinica.test");
  });

  it("names whose terminal it rings in, and offers the move that needs no upkeep first", () => {
    const line = said({ yours: false, holding: BERNA, waiting: [CARLA] });

    expect(describing(line)).toBe(
      "rings in berna@clinica.test · `pinecall line from <+your-number>` routes yours, or `claim` takes it",
    );
  });

  it("says your own calls already reach you, which is the answer to somebody else holding it", () => {
    const line = said({ yours: false, holding: BERNA, calling: ["+59899222222"] });

    expect(describing(line)).toBe("rings in berna@clinica.test, but not your calls from +59899222222");
  });

  it("puts your own number before who else is running it, holding the line or not", () => {
    const line = said({ holding: CARLA, calling: ["+59899222222"], waiting: [BERNA] });

    expect(describing(line)).toBe(
      "rings in this terminal · your calls from +59899222222 · also running: berna@clinica.test",
    );
  });

  it("never prints a member id, which names nobody a person could recognise", () => {
    expect(describing(said({ yours: false, holding: BERNA }))).not.toContain("m_berna");
  });

  it("says a corner nobody is named in as what it is, rather than as a null", () => {
    const line = said({ yours: false, holding: { holder: null, name: null } });

    expect(describing(line)).toContain("the terminal running the org's own key");
  });

  it("says, after a release nobody picked up, that the line rings nowhere — not that nothing runs", () => {
    expect(letGo(AGENT)).toBe(
      `let go, and nobody else is running ${AGENT}: a call from a number nobody said was theirs rings nowhere until a terminal claims it`,
    );
  });

  it("says what to start when nobody is answering it at all", () => {
    expect(describing(said({ held: false }))).toBe(`nobody is answering ${AGENT}: run \`pinecall start\``);
  });
});

describe("saying which phone is yours", () => {
  it("says the number back, so a typo is a thing you can see", () => {
    expect(calling(["+59899111111"])).toBe("calls from +59899111111 reach this terminal");
  });

  it("says every number when a person has said more than one", () => {
    expect(calling(["+59899111111", "+59899222222"])).toBe(
      "calls from +59899111111, +59899222222 reach this terminal",
    );
  });

  it("does not look like it worked when there was nothing to forget", () => {
    expect(forgotten([])).toBe("no number was reaching this terminal");
  });

  it("names what it forgot", () => {
    expect(forgotten(["+59899111111"])).toBe("calls from +59899111111 no longer reach this terminal");
  });
});

// Doors come from the org's rows (cli/start.ts), since the class declares none.
