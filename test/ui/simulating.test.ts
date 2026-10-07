// The console simulation door: class matching, personas and refusals.

import { afterEach, describe, expect, it, vi } from "vitest";

import { TURNS, type Simulated, type Simulation } from "../../src/simulate.js";

/** A simulation as the door asks for one: the agent served is the piece's to add. */
type Asked = Omit<Simulation, "served">;
import type { Persona } from "../../src/testing/personas.js";
import { Refusal } from "../../src/ui/refusal.js";
import { simulatingFrom } from "../../src/ui/simulating.js";
import type { Door } from "../../src/testing/gateway.js";

const DOOR: Door = { url: "http://127.0.0.1:1", apiKey: "pk_never_sent_anywhere", world: "sandbox" };
const APURADO: Persona = {
  name: "apurado",
  about: "",
  goal: "cambiar la cita hoy",
  style: "rápido, corta frases",
  facts: { "su teléfono": "600000001" },
  state: {},
  llm: null,
  tts: null,
  voice: null,
  accepts_when: "",
  declines_when: "",
  author: "Ana",
  set_at: 1,
};

function quiet(): NodeJS.WritableStream {
  return { write: () => true } as unknown as NodeJS.WritableStream;
}

/** Stub the gateway's personas endpoint; returns every URL asked. */
function holding(personas: Persona[]): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(String(url));
    return url.includes("/personas") ? new Response(JSON.stringify({ personas }), { status: 200 }) : new Response("{}", { status: 200 });
  });
  return asked;
}

/** A simulation that opens a call, hangs up, and records its options. */
function opensACall(): { asked: Asked[]; simulate: (p: Persona, how: Asked) => Promise<Simulated | undefined> } {
  const asked: Asked[] = [];
  return {
    asked,
    simulate: async (_persona, how) => {
      asked.push(how);
      how.opened?.("call_abc");
      return { call: "call_abc" };
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("starting one", () => {
  it("plays the caller the gateway holds under that name for the agent, with the terminal's own defaults", async () => {
    const asked = holding([APURADO]);
    const opening = opensACall();
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: opening.simulate });

    const started = await door.start({ agent: "clinica-norte", persona: "apurado" });

    expect(started).toEqual({ call: "call_abc" });
    expect(asked.map((url) => new URL(url).pathname)).toEqual(["/v1/agents/clinica-norte/personas"]);
    expect(opening.asked[0]).toMatchObject({ door: DOOR, judge: false, voice: false, turns: TURNS });
    expect(opening.asked[0]?.degraded).toBeUndefined();
  });

  it("spoils the line the way the flags do: dB under the caller, and percent as a share", async () => {
    holding([APURADO]);
    const opening = opensACall();
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: opening.simulate });

    await door.start({ agent: "clinica-norte", persona: "apurado", voice: true, background_noise: 12, packet_loss: 2 });

    expect(opening.asked[0]?.degraded).toEqual({ interferer_db: 12, packet_loss: 0.02 });
  });

  it("refuses a spoiled line on a written call, in the words the flag is refused with", async () => {
    holding([APURADO]);
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: async () => undefined });

    await expect(door.start({ agent: "clinica-norte", persona: "apurado", packet_loss: 2 })).rejects.toBeInstanceOf(Refusal);
  });

  it("refuses an agent this process does not hold, naming the directory it does", async () => {
    holding([APURADO]);
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: async () => undefined });

    await expect(door.start({ agent: "dental-sur", persona: "apurado" })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a caller nobody wrote, and says where one is written", async () => {
    holding([]);
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: async () => undefined });

    const refused = door.start({ agent: "clinica-norte", persona: "apurado" });

    await expect(refused).rejects.toMatchObject({ status: 404 });
    await expect(refused).rejects.toThrow(/no persona called apurado for clinica-norte: .*personas add/);
  });

  it("refuses a body that names no persona", async () => {
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: async () => undefined });

    await expect(door.start({ agent: "clinica-norte" })).rejects.toMatchObject({ status: 422 });
  });

  it("refuses when the simulation ends without ever opening a call", async () => {
    holding([APURADO]);
    const door = simulatingFrom(DOOR, "clinica-norte", quiet(), { simulate: async () => undefined });

    await expect(door.start({ agent: "clinica-norte", persona: "apurado" })).rejects.toMatchObject({ status: 502 });
  });

  it("carries a simulation's own failure as the refusal, and prints it where the terminal would", async () => {
    holding([APURADO]);
    const written: string[] = [];
    const out = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;
    const door = simulatingFrom(DOOR, "clinica-norte", out, {
      simulate: async () => {
        throw new Error("the gateway answered 503: no worker");
      },
    });

    await expect(door.start({ agent: "clinica-norte", persona: "apurado" })).rejects.toMatchObject({ status: 502 });
    expect(written.join("")).toContain("no worker");
  });
});
