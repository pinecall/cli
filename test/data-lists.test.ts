// `pinecall data consent` and `pinecall data dnc`: each at its door, the refusals before any request, a file imported.

import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/data.js";
import type { ConsentHistory } from "@pinecall/agents/wire";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

const DANA = "+14155550142";

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the consent and do-not-call doors, and one number's history. */
class FakeGateway {
  readonly heard: Heard[] = [];
  #server!: Server;
  url = "";

  async open(): Promise<void> {
    this.#server = createServer((request, response) => void this.#answer(request, response));
    await new Promise<void>((bound) => this.#server.listen(0, "127.0.0.1", bound));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((closed) => this.#server.close(() => closed()));
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const heard: Heard = { method: request.method ?? "", path: request.url ?? "", body: text === "" ? null : JSON.parse(text) };
    this.heard.push(heard);
    if (heard.path.startsWith("/v1/org/dnc") && heard.method === "GET") {
      return this.#said(response, { numbers: [{ number: DANA, since: 1758300000, source: "the caller asked the agent", given_by: "agent:front-desk" }], next: null });
    }
    if (heard.path === "/v1/org/dnc") {
      const numbers = (heard.body as { numbers: string[] }).numbers;
      return this.#said(response, { added: numbers.filter((n) => n.startsWith("+")).length, refused: numbers.filter((n) => !n.startsWith("+")) });
    }
    const history: ConsentHistory = {
      number: DANA,
      standing: heard.method === "DELETE" ? "opted_out" : "consented",
      rows: [{ kind: heard.method === "DELETE" ? "opt_out" : "express", source: "the booking form", text: null, evidence: null, given_by: "m_ana", call: null, given_at: 1758300000 }],
    };
    return this.#said(response, history);
  }

  #said(response: ServerResponse, body: unknown): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

describe("consent", () => {
  it("reads a number, gives a consent with its source, and puts it on the list", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["consent", DANA], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["consent", DANA, "--give", "express", "--source", "the booking form", "--text", "Yes, call me"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["consent", DANA, "--opt-out"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(gateway.heard.map((one) => [one.method, one.path])).toEqual([
      ["GET", "/v1/org/consents/%2B14155550142"],
      ["POST", "/v1/org/consents"],
      ["DELETE", "/v1/org/consents/%2B14155550142"],
    ]);
    expect(gateway.heard[1]!.body).toEqual({ number: DANA, kind: "express", source: "the booking form", text: "Yes, call me", evidence: null });
    expect(out.text()).toContain(`${DANA}  on the do-not-call list`);
  });

  it("refuses a kind that is none, a consent with no source, both at once, and a source with no --give, before asking", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["consent", DANA, "--source", "the form"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("go with --give");
    expect(await run(["consent", DANA, "--give", "maybe", "--source", "x"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["consent", DANA, "--give", "written"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["consent", DANA, "--give", "written", "--source", "x", "--opt-out"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(gateway.heard).toEqual([]);
  });
});

describe("the do-not-call list", () => {
  it("lists it, adds numbers and imports a file, one a line", async () => {
    const [out, err] = [written(), written()];
    const file = join(mkdtempSync(join(tmpdir(), "dnc-")), "scrub.txt");
    writeFileSync(file, `${DANA}\n+14155550143\n\nnot a number\n`);
    expect(await run(["dnc"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["dnc", "add", DANA, "--source", "our list"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["dnc", "import", file, "--source", "Registry scrub"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(gateway.heard[2]!.body).toEqual({ numbers: [DANA, "+14155550143", "not a number"], source: "Registry scrub" });
    expect(out.text()).toContain(`${DANA}  since`);
    expect(out.text()).toContain("2 number(s) on the list · not numbers: not a number");
  });

  it("asks for a source before a number joins the list, and refuses a file that is empty or not there", async () => {
    const [out, err] = [written(), written()];
    const empty = join(mkdtempSync(join(tmpdir(), "dnc-")), "empty.txt");
    writeFileSync(empty, "\n\n");
    expect(await run(["dnc", "add", DANA], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["dnc", "import", empty, "--source", "x"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("one number a line");
    expect(await run(["dnc", "import", join(tmpdir(), "no-such-file.txt"), "--source", "x"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(gateway.heard).toEqual([]);
  });
});
