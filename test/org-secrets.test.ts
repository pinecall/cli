// `pinecall secrets`: names only on the way back, the value never in argv, the box's names refused.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/org-secrets.js";
import { inTheWorld } from "../src/world.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_live_the_orgs_own_key";

class FakeGateway {
  readonly heard: { method: string; path: string; body: unknown }[] = [];
  names: string[] = [];
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
    const text = Buffer.concat(chunks).toString();
    const path = request.url ?? "";
    this.heard.push({ method: request.method ?? "", path, body: text === "" ? null : JSON.parse(text) });
    const name = decodeURIComponent(path.split("/").at(-1) ?? "");
    if (request.method === "PUT") this.names = [...new Set([...this.names, name])];
    if (request.method === "DELETE") this.names = this.names.filter((one) => one !== name);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ secrets: this.names.map((one) => ({ name: one, set_by: "m_ana", set_at: 1790000000 })) }));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.names = [];
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

const keeping = (argv: string[], value = "", out = written(), err = written()) =>
  inTheWorld("production", () => run(argv, { out: out.stream, err: err.stream, env, value: async () => value }));

describe("pinecall secrets", () => {
  it("sets a value read apart from the command line, and lists names alone", async () => {
    const out = written();

    expect(await keeping(["set", "CRM_TOKEN"], "made-up-by-this-test")).toBe(0);
    expect(await keeping(["list"], "", out)).toBe(0);

    expect(gateway.heard[0]).toEqual({ method: "PUT", path: "/v1/secrets/CRM_TOKEN", body: { value: "made-up-by-this-test" } });
    expect(out.text()).toMatch(/^CRM_TOKEN {2}\d{4}-\d\d-\d\d \d\d:\d\d {2}m_ana\n$/);
    expect(out.text()).not.toContain("made-up-by-this-test");
  });

  it("refuses an empty value, a name a shell would not take, and the box's own names, asking nothing", async () => {
    const err = written();

    expect(await keeping(["set", "CRM_TOKEN"], "", written(), err)).toBe(2);
    expect(await keeping(["set", "crm_token"], "x", written(), err)).toBe(2);
    expect(await keeping(["set", "PINECALL_KEY"], "x", written(), err)).toBe(2);

    expect(err.text()).toContain("no value for CRM_TOKEN");
    expect(err.text()).toContain("crm_token is no name for a secret");
    expect(err.text()).toContain("PINECALL_KEY is the box's to set");
    expect(gateway.heard.filter((one) => one.method === "PUT")).toEqual([]);
  });

  it("drops one", async () => {
    await keeping(["set", "CRM_TOKEN"], "x");

    expect(await keeping(["rm", "CRM_TOKEN"])).toBe(0);

    expect(gateway.names).toEqual([]);
  });
});

describe("a value piped in", () => {
  it("is the whole of stdin, a key of several lines included, without its final newline", async () => {
    const { Readable } = await import("node:stream");
    const { allOfStdin } = await import("../src/secret.js");
    const pem = "-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----\n";

    expect(await allOfStdin(Readable.from([Buffer.from(pem)]))).toBe(pem.trimEnd());
    expect(await allOfStdin(Readable.from([]))).toBe("");
  });
});
