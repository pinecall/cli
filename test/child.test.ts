// The serve entry as a child: told once to leave, killed if it will not, refused if it never registers.

import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { spawnServing } from "../src/child.js";
import type { Started } from "../src/language.js";

const FAKE = fileURLToPath(new URL("./fakes/child.mjs", import.meta.url));

function aFake(env: Record<string, string> = {}): Started {
  return { command: [process.execPath, FAKE], env: { ...process.env, ...env } };
}

const REGISTERED = JSON.stringify([{ type: "agent.registered", agent: "clinica-norte", call: null, data: { app: "app_1" } }]);

describe("a serve entry started here", () => {
  it("registers, and leaves on the one SIGTERM stop sends", async () => {
    const child = spawnServing(aFake({ FAKE_LINES: REGISTERED }), { signals: new EventEmitter() });

    expect(await child.registered("clinica-norte")).toBe("app_1");
    expect(await child.stop()).toBe(0);
  });

  it("is passed the first signal this process hears, and killed by the second", async () => {
    const signals = new EventEmitter();
    const child = spawnServing(aFake({ FAKE_LINES: REGISTERED, FAKE_IGNORES_SIGTERM: "1" }), { signals, graceMs: 60_000 });
    await child.registered("clinica-norte");

    signals.emit("SIGINT");
    signals.emit("SIGINT");

    expect(await child.exited).toBe(128);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("is killed when it does not leave within the grace", async () => {
    const child = spawnServing(aFake({ FAKE_LINES: REGISTERED, FAKE_IGNORES_SIGTERM: "1" }), { signals: new EventEmitter(), graceMs: 50 });
    await child.registered("clinica-norte");

    expect(await child.stop()).toBe(128);
  });

  it("is refused, naming its exit, when it leaves before the agent registers", async () => {
    const child = spawnServing(aFake({ FAKE_EXITS: "2" }), { signals: new EventEmitter() });

    await expect(child.registered("clinica-norte")).rejects.toThrow("the agent's process left (exit 2) before clinica-norte registered");
  });
});
