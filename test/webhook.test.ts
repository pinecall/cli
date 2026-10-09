/** `pinecall webhook`: the URL shown, set with its secret off stdin, proven with a test, and cleared. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/webhook.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_live_the_orgs_own_key";
const A_URL = "https://hooks.example.test/pinecall";

interface Heard { method: string; path: string; body: unknown }

class FakeGateway {
  readonly heard: Heard[] = [];
  webhook: { url: string; signed: boolean } | null = null;
  tested: { sent: boolean; error: string | null } = { sent: true, error: null };
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
    this.heard.push({ method: request.method ?? "", path: request.url ?? "", body: text === "" ? null : JSON.parse(text) });
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(this.webhook));
      return;
    }
    if (request.method === "POST") {
      response.writeHead(this.webhook === null ? 409 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(this.webhook === null ? { detail: "this org posts its alerts nowhere" } : this.tested));
      return;
    }
    if (request.method === "DELETE" && this.webhook === null) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "this org posts its alerts nowhere" }));
      return;
    }
    response.writeHead(204);
    response.end();
  }
}

let gateway: FakeGateway;
beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});
afterEach(async () => gateway.close());

describe("pinecall webhook", () => {
  it("says the org posts its alerts nowhere, then where, and whether the posts are signed", async () => {
    const out = written();
    expect(await run([], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.webhook = { url: A_URL, signed: true };
    expect(await run([], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    expect(out.text()).toContain("posts its alerts nowhere");
    expect(out.text()).toContain(`alerts go to ${A_URL} · signed`);
  });

  it("sets the URL with the secret read apart from the command line, and without one when not asked", async () => {
    const out = written();
    const code = await run(["set", A_URL, "--secret"], { out: out.stream, env: pointingAt(gateway.url, A_KEY), secret: async () => "shh" });
    expect(code).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "PUT", path: "/v1/webhook", body: { url: A_URL, secret: "shh" } });
    expect(out.text()).toBe(`alerts go to ${A_URL} · signed\n`);
    expect(await run(["set", A_URL], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    expect(gateway.heard[1]).toMatchObject({ body: { url: A_URL, secret: null } });
    expect(out.text()).toContain("not signed");
  });

  it("refuses an empty secret and a set with no URL, asking the gateway nothing", async () => {
    const err = written();
    const empty = await run(["set", A_URL, "--secret"], { err: err.stream, env: pointingAt(gateway.url, A_KEY), secret: async () => "" });
    const bare = await run(["set"], { err: err.stream, env: pointingAt(gateway.url, A_KEY) });
    expect([empty, bare]).toEqual([2, 2]);
    expect(gateway.heard).toEqual([]);
    expect(err.text()).toContain("an empty secret");
  });

  it("tests the URL and exits 1 when it did not take the post, in the gateway's words", async () => {
    const out = written();
    const err = written();
    gateway.webhook = { url: A_URL, signed: false };
    expect(await run(["test"], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.tested = { sent: false, error: "HTTP 404" };
    expect(await run(["test"], { out: out.stream, err: err.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(1);
    expect(out.text()).toContain("the URL took it");
    expect(err.text()).toContain("HTTP 404");
  });

  it("clears it, and says so in the gateway's words when there was none", async () => {
    const out = written();
    const err = written();
    gateway.webhook = { url: A_URL, signed: false };
    expect(await run(["clear"], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.webhook = null;
    expect(await run(["clear"], { out: out.stream, err: err.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(1);
    expect(out.text()).toContain("the webhook forgotten");
    expect(err.text()).toContain("posts its alerts nowhere");
  });
});
