// The desk from an assistant: a live call read as it happens, each move sent as the verb the runtime takes, an ended call refused.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENDED } from "../../../src/mcp/tools/supervising.js";
import { A_PROJECTS_KEY, aClient, aProject, called, FakeGateway } from "../fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

const CALL = "call_1";
const STATE = `GET /v1/calls/${CALL}/state`;
const entry = (seq: number, type: string, data: Record<string, unknown>) => ({ seq, type, data, call: CALL });

async function opened() {
  const { client } = await aClient();
  await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });
  return client;
}

describe("watching a live call", () => {
  it("reads the caller, the agent, its tools and every move of a desk, and where to read on from", async () => {
    gateway.doors.set(STATE, [200, { live: true, last_seq: 7 }]);
    gateway.doors.set(`GET /v1/calls/${CALL}/events?after=0&limit=200`, [200, { entries: [
      entry(3, "turn.user", { text: "My order arrived broken." }),
      entry(4, "tool.call", { name: "takeMessage", arguments: { about: "a broken order" } }),
      entry(5, "metrics.turn", { e2e_latency: 0.8 }),
      entry(6, "supervisor.whispered", { text: "Offer a refund." }),
      entry(7, "turn.agent", { text: "I am sorry. I can offer a refund." }),
    ] }]);
    const client = await opened();

    const seen = JSON.parse((await called(client, "supervise", { action: "watch", call: CALL, wait_s: 0 })).text);

    expect(seen).toEqual({
      call: CALL,
      live: true,
      lines: [
        { seq: 3, caller: "My order arrived broken." },
        { seq: 4, tool: "takeMessage", args: { about: "a broken order" } },
        { seq: 6, desk: "whispered", said: "Offer a refund." },
        { seq: 7, agent: "I am sorry. I can offer a refund." },
      ],
      next: 7,
    });
  });
});

describe("a move", () => {
  it("is the runtime's own verb, each with what it carries", async () => {
    gateway.doors.set(STATE, [200, { live: true, last_seq: 7 }]);
    gateway.doors.set(`POST /v1/calls/${CALL}/verbs`, [200, {}]);
    const client = await opened();

    await called(client, "supervise", { action: "whisper", call: CALL, text: " Offer a refund. " });
    await called(client, "supervise", { action: "takeover", call: CALL });
    await called(client, "supervise", { action: "release", call: CALL });
    await called(client, "supervise", { action: "transfer", call: CALL, to: "+15550100", mode: "warm" });
    await called(client, "supervise", { action: "end", call: CALL, reason: "resolved by a person" });

    expect(gateway.asked.filter((one) => one.door.startsWith("POST")).map((one) => one.body)).toEqual([
      { verb: "whisper", text: "Offer a refund." },
      { verb: "takeover" },
      { verb: "release" },
      { verb: "transfer", to: "+15550100", mode: "warm" },
      { verb: "end", reason: "resolved by a person" },
    ]);
  });

  it("is refused on a call that has ended, and without the words a whisper is", async () => {
    gateway.doors.set(STATE, [200, { live: false, last_seq: 9 }]);
    const client = await opened();

    expect(await called(client, "supervise", { action: "say", call: CALL, text: "hello" })).toEqual({ text: ENDED(CALL), refused: true });
    gateway.doors.set(STATE, [200, { live: true, last_seq: 9 }]);
    expect((await called(client, "supervise", { action: "whisper", call: CALL })).text).toBe("whisper takes the words: text");
  });
});
