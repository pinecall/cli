// `pinecall pipeline`: the three legs as the next call would build them; the six knobs now
// belong to `pinecall agent set`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/pipeline.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_key";
const AGENT = "clinica-norte";

/** The pipeline door's response: the legs as the next call would build them. */
const REPORT = {
  agent: AGENT,
  hears: { vendor: "deepgram", model: "nova-3", voice_id: null, language: "es" },
  decides: { vendor: "anthropic", model: "claude-haiku-4-5", voice_id: null, language: null },
  speaks: { vendor: "elevenlabs", model: "eleven_flash_v2_5", voice_id: "Lucia", language: "es" },
  greeting: { say: "Clínica Norte, ¿en qué puedo ayudarle?", reply: null, allow_interruptions: null },
  voices: ["Lucia", "Mateo"],
  calls: 12,
  medians: [{ name: "eou_delay", seconds: 0.31, turns: 40 }],
  unavailable_reasons: { cartesia: "no key on this box" },
};

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the agent's two pipeline doors, answering both with the report. */
class FakeGateway {
  readonly heard: Heard[] = [];
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

  /** The last PUT body: the full set of knobs. */
  get turned(): Record<string, unknown> {
    const put = this.heard.filter((one) => one.method === "PUT").at(-1);
    return (put?.body ?? {}) as Record<string, unknown>;
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    this.heard.push({ method: request.method ?? "", path: request.url ?? "", body: text === "" ? null : JSON.parse(text) });
    if (this.refuse !== undefined && request.method === "PUT") {
      response.writeHead(this.refuse.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: this.refuse.detail }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(REPORT));
  }
}

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

function environment(): NodeJS.ProcessEnv {
  return pointingAt(gateway.url, A_KEY);
}

describe("what the agent runs on", () => {
  it("prints the three legs, the opening, the medians and what is not available", async () => {
    const out = written();

    const code = await run(["--agent", AGENT], { out: out.stream, env: environment() });

    expect(code).toBe(0);
    expect(out.text()).toContain("deepgram · nova-3 · es");
    expect(out.text()).toContain("anthropic · claude-haiku-4-5");
    expect(out.text()).toContain("elevenlabs · eleven_flash_v2_5 · Lucia · es");
    expect(out.text()).toContain("Clínica Norte");
    expect(out.text()).toContain("eou_delay 0.31s");
    expect(out.text()).toContain("cartesia is not available here: no key on this box");
  });

  it("answers the door's own JSON when asked for it", async () => {
    const out = written();

    await run(["--agent", AGENT, "--json"], { out: out.stream, env: environment() });

    expect(JSON.parse(out.text())).toMatchObject({ agent: AGENT });
  });
});

describe("the knobs, moved", () => {
  // The knobs are per-corner, versioned settings fields now.
  it("says where set went, and knocks at no door", async () => {
    const err = written();

    const code = await run(["set", "--agent", AGENT, "--llm", "anthropic/claude-haiku-4-5"], {
      out: written().stream,
      err: err.stream,
      env: environment(),
    });

    expect(code).toBe(2);
    expect(err.text()).toContain("pinecall agent set");
    expect(gateway.heard).toHaveLength(0);
  });

  it("says where clear went too, naming the knobs typed", async () => {
    const err = written();

    const code = await run(["clear", "voice", "--agent", AGENT], { out: written().stream, err: err.stream, env: environment() });

    expect(code).toBe(2);
    expect(err.text()).toContain("pinecall agent clear voice");
  });
});
