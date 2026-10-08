// `pinecall chat` across a gateway restart: the socket redials naming the same call.

import { PassThrough } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { talk } from "../src/chat.js";

let server: WebSocketServer | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((done) => (server === null ? done() : server.close(() => done())));
  server = null;
});

const entry = (type: string, data: Record<string, unknown> = {}): string =>
  JSON.stringify({ seq: 1, ts: 0, call: "call_1", agent: "clinica", type, ephemeral: false, data });

/** A chat door that answers each connection with the next scene and records what each requested. */
async function aDoor(...scenes: ((socket: WebSocket) => void)[]): Promise<{ url: string; asked: string[] }> {
  const asked: string[] = [];
  server = new WebSocketServer({ port: 0 });
  server.on("connection", (socket, request) => {
    asked.push(request.url ?? "");
    scenes[asked.length - 1]?.(socket);
  });
  await new Promise((ready) => server?.once("listening", ready));
  const { port } = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${port}/v1/chat?agent=clinica`, asked };
}

it("dials again naming the call when the gateway drops the socket, and ends with the call", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const door = await aDoor(
    (socket) => {
      socket.send(entry("call.started", { channel: "web", direction: "inbound", from: "web_1", to: "clinica", caller: null, started_at: 0 }));
      setTimeout(() => socket.terminate(), 20);
    },
    (socket) => {
      socket.send(entry("call.attached", { app: "app_2", started: {}, state: {}, seq: 1 }));
      socket.send(entry("call.score", { judges: [] }));
      setTimeout(() => socket.close(), 20);
    },
  );
  const typed = new PassThrough();
  const ended = await talk(() => door.url, { url: door.url, apiKey: "pk_test", source: "test", world: "sandbox" }, true, typed);
  expect(ended).toBe(0);
  expect(door.asked).toEqual(["/v1/chat?agent=clinica", "/v1/chat?agent=clinica&call=call_1"]);
});

it("leaves when the gateway refuses the call in a sentence before it has one", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const said: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (said.push(String(chunk)), true));
  const door = await aDoor((socket) => socket.close(1008, "nobody is holding clinica"));
  const ended = await talk(() => door.url, { url: door.url, apiKey: "pk_test", source: "test", world: "sandbox" }, true, new PassThrough());
  expect(ended).toBe(1);
  expect(door.asked).toHaveLength(1);
  expect(said.join("")).toContain("nobody is holding clinica");
});

it("waits, when the input ends, for the answer to every line it sent, then hangs up and the gateway closes", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const heard: string[] = [];
  let closedAt = -1;
  const door = await aDoor((socket) => {
    socket.send(entry("call.started", { channel: "web", direction: "inbound", from: "web_1", to: "clinica", caller: null, started_at: 0 }));
    socket.send(entry("agent.state", { state: "listening" }));
    // The gateway takes the lines one turn at a time, each answered before the next is heard.
    let turns = Promise.resolve();
    socket.on("message", (frame) => {
      heard.push(String(frame));
      if (JSON.parse(String(frame)).hangup === true) return socket.close(1000, "the call ended: caller_hung_up");
      turns = turns.then(
        () =>
          new Promise((answered) =>
            setTimeout(() => {
              socket.send(entry("turn.user", { text: JSON.parse(String(frame)).text }));
              socket.send(entry("agent.state", { state: "thinking" }));
              socket.send(entry("turn.agent", { text: "son nueve euros" }));
              socket.send(entry("agent.state", { state: "listening" }));
              answered(undefined);
            }, 50),
          ),
      );
    });
    socket.on("close", () => (closedAt = heard.length));
  });
  const typed = new PassThrough();
  typed.end("hola\ncuánto cuesta\n");
  const ended = await talk(() => door.url, { url: door.url, apiKey: "pk_test", source: "test", world: "sandbox" }, true, typed);
  expect(ended).toBe(0);
  expect(heard).toEqual([JSON.stringify({ text: "hola" }), JSON.stringify({ text: "cuánto cuesta" }), JSON.stringify({ hangup: true })]);
  await vi.waitFor(() => expect(closedAt).toBe(3));
});
