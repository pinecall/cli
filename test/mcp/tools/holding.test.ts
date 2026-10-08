// Holding the agent from an assistant: a Ruby agent attached to the process that runs it, or refused with what to run; chat refuses until one is held.

import { hostname } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RUN_IT_YOURSELF } from "../../../src/mcp/holding/held.js";
import { STOP_FIRST } from "../../../src/mcp/session.js";
import { A_PROJECTS_KEY, aClient, aProject, aServedProject, called, FakeGateway } from "../fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

const APPS = (apps: unknown[]): [number, unknown] => [200, { apps }];
const AN_APP = (host: string) => ({ app: "app_ruby", agents: ["front-desk"], env: "sandbox", host, address: null, sdk: "pinecall-ruby", holder: { holder: "m_1", name: "Berna" }, connected_at: 0 });

describe("start", () => {
  it("refuses a Ruby agent nobody runs, naming the command that runs it", async () => {
    gateway.doors.set("GET /v1/apps", APPS([]));
    const { client } = await aClient();
    const root = aProject(A_PROJECTS_KEY, gateway.url, "agent.rb");
    await called(client, "project", { action: "open", path: root });

    expect(await called(client, "start")).toEqual({ text: RUN_IT_YOURSELF("Ruby", root), refused: true });
  });

  it("attaches to the process of this machine already holding the agent, and says so", async () => {
    gateway.doors.set("GET /v1/apps", APPS([AN_APP("another-machine"), AN_APP(hostname())]));
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url, "agent.rb") });

    const started = JSON.parse((await called(client, "start")).text);

    expect(started).toMatchObject({ agent: "front-desk", held: "attached", app: "app_ruby", environment: "sandbox" });
    expect(JSON.parse((await called(client, "status")).text).held).toHaveLength(1);
    expect(JSON.parse((await called(client, "stop")).text)).toEqual({ stopped: "front-desk" });
    expect(JSON.parse((await called(client, "status")).text)).toEqual({ held: [] });
  });
});

describe("a TypeScript agent", () => {
  it("is held in a thread of the server, shown by status, and let go by stop", async () => {
    gateway.doors.set("GET /v1/apps", APPS([]));
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aServedProject(A_PROJECTS_KEY, gateway.url) });

    const started = JSON.parse((await called(client, "start")).text);

    expect(started).toMatchObject({ agent: "front-desk", held: "thread", version: 1, environment: "sandbox" });
    expect(started.app).toMatch(/^app_/);
    expect(JSON.parse((await called(client, "start")).text)).toEqual(started);
    expect(await called(client, "project", { action: "open", path: aProject() })).toEqual({ text: STOP_FIRST(["front-desk"]), refused: true });
    expect(JSON.parse((await called(client, "stop")).text)).toEqual({ stopped: "front-desk" });
    expect(JSON.parse((await called(client, "status")).text)).toEqual({ held: [] });
  });

  it("refuses a second run or simulation while one is in flight, and a wait when none is", async () => {
    gateway.doors.set("GET /v1/apps", APPS([]));
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aServedProject(A_PROJECTS_KEY, gateway.url) });
    await called(client, "start");

    expect((await called(client, "test", { action: "wait" })).text).toBe("no run of front-desk in flight: call test with action run");
    expect((await called(client, "simulate", { action: "wait" })).text).toBe("no simulation of front-desk in flight: call simulate with action run");
    expect((await called(client, "simulate", { action: "run" })).text).toBe("run takes the persona's name: `personas` lists them");
    await called(client, "stop");
  });
});

describe("talking before anything is held", () => {
  it("is refused with the tool that holds the agent", async () => {
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });

    expect(await called(client, "chat", { action: "say", text: "hi" })).toEqual({ text: "no agent is held: call start", refused: true });
    expect((await called(client, "chat", { action: "say", call: "call_x", text: "hi" })).text).toContain("no open call call_x");
    expect((await called(client, "test", { action: "run" })).text).toBe("no agent is held: call start");
  });
});

describe("prompt", () => {
  it("names the terminal command for a Ruby agent, whose prompt Ruby prints", async () => {
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aProject(undefined, undefined, "agent.rb") });

    expect((await called(client, "prompt")).text).toContain("`pinecall prompt` in a terminal");
  });
});
