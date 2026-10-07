// What a serve entry says on stdout, read: the app each agent registered as, and every entry after.

import { PassThrough, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { servingFrom, type EventLine } from "../src/serving.js";

const registered = (agent: string, app: string): string =>
  JSON.stringify({ type: "agent.registered", agent, call: null, data: { app } });

function anErr(): { stream: Writable; text: () => string } {
  let text = "";
  return {
    stream: new Writable({ write: (chunk: Buffer, _encoding, done) => { text += chunk.toString(); done(); } }),
    text: () => text,
  };
}

const later = async (): Promise<void> => await new Promise((wake) => setTimeout(wake, 5));

describe("the agents a serve entry holds", () => {
  it("are known by the app their first agent.registered names, and waited for until it comes", async () => {
    const lines = new PassThrough();
    const serving = servingFrom(lines, anErr().stream);
    const waiting = serving.registered("clinica-norte");

    lines.write(`${registered("clinica-norte", "app_1")}\n`);

    expect(await waiting).toBe("app_1");
    expect(serving.app("clinica-norte")).toBe("app_1");
  });

  it("take the app of a later registration, as a gateway restart gives one", async () => {
    const lines = new PassThrough();
    const serving = servingFrom(lines, anErr().stream);
    lines.write(`${registered("clinica-norte", "app_1")}\n${registered("clinica-norte", "app_2")}\n`);
    await later();

    expect(serving.app("clinica-norte")).toBe("app_2");
  });

  it("are refused by name when none registered in time", async () => {
    const serving = servingFrom(new PassThrough(), anErr().stream, 10);

    await expect(serving.registered("clinica-norte")).rejects.toThrow("clinica-norte did not register within 0.01s");
  });
});

describe("every line after", () => {
  it("reaches a listener as the entry it is, and a line that is no entry goes to err as it came", async () => {
    const lines = new PassThrough();
    const err = anErr();
    const serving = servingFrom(lines, err.stream);
    const heard: EventLine[] = [];
    serving.onEvent((line) => heard.push(line));

    lines.write(`${JSON.stringify({ type: "turn.user", agent: "clinica-norte", call: "call_1", data: { text: "hola" } })}\nDebugger listening on ws://127.0.0.1:9229\n`);
    await later();

    expect(heard).toEqual([{ type: "turn.user", agent: "clinica-norte", call: "call_1", data: { text: "hola" } }]);
    expect(err.text()).toBe("Debugger listening on ws://127.0.0.1:9229\n");
  });
});
