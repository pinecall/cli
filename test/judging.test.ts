/** `pinecall judging`: on or off, the judge model named on the org's own key or one lent, and Pinecall's again. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/judging.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the judging door, whole on PUT, and the vendors the org brought keys for. */
class FakeGateway {
  readonly heard: Heard[] = [];
  judging: Record<string, unknown> = { on: true, ceiling_usd: 0.05, model: null };
  vendors: string[] = ["openai"];
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
    response.writeHead(200, { "content-type": "application/json" });
    if (heard.path === "/v1/provider-keys") return void response.end(JSON.stringify({ vendors: this.vendors }));
    if (heard.method === "PUT") {
      const body = heard.body as Record<string, unknown>;
      this.judging = { on: body["on"], ceiling_usd: 0.05, model: body["model"] ?? null };
    }
    response.end(JSON.stringify(this.judging));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.judging = { on: true, ceiling_usd: 0.05, model: null };
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => gateway.close());

describe("pinecall judging", () => {
  it("says the org is judged on Pinecall's model, billed, under its ceiling", async () => {
    const out = written();

    expect(await run([], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("judging on · Pinecall's judge model · evals billed · ceiling $0.05 a call\n");
    expect(gateway.heard.map((one) => one.method)).toEqual(["GET"]);
  });

  it("names a local model on the org's own key, its options with it, and says its evals are not billed", async () => {
    const out = written();

    expect(await run(["--model", "openai/qwen3-32b", "--option", "base_url=http://gpu:8000/v1"], { out: out.stream, env })).toBe(0);
    expect(gateway.heard[1]).toEqual({
      method: "PUT",
      path: "/v1/org/judging",
      body: { on: true, model: { provider: "openai", model: "qwen3-32b", options: { base_url: "http://gpu:8000/v1" } } },
    });
    expect(out.text()).toBe('judging on · openai/qwen3-32b · base_url="http://gpu:8000/v1" · your own openai key: evals not billed\n');
  });

  it("says a model on a key Pinecall lends is billed", async () => {
    const out = written();

    expect(await run(["--model", "haiku"], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("judging on · anthropic/claude-haiku-5-5 · anthropic on a key Pinecall lends: evals billed · ceiling $0.05 a call\n");
  });

  it("turns judging off and keeps the model it stood on", async () => {
    gateway.judging = { on: true, ceiling_usd: 0.05, model: { provider: "openai", model: "gpt-5.4-mini" } };

    expect(await run(["off"], { out: written().stream, env })).toBe(0);
    expect(gateway.heard[1]?.body).toEqual({ on: false, model: { provider: "openai", model: "gpt-5.4-mini" } });
  });

  it("goes back to Pinecall's model with --platform", async () => {
    gateway.judging = { on: true, ceiling_usd: 0.05, model: { provider: "openai", model: "gpt-5.4-mini" } };

    expect(await run(["--platform"], { out: written().stream, env })).toBe(0);
    expect(gateway.heard[1]?.body).toEqual({ on: true });
  });

  it.each([
    [["maybe"], "usage: pinecall judging"],
    [["--model", "qwen3"], "--model qwen3 names no model"],
    [["--model", "openai/x", "--platform"], "one of them"],
    [["--option", "a=b"], "name it with --model"],
    [["--model", "openai/x", "--option", "nokey"], "is not key=value"],
  ])("refuses %j before asking anything", async (argv, sentence) => {
    const err = written();

    expect(await run(argv, { out: written().stream, err: err.stream, env })).toBe(2);
    expect(err.text()).toContain(sentence);
    expect(gateway.heard).toEqual([]);
  });
});
