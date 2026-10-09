/** `pinecall telemetry`: the collector shown, set with its headers off stdin, and cleared. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/telemetry.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_live_the_orgs_own_key";
const A_COLLECTOR = "https://otel.example.test/v1/traces";

interface Heard { method: string; path: string; body: unknown }

class FakeGateway {
  readonly heard: Heard[] = [];
  collector: unknown = null;
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
      response.end(JSON.stringify(this.collector));
      return;
    }
    if (request.method === "DELETE" && this.collector === null) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "this org sends its traces nowhere" }));
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

describe("pinecall telemetry", () => {
  it("says the org sends its traces nowhere, then where, with the headers by name alone", async () => {
    const out = written();
    expect(await run([], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.collector = { endpoint: A_COLLECTOR, header_names: ["x-api-key"], pii: false };
    expect(await run([], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    expect(out.text()).toContain("sends its traces nowhere");
    expect(out.text()).toContain(`traces go to ${A_COLLECTOR} · headers x-api-key · words stripped`);
  });

  it("sets the collector with each header's value read apart from the command line", async () => {
    const out = written();
    const asked: string[] = [];
    const value = async (name: string) => (asked.push(name), `value-of-${name}`);
    const code = await run(["set", A_COLLECTOR, "--header", "x-api-key", "--header", "x-org", "--pii"], { out: out.stream, env: pointingAt(gateway.url, A_KEY), value });
    expect(code).toBe(0);
    expect(asked).toEqual(["x-api-key", "x-org"]);
    expect(gateway.heard[0]).toMatchObject({ method: "PUT", path: "/v1/telemetry", body: { endpoint: A_COLLECTOR, headers: { "x-api-key": "value-of-x-api-key", "x-org": "value-of-x-org" }, pii: true } });
    expect(out.text()).toBe(`traces go to ${A_COLLECTOR} · headers x-api-key, x-org · with what was said\n`);
    expect(out.text()).not.toContain("value-of");
  });

  it("refuses an empty header value and a set with no URL, asking the gateway nothing", async () => {
    const err = written();
    const empty = await run(["set", A_COLLECTOR, "--header", "x-api-key"], { err: err.stream, env: pointingAt(gateway.url, A_KEY), value: async () => "" });
    const bare = await run(["set"], { err: err.stream, env: pointingAt(gateway.url, A_KEY) });
    expect([empty, bare]).toEqual([2, 2]);
    expect(gateway.heard).toEqual([]);
    expect(err.text()).toContain("header x-api-key: an empty value");
  });

  it("clears it, and says so in the gateway's words when there was none", async () => {
    const out = written();
    const err = written();
    gateway.collector = { endpoint: A_COLLECTOR, header_names: [], pii: false };
    expect(await run(["clear"], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.collector = null;
    expect(await run(["clear"], { out: out.stream, err: err.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(1);
    expect(gateway.heard.map((one) => one.method)).toEqual(["DELETE", "DELETE"]);
    expect(out.text()).toContain("the collector forgotten");
    expect(err.text()).toContain("sends its traces nowhere");
  });
});
