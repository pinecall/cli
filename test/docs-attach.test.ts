// `pinecall docs attach | detach | attached`: the attached base is a settings field, written as
// the corner's next version.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NOT_ATTACHED } from "../src/docs-attach.js";
import { run } from "../src/docs.js";
import { inTheWorld } from "../src/world.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";
// The same org's production server token, used by --prod.
const A_LIVE_KEY = "pc_live_the_orgs_own_key";
const AGENT = "clinica-norte";
const SETTINGS = `/v1/agents/${AGENT}/settings`;

const TEAM = { holder: "", version: 11, author: "m_bruno", note: null, set_at: 1758300000, config: { voice: "carolina", bases: [{ base: "clinica", k: 4 }] } };
const YOURS = { holder: "m_ana", version: 3, author: "m_ana", note: null, set_at: 1758310000, config: { voice: "amelia" } };

/** One request as the gateway received it, with the world it named. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
  world: string | undefined;
}

/** A gateway with the settings and knowledge doors that records every write. */
class FakeGateway {
  readonly heard: Heard[] = [];
  yours: typeof YOURS | null = YOURS;
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

  /** The last PUT body. */
  get written(): Record<string, unknown> {
    return (this.heard.filter((one) => one.method === "PUT").at(-1)?.body ?? {}) as Record<string, unknown>;
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const world = request.headers["pinecall-env"];
    const heard: Heard = { method: request.method ?? "", path: request.url ?? "", body: text === "" ? null : JSON.parse(text), world: typeof world === "string" ? world : undefined };
    this.heard.push(heard);
    if (![A_KEY, A_LIVE_KEY].some((key) => request.headers.authorization === `Bearer ${key}`)) return this.#said(response, 401, { detail: "this door takes an API key" });
    if (heard.path === "/v1/knowledge/attached") return this.#said(response, 200, { bases: [{ base: "clinica", agents: [AGENT, "clinica-sur"] }, { base: "tarifas", agents: ["clinica-sur"] }] });
    if (heard.path === SETTINGS && heard.method === "GET") return this.#said(response, 200, { world: "sandbox", yours: this.yours, team: TEAM, production: TEAM, declared: null });
    if (heard.path === SETTINGS && heard.method === "PUT") {
      const { config, team } = heard.body as { config: Record<string, unknown>; team: boolean };
      const row = { ...(team ? TEAM : (this.yours ?? YOURS)), version: (team ? TEAM.version : (this.yours?.version ?? 0)) + 1, config };
      return this.#said(response, 200, { world: "sandbox", yours: team ? this.yours : row, team: team ? row : TEAM, production: TEAM, declared: null });
    }
    if (heard.method === "PUT") return this.#said(response, 200, { base: heard.path.split("/").at(-1), chunks: 7, took_ms: 300 });
    return this.#said(response, 404, { detail: `nothing at ${heard.path}` });
  }

  #said(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.yours = YOURS;
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

describe("attaching a base", () => {
  it("adds the base to your corner's list with how a turn reads it, sent with the version it was read at", async () => {
    const out = written();

    expect(await run(["attach", "clinica", "--k", "3", "--mode", "tool", "--min-score", "0.4", "--agent", AGENT], { out: out.stream, env })).toBe(0);

    expect(gateway.written).toEqual({
      config: { voice: "amelia", bases: [{ base: "clinica", k: 3, mode: "tool", min_score: 0.4 }] },
      if_version: 3,
      note: "attached clinica",
      team: false,
    });
    expect(out.text()).toBe(`${AGENT} · clinica attached · your corner v4\n`);
  });

  it("writes the team's corner with --team, replacing a base already there by the same name", async () => {
    const out = written();

    await run(["attach", "clinica", "--k", "8", "--agent", AGENT, "--team"], { out: out.stream, env });

    expect(gateway.written).toEqual({ config: { voice: "carolina", bases: [{ base: "clinica", k: 8 }] }, if_version: 11, note: "attached clinica", team: true });
    expect(out.text()).toBe(`${AGENT} · clinica attached · the team's corner v12\n`);
  });

  // A key without a corner writes the org's corner, so the attach must build on that row; the
  // whole set is replaced, and an empty base row would drop its knowledge and voice.
  it("carries the corner the gateway will write when the key holds none of its own", async () => {
    gateway.yours = null;

    await run(["attach", "tarifas", "--agent", AGENT], { out: written().stream, env });

    expect(gateway.written).toEqual({
      config: { voice: "carolina", bases: [{ base: "clinica", k: 4 }, { base: "tarifas" }] },
      if_version: 11,
      note: "attached tarifas",
      team: false,
    });
  });

  it("names production when --prod does, on the read and on the write", async () => {
    const live = pointingAt(gateway.url, A_LIVE_KEY);
    await inTheWorld("production", () => run(["attach", "clinica", "--agent", AGENT], { out: written().stream, env: live }));

    expect(gateway.heard.map((one) => one.world)).toEqual(["production", "production"]);
  });

  it("refuses a k that is not a whole number, before anything is sent", async () => {
    const err = written();

    expect(await run(["attach", "clinica", "--k", "many", "--agent", AGENT], { err: err.stream, env })).toBe(1);

    expect(err.text()).toBe("--k takes a whole number of chunks, not many\n");
    expect(gateway.heard).toEqual([]);
  });
});

describe("detaching a base", () => {
  it("takes the base out of the team's list, and leaves an empty list when it was the last one", async () => {
    const out = written();

    expect(await run(["detach", "clinica", "--agent", AGENT, "--team"], { out: out.stream, env })).toBe(0);

    // Keep the empty list: dropping the field would inherit the bases of the corner below.
    expect(gateway.written).toEqual({ config: { voice: "carolina", bases: [] }, if_version: 11, note: "detached clinica", team: true });
    expect(out.text()).toBe(`${AGENT} · clinica detached · the team's corner v12\n`);
  });

  it("says so when the base was not attached in that corner, and writes nothing", async () => {
    const err = written();

    expect(await run(["detach", "clinica", "--agent", AGENT], { err: err.stream, env })).toBe(1);

    expect(err.text()).toBe(`${NOT_ATTACHED(AGENT, "clinica")}\n`);
    expect(gateway.heard.filter((one) => one.method === "PUT")).toEqual([]);
  });
});

describe("who reads what", () => {
  it("prints one line per base, with the agents that read it", async () => {
    const out = written();

    expect(await run(["attached"], { out: out.stream, env })).toBe(0);

    expect(out.text()).toBe(`clinica · read by ${AGENT}, clinica-sur\ntarifas · read by clinica-sur\n`);
  });
});
