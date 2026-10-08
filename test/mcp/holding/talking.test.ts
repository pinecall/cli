// A written call from an assistant: each line answered whole — the agent's turns, its tools, their results — and hung up on end.

import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { Talk } from "../../../src/mcp/holding/talking.js";

let server: WebSocketServer;
let url = "";
let lastUrl = "";
const said: unknown[] = [];

const entry = (type: string, data: Record<string, unknown>) => JSON.stringify({ type, call: "call_1", data });

beforeEach(async () => {
  said.length = 0;
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((listening) => server.once("listening", () => listening()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on("connection", (socket: WebSocket, request) => {
    lastUrl = request.url ?? "";
    socket.send(entry("call.started", {}));
    socket.on("message", (frame: Buffer) => {
      const wanted = JSON.parse(frame.toString()) as { text?: string; hangup?: boolean };
      said.push(wanted);
      if (wanted.hangup === true) return socket.close(1000, "the call ended: caller_hung_up");
      socket.send(entry("turn.user", { text: wanted.text }));
      socket.send(entry("tool.call", { name: "takeMessage", arguments: { name: "***" } }));
      socket.send(entry("tool.result", { name: "takeMessage", output: { ok: true } }));
      socket.send(entry("turn.agent", { text: "Your message reached the team." }));
      socket.send(entry("agent.state", { state: "listening" }));
    });
  });
});

// A call a test leaves open is cut here, or the server waits for it forever.
afterEach(async () => {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((closed) => server.close(() => closed()));
});

const DOOR = () => ({ url, apiKey: "pc_test_key_for_the_test", source: "test", world: "sandbox" as const });

describe("a written call", () => {
  it("dials the agent on the app held, as the caller named", async () => {
    await Talk.opened(DOOR(), "front-desk", "app_1", "+15550100");

    expect(new URLSearchParams(lastUrl.split("?")[1]).get("app")).toBe("app_1");
    expect(new URLSearchParams(lastUrl.split("?")[1]).get("contact")).toBe("+15550100");
  });

  it("answers a line with everything the agent did for it, once it listens again", async () => {
    const talk = await Talk.opened(DOOR(), "front-desk", "app_1");

    const answer = await talk.say("Please tell the manager my order arrived broken.");

    expect(answer).toEqual({
      call: "call_1",
      heard: [
        { tool: "takeMessage", args: { name: "***" } },
        { result: "takeMessage", output: { ok: true } },
        { agent: "Your message reached the team." },
      ],
      ended: false,
    });
  });

  it("hangs up on end, and refuses a line after it", async () => {
    const talk = await Talk.opened(DOOR(), "front-desk", "app_1");
    await talk.say("hi");

    expect(await talk.end()).toEqual({ call: "call_1", heard: [], ended: true });
    expect(said.at(-1)).toEqual({ hangup: true });
    await expect(talk.say("still there?")).rejects.toThrow("this call has ended");
  });
});
