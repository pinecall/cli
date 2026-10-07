// `pinecall providers`: the org's key is sent once and never printed, vendors are read back, and
// the gateway's refusal is shown verbatim.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/providers.js";
import { pointingAt, pointingNowhere } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

// Must never appear in any output or log.
const THE_ORGS_OWN = "sk-the-clinic-brought-its-own-elevenlabs-key";

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the three provider-key doors, one key and one org's vendors. */
class FakeGateway {
  readonly heard: Heard[] = [];
  vendors: string[] = [];
  // GET /v1/providers: the full catalogue, a separate door from the key doors.
  catalogue: unknown = { providers: [], defaults: {}, voices: [] };
  refuse: { status: number; detail: string } | undefined;
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
    if (request.headers.authorization !== `Bearer ${A_KEY}`) return this.#said(response, 401, { detail: "this door takes an API key" });
    if (this.refuse !== undefined) return this.#said(response, this.refuse.status, { detail: this.refuse.detail });
    if (request.url === "/v1/providers") return this.#said(response, 200, this.catalogue);
    if (request.method === "GET") return this.#said(response, 200, { vendors: this.vendors });
    return this.#said(response, 204, null);
  }

  #said(response: ServerResponse, status: number, body: unknown): void {
    if (body === null) {
      response.writeHead(status);
      response.end();
      return;
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.vendors = [];
  gateway.refuse = undefined;
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

/** The key as read from stdin, so no test needs a terminal. */
function typed(key: string): () => Promise<string> {
  return async () => key;
}

describe("bringing a key", () => {
  it("sends it once in the body and prints the vendor and nothing else", async () => {
    const out = written();

    const code = await run(["add", "elevenlabs"], { out: out.stream, env, key: typed(THE_ORGS_OWN) });

    expect(code).toBe(0);
    expect(gateway.heard).toHaveLength(1);
    expect(gateway.heard[0]).toMatchObject({ method: "PUT", path: "/v1/provider-keys/elevenlabs", body: { key: THE_ORGS_OWN } });
    expect(out.text()).toBe("elevenlabs\n");
  });

  it("prints the key nowhere, not on the way out and not on the way back", async () => {
    gateway.vendors = ["elevenlabs"];
    const out = written();
    const err = written();

    await run(["add", "elevenlabs"], { out: out.stream, err: err.stream, env, key: typed(THE_ORGS_OWN) });
    await run(["list"], { out: out.stream, err: err.stream, env });

    expect(out.text()).not.toContain(THE_ORGS_OWN);
    expect(err.text()).not.toContain(THE_ORGS_OWN);
  });

  it("trims what was typed, so a pasted line with a newline in it is still the key", async () => {
    await run(["add", "soniox"], { out: written().stream, env, key: typed(`  ${THE_ORGS_OWN}\n`) });

    expect(gateway.heard[0]?.body).toEqual({ key: THE_ORGS_OWN });
  });

  it("brings nothing when nothing was given, and knocks at no door", async () => {
    const err = written();

    const code = await run(["add", "elevenlabs"], { err: err.stream, env, key: typed("  ") });

    expect(code).toBe(2);
    expect(err.text()).toBe("no key was given: nothing was brought\n");
    expect(gateway.heard).toEqual([]);
  });

  it("prints the gateway's own sentence when the vendor is not one this build runs", async () => {
    gateway.refuse = { status: 400, detail: "no vendor named 11labs; this build runs: anthropic, deepgram, elevenlabs, openai, soniox, whatsapp" };
    const err = written();

    const code = await run(["add", "11labs"], { err: err.stream, env, key: typed(THE_ORGS_OWN) });

    expect(code).toBe(1);
    expect(err.text()).toBe("the gateway answered 400: no vendor named 11labs; this build runs: anthropic, deepgram, elevenlabs, openai, soniox, whatsapp\n");
    expect(err.text()).not.toContain(THE_ORGS_OWN);
  });
});

describe("taking one back and reading the names", () => {
  it("deletes the vendor and says which one", async () => {
    const out = written();

    const code = await run(["rm", "elevenlabs"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "DELETE", path: "/v1/provider-keys/elevenlabs" });
    expect(out.text()).toBe("elevenlabs\n");
  });

  it("says what the gateway said when the org never brought that vendor", async () => {
    gateway.refuse = { status: 404, detail: "org clinica has no soniox key" };
    const err = written();

    const code = await run(["rm", "soniox"], { err: err.stream, env });

    expect(code).toBe(1);
    expect(err.text()).toBe("the gateway answered 404: org clinica has no soniox key\n");
  });

  it("prints one vendor per line, and no value beside it", async () => {
    gateway.vendors = ["anthropic", "elevenlabs"];
    const out = written();

    const code = await run(["list"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "GET", path: "/v1/provider-keys" });
    expect(out.text()).toBe("anthropic\nelevenlabs\n");
  });

  it("says which keys run instead when this org brought none", async () => {
    const out = written();

    await run(["list"], { out: out.stream, env });

    expect(out.text()).toBe("no provider key brought: every call runs on the keys of the box\n");
  });
});

describe("the catalogue", () => {
  it("prints every vendor this build runs, with what each one still wants", async () => {
    const out = written();
    gateway.catalogue = {
      providers: [
        { name: "elevenlabs", does: ["stt", "tts"], standing: "ready", env: "ELEVEN_API_KEY", aliases: ["11labs"] },
        { name: "cartesia", does: ["stt", "tts"], standing: "no key", env: "CARTESIA_API_KEY", aliases: [] },
        { name: "aws", does: ["llm"], standing: "its own", env: null, aliases: ["bedrock"] },
      ],
      defaults: { llm: "anthropic", stt: "soniox", tts: "elevenlabs" },
      voices: ["carolina"],
    };

    const code = await run([], { out: out.stream, env });

    expect(code).toBe(0);
    const said = out.text();
    expect(said).toContain("elevenlabs");
    expect(said).toContain("11labs");
    expect(said).toContain("no key");
    expect(said).toContain("its own");
    expect(said).toContain("3 vendors · ours: llm anthropic · stt soniox · tts elevenlabs");
  });

  it("narrows to one modality, and refuses a word that is not one", async () => {
    const out = written();
    const err = written();
    gateway.catalogue = {
      providers: [
        { name: "elevenlabs", does: ["stt", "tts"], standing: "ready", env: "ELEVEN_API_KEY", aliases: [] },
        { name: "anthropic", does: ["llm"], standing: "ready", env: "ANTHROPIC_API_KEY", aliases: [] },
      ],
      defaults: { llm: "anthropic", stt: "soniox", tts: "elevenlabs" },
      voices: [],
    };

    expect(await run(["--does", "tts"], { out: out.stream, env })).toBe(0);
    // Check the table only; the footer always names it.
    const table = out.text().split("\n\n")[0] ?? "";
    expect(table).toContain("elevenlabs");
    expect(table).not.toContain("anthropic");
    expect(out.text()).toContain("1 vendors");

    expect(await run(["--does", "singing"], { err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("no modality called singing");
  });
});

describe("what it will not do", () => {
  it("prints the usage on a sub-verb it does not have, and knocks at no door", async () => {
    const err = written();

    const code = await run(["drop", "elevenlabs"], { err: err.stream, env });

    expect(code).toBe(2);
    expect(err.text()).toContain("pinecall providers add <vendor>");
    expect(gateway.heard).toEqual([]);
  });

  it("takes a vendor for add and for rm, and asks for the key nowhere until it has one", async () => {
    const err = written();

    expect(await run(["add"], { err: err.stream, env })).toBe(2);
    expect(await run(["rm"], { err: err.stream, env })).toBe(2);
    expect(gateway.heard).toEqual([]);
  });

  it("says where to get a key before it knocks, when this terminal holds none", async () => {
    const err = written();

    const code = await run(["list"], { err: err.stream, env: pointingNowhere() });

    expect(code).toBe(2);
    expect(err.text()).toContain("`pinecall link`");
    expect(gateway.heard).toEqual([]);
  });
});
