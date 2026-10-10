// `pinecall agent set`: how a call opens and ends, and who ends the caller's turn.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/agent.js";
import { pointingAt } from "./home.js";
import { FakeGateway } from "./fakes/settings-gateway.js";
import { written } from "./said.js";

// A person's key: in the sandbox it writes a corner of its own, `yours`.
const A_PERSONS_KEY = "pc_live_ana_s_key";
const AGENT = "clinica-norte";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

function environment(): NodeJS.ProcessEnv {
  return pointingAt(gateway.url, A_PERSONS_KEY);
}

describe("how a call opens and ends", () => {
  it("opens on words, or on the model's own with or without an instruction, and may make it interruptible", async () => {
    gateway.yours = null;
    gateway.team = null;
    const greeted = async (...argv: string[]): Promise<unknown> => {
      await run(["set", "--agent", AGENT, ...argv], { out: written().stream, env: environment() });
      return (gateway.written as { config: Record<string, unknown> }).config["greeting"];
    };

    expect(await greeted("--greeting", "improvise")).toEqual({ reply: "" });
    expect(await greeted("--greeting", "improvise: Saludá por el nombre")).toEqual({ reply: "Saludá por el nombre" });
    expect(await greeted("--greeting", "Buenas.", "--greeting-interruptible", "on")).toEqual({ say: "Buenas.", allow_interruptions: true });
  });

  it("lets the model hang up whenever it judges, and names who ends the caller's turn", async () => {
    gateway.yours = null;
    gateway.team = null;

    await run(["set", "--agent", AGENT, "--hangup", "any", "--end-of-turn", "smart-turn"], { out: written().stream, env: environment() });

    expect((gateway.written as { config: Record<string, unknown> }).config).toEqual({ hangup: { when: "" }, end_of_turn: "smart-turn" });
  });

  it("refuses an end of turn nobody has, before anything is written", async () => {
    const said = written();
    expect(await run(["set", "--agent", AGENT, "--end-of-turn", "vad"], { out: written().stream, err: said.stream, env: environment() })).toBe(2);
    expect(said.text()).toContain("--end-of-turn vad is not who ends the turn");
    expect(gateway.heard.filter((one) => one.method === "PUT")).toEqual([]);
  });
});
