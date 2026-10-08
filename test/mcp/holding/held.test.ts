// An agent held in a thread: reloaded on a save, the version before kept when a save does not load, nothing left running after stop.

import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { homeOf } from "../../../src/home.js";
import { Held, theAppHere } from "../../../src/mcp/holding/held.js";
import { A_PROJECTS_KEY, aServedProject, FakeGateway, NOTHING_BESIDE } from "../fake.js";

let gateway: FakeGateway;
let held: Held | undefined;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
  gateway.doors.set("GET /v1/apps", [200, { apps: [] }]);
});

afterEach(async () => {
  await held?.stop();
  held = undefined;
  await gateway.close();
});

const SETTLES_MS = 50;

function aHeld(root: string): { held: Held; file: string } {
  const file = join(root, "agents", "front-desk", "agent.tsx");
  held = new Held({ url: gateway.url, apiKey: A_PROJECTS_KEY, source: ".env", world: "sandbox" }, homeOf(file), { beside: NOTHING_BESIDE, settlesMs: SETTLES_MS });
  return { held, file };
}

async function until(said: () => boolean, withinMs = 15_000): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!said() && Date.now() < deadline) await new Promise((rung) => setTimeout(rung, 20));
  expect(said()).toBe(true);
}

describe("an agent held in a thread", () => {
  it("answers as version 1 once its thread registered", async () => {
    const { held } = aHeld(aServedProject(A_PROJECTS_KEY, gateway.url));

    await held.start();

    expect(held.how()).toBe("thread");
    expect(held.version).toBe(1);
    expect(await held.ready()).toMatch(/^app_/);
  });

  it("reloads on a save: the new version registers, then the one before drains", async () => {
    const { held, file } = aHeld(aServedProject(A_PROJECTS_KEY, gateway.url));
    await held.start();
    const before = held.app();

    writeFileSync(file, "// the class, edited\n");
    await until(() => held.version === 2);

    expect(await held.ready()).not.toBe(before);
    expect(held.logs.last(3)).toContain("── version 2 answering");
    expect(held.logs.last(3)).toContain("draining · no live calls");
  });

  it("keeps the version before when a save does not load, and refuses with the load's own words until the next save", async () => {
    const { held, file } = aHeld(aServedProject(A_PROJECTS_KEY, gateway.url));
    await held.start();
    const before = held.app();

    writeFileSync(file, "// BROKEN\n");
    await until(() => held.broken !== undefined);

    expect(held.version).toBe(1);
    expect(held.app()).toBe(before);
    await expect(held.ready()).rejects.toThrow("Transform failed: Expected ;");

    writeFileSync(file, "// mended\n");
    await until(() => held.version === 2);
    expect(held.broken).toBeUndefined();
  });

  it("drops a save still settling when stopped, so nothing runs after stop", async () => {
    const { held, file } = aHeld(aServedProject(A_PROJECTS_KEY, gateway.url));
    await held.start();

    writeFileSync(file, "// edited as the server stops\n");
    await held.stop();
    await new Promise((rung) => setTimeout(rung, SETTLES_MS * 4));

    expect(held.how()).toBe("stopped");
    expect(held.version).toBe(1);
    expect(held.app()).toBeUndefined();
  });
});

describe("the app already here", () => {
  const anApp = (app: string, sdk: string, host = hostname()) => ({ app, agents: ["front-desk"], env: "sandbox", host, address: null, sdk, holder: { holder: "m_1", name: "Berna" }, connected_at: 0 });

  it("is the agent's own process, never the companion a terminal or another server keeps beside it", async () => {
    gateway.doors.set("GET /v1/apps", [200, { apps: [anApp("app_companion", "pinecall-cli/0.9.30"), anApp("app_elsewhere", "pinecall/0.9.21", "another-machine"), anApp("app_agent", "pinecall/0.9.21")] }]);

    expect(await theAppHere({ url: gateway.url, apiKey: A_PROJECTS_KEY, source: ".env", world: "sandbox" }, "front-desk")).toBe("app_agent");
  });
});
