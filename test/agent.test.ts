// `pinecall agent`: the three corners, set, clear, history and processes.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { linesOf } from "../src/agent-lines.js";
import { changes } from "../src/agent-versions.js";
import { run } from "../src/agent.js";
import { inTheWorld } from "../src/world.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_key";
const AGENT = "clinica-norte";

const TEAM = {
  holder: "",
  version: 11,
  author: "m_bruno",
  note: "cleaner on the phone",
  set_at: 1758300000,
  config: { voice: "carolina", llm: "anthropic/claude-haiku-4-5", language: "es", greeting: { say: "Clínica Norte, buenas." }, memory: { remember: ["allergies"], forget: [] } },
};
const YOURS = { holder: "m_ana", version: 3, author: "m_ana", note: null, set_at: 1758310000, config: { voice: "amelia" } };

const PROCESS = {
  app: "app_7",
  agents: [AGENT, "clinica-norte-sales"],
  env: "production",
  host: "web-1",
  address: "34.1.2.3",
  sdk: "pinecall/0.5.1",
  holder: null,
  connected_at: 1758300000,
};

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
  /** The world the request named (`--prod`), if any. */
  world: string | undefined;
}

/** A gateway with the settings doors that answers the three corners and records every write. */
class FakeGateway {
  readonly heard: Heard[] = [];
  yours: typeof YOURS | null = YOURS;
  team: typeof TEAM | null = TEAM;
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

  get written(): Record<string, unknown> {
    const put = this.heard.filter((one) => one.method === "PUT" || one.method === "POST").at(-1);
    return (put?.body ?? {}) as Record<string, unknown>;
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const world = request.headers["pinecall-env"];
    const heard: Heard = {
      method: request.method ?? "",
      path: request.url ?? "",
      body: text === "" ? null : JSON.parse(text),
      world: typeof world === "string" ? world : undefined,
    };
    this.heard.push(heard);
    const answer = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (this.refuse !== undefined && heard.method !== "GET") return answer(this.refuse.status, { detail: this.refuse.detail });
    if (heard.path === "/v1/apps") return answer(200, { apps: [PROCESS] });
    if (heard.path.endsWith("/stop")) return answer(200, { app: "app_7", stopped: true });
    if (heard.path.endsWith("/history?team=true")) return answer(200, { world: "sandbox", holder: "", rows: [TEAM, { ...TEAM, version: 10, note: null, config: { voice: "carolina" } }] });
    if (heard.path.includes("/diff")) return answer(200, { ours: YOURS, theirs: TEAM, changed: ["voice", "llm"] });
    return answer(200, { world: "sandbox", yours: this.yours, team: this.team, production: null });
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

function environment(key: string = A_KEY): NodeJS.ProcessEnv {
  return pointingAt(gateway.url, key);
}

// A production server token: its world is its prefix's, so the verb needs --prod.
const A_LIVE_KEY = "pc_live_the_orgs_key";

describe("the page", () => {
  it("draws the three corners, a row per field, and which version each is at", () => {
    const lines = linesOf(AGENT, { world: "sandbox", yours: YOURS, team: TEAM, production: null });

    expect(lines[0]).toBe("clinica-norte · sandbox");
    expect(lines.find((line) => line.startsWith("  voice"))).toMatch(/voice\s+amelia\s+carolina\s+—/);
    expect(lines.find((line) => line.startsWith("  language"))).toMatch(/language\s+—\s+es\s+—/);
    expect(lines.find((line) => line.startsWith("  greeting"))).toContain('"Clínica Norte, buenas."');
    expect(lines.find((line) => line.startsWith("  memory"))).toContain("remember 1 · forget 0");
    expect(lines.at(-1)).toContain("yours: v3 · m_ana");
    expect(lines.at(-1)).toContain('team: v11 · m_bruno · ');
    expect(lines.at(-1)).toContain("production: nothing set");
  });

  it("reads your column as the team's when you set nothing", () => {
    const lines = linesOf(AGENT, { world: "sandbox", yours: null, team: TEAM, production: null });

    expect(lines.find((line) => line.startsWith("  voice"))).toMatch(/voice\s+\(team's\)\s+carolina/);
  });

  it("prints it, and the door's own JSON when asked", async () => {
    const out = written();

    expect(await run(["--agent", AGENT], { out: out.stream, env: environment() })).toBe(0);
    expect(out.text()).toContain("clinica-norte · sandbox");

    const json = written();
    await run(["--agent", AGENT, "--json"], { out: json.stream, env: environment() });
    expect(JSON.parse(json.text())).toMatchObject({ world: "sandbox" });
  });
});

describe("setting", () => {
  // The door replaces the whole set at a version, so unnamed fields come from the corner's row.
  it("sends the corner's whole row with the version read, and what was typed over it", async () => {
    await run(["set", "--agent", AGENT, "--llm", "anthropic/claude-sonnet-4-5", "--note", "faster"], { out: written().stream, env: environment() });

    expect(gateway.written).toEqual({
      config: { voice: "amelia", llm: "anthropic/claude-sonnet-4-5" },
      if_version: 3,
      note: "faster",
      team: false,
    });
  });

  // `--llm haiku` is a tier: stored raw, the gateway read it as a vendor and no provider answered.
  // Short names expand through the same table `pinecall test --model` uses.
  it("expands a short model name to the id its provider answers to", async () => {
    await run(["set", "--agent", AGENT, "--llm", "haiku"], { out: written().stream, env: environment() });

    expect((gateway.written as { config: Record<string, unknown> }).config["llm"]).toBe("anthropic/claude-haiku-4-5-20251001");
  });

  it("expands the model half of a vendor/model, and leaves a vendor alone and a model alone as typed", async () => {
    for (const [typed, stored] of [
      ["anthropic/opus", "anthropic/claude-opus-5"],
      ["openai/gpt-5", "openai/gpt-5"],
      ["cartesia", "cartesia"],
      ["claude-haiku-4-5", "claude-haiku-4-5"],
    ]) {
      await run(["set", "--agent", AGENT, "--llm", typed!], { out: written().stream, env: environment() });

      expect((gateway.written as { config: Record<string, unknown> }).config["llm"]).toBe(stored);
    }
  });

  it("refuses a name that means no model at all, naming what one is, and writes nothing", async () => {
    for (const said of ["", "openai/", "/haiku"]) {
      const err = written();

      const code = await run(["set", "--agent", AGENT, "--llm", said], { out: written().stream, err: err.stream, env: environment() });

      expect(code).toBe(2);
      expect(err.text()).toContain("names no model");
      expect(err.text()).toContain("haiku · sonnet · opus");
    }
    expect(gateway.heard).toEqual([]);
  });

  it("writes the team's corner with --team, over the team's own row", async () => {
    await run(["set", "--agent", AGENT, "--team", "--greeting", "Buenas."], { out: written().stream, env: environment() });

    const body = gateway.written as { config: Record<string, unknown>; if_version: number; team: boolean };
    expect(body.team).toBe(true);
    expect(body.if_version).toBe(11);
    expect(body.config["greeting"]).toEqual({ say: "Buenas." });
    expect(body.config["llm"]).toBe("anthropic/claude-haiku-4-5");
  });

  it("starts a corner from nothing when no corner has anything, with no version to check", async () => {
    gateway.yours = null;
    gateway.team = null;

    await run(["set", "--agent", AGENT, "--voice", "mateo", "--endpointing-ms", "300"], { out: written().stream, env: environment() });

    expect(gateway.written).toEqual({ config: { voice: "mateo", turn: { endpointing_ms: 300 } }, if_version: null, note: null, team: false });
  });

  // A production token has no corner of its own; the gateway writes the org's. Reading `yours`
  // there built each set on an empty row, so every write erased the previous one.
  it("carries the team's row when the key holds no corner of its own, so a set erases nothing", async () => {
    gateway.yours = null;

    await run(["set", "--agent", AGENT, "--voice", "mateo"], { out: written().stream, env: environment() });

    const body = gateway.written as { config: Record<string, unknown>; if_version: number | null; team: boolean };
    expect(body.config["voice"]).toBe("mateo");
    expect(body.config["llm"]).toBe("anthropic/claude-haiku-4-5");
    expect(body.config["memory"]).toEqual({ remember: ["allergies"], forget: [] });
    expect(body.if_version).toBe(11);
    expect(body.team).toBe(false);
  });

  it("replaces the memory lists whole", async () => {
    await run(["set", "--agent", AGENT, "--team", "--remember", "pets", "--remember", "the address"], { out: written().stream, env: environment() });

    expect((gateway.written as { config: { memory: unknown } }).config.memory).toEqual({ remember: ["pets", "the address"], forget: [] });
  });

  it("clears named fields and keeps the rest; with none, everything", async () => {
    await run(["clear", "voice", "language", "--agent", AGENT, "--team"], { out: written().stream, env: environment() });
    expect((gateway.written as { config: Record<string, unknown> }).config).toEqual({ llm: "anthropic/claude-haiku-4-5", greeting: { say: "Clínica Norte, buenas." }, memory: { remember: ["allergies"], forget: [] } });

    await run(["clear", "--agent", AGENT], { out: written().stream, env: environment() });
    expect(gateway.written).toMatchObject({ config: {}, if_version: 3 });
  });

  it("refuses a field nobody has, naming the ten", async () => {
    const err = written();

    const code = await run(["clear", "temperature", "--agent", AGENT], { out: written().stream, err: err.stream, env: environment() });

    expect(code).toBe(1);
    expect(err.text()).toContain("no field called temperature");
    expect(err.text()).toContain("tts-model");
  });

  it("says the gateway's own sentence when the corner moved", async () => {
    gateway.refuse = { status: 409, detail: "this corner is at v4 now, not the version you read: read it again, then set again" };
    const err = written();

    const code = await run(["set", "--agent", AGENT, "--voice", "sofia"], { out: written().stream, err: err.stream, env: environment() });

    expect(code).toBe(1);
    expect(err.text()).toContain("this corner is at v4 now");
  });
});

describe("the versions", () => {
  it("prints a history as what each version changed", async () => {
    const out = written();

    await run(["history", "--agent", AGENT, "--team"], { out: out.stream, env: environment() });

    expect(out.text()).toContain("the org's own corner");
    expect(out.text()).toContain("v11 · m_bruno");
    expect(out.text()).toContain("llm — → anthropic/claude-haiku-4-5");
    expect(out.text()).toContain("v10 · m_bruno");
  });

  // The end-of-turn confidence decides whether the agent answers half a sentence, and it is a
  // fraction, unlike every other numeric flag.
  it("takes the two confidences a turn ends on as fractions, beside the knobs already there", async () => {
    gateway.yours = null;
    gateway.team = null;

    await run(["set", "--agent", AGENT, "--eot-threshold", "0.85", "--eager-eot-threshold", "0.4"], { out: written().stream, env: environment() });

    expect(gateway.written).toEqual({ config: { turn: { eot_threshold: 0.85, eager_eot_threshold: 0.4 } }, if_version: null, note: null, team: false });
  });

  it("refuses a confidence that is not one, before anything is written", async () => {
    const said = written();
    const code = await run(["set", "--agent", AGENT, "--eot-threshold", "high"], { out: written().stream, err: said.stream, env: environment() });

    expect(code).toBe(2);
    expect(gateway.heard.filter((one) => one.method === "PUT")).toEqual([]);
    expect(said.text()).toContain("is not a confidence");
  });

  // Typed rather than a bare flag, because an org must be able to turn recording off.
  it("turns the recording off for one agent, in one corner", async () => {
    gateway.yours = null;
    gateway.team = null;

    await run(["set", "--agent", AGENT, "--record", "off"], { out: written().stream, env: environment() });

    expect(gateway.written).toEqual({ config: { record: false }, if_version: null, note: null, team: false });
  });

  it("refuses anything but on or off, before anything is written", async () => {
    const said = written();
    const code = await run(["set", "--agent", AGENT, "--record", "sometimes"], { out: written().stream, err: said.stream, env: environment() });

    expect(code).toBe(2);
    expect(gateway.heard.filter((one) => one.method === "PUT")).toEqual([]);
    expect(said.text()).toContain("is not on or off");
  });

  it("sets how long a voice call may run, in minutes, sent as seconds", async () => {
    gateway.yours = null;
    gateway.team = null;

    await run(["set", "--agent", AGENT, "--max-duration", "15"], { out: written().stream, env: environment() });

    expect(gateway.written).toEqual({ config: { max_duration_s: 900 }, if_version: null, note: null, team: false });
  });

  it("takes off for no limit, and refuses a minute count outside 1 to 60 before anything is written", async () => {
    gateway.yours = null;
    gateway.team = null;
    await run(["set", "--agent", AGENT, "--max-duration", "off"], { out: written().stream, env: environment() });
    expect(gateway.written).toEqual({ config: { max_duration_s: 0 }, if_version: null, note: null, team: false });

    const said = written();
    const code = await run(["set", "--agent", AGENT, "--max-duration", "90"], { out: written().stream, err: said.stream, env: environment() });
    expect(code).toBe(2);
    expect(said.text()).toContain("is not 1 to 60 minutes, or off");
  });

  it("sets the language the voice and the ears are set to, and refuses a blank one before anything is written", async () => {
    gateway.yours = null;
    gateway.team = null;
    await run(["set", "--agent", AGENT, "--language", "pt-BR"], { out: written().stream, env: environment() });
    expect(gateway.written).toEqual({ config: { language: "pt-BR" }, if_version: null, note: null, team: false });

    const said = written();
    const code = await run(["set", "--agent", AGENT, "--language", " "], { out: written().stream, err: said.stream, env: environment() });
    expect(code).toBe(2);
    expect(said.text()).toContain("--language needs a tag");
  });

  it("says what changes between two configs, field by field", () => {
    expect(changes({ voice: "carolina" }, { voice: "amelia", turn: { endpointing_ms: 300 } }, "")).toBe("voice carolina → amelia · turn — → endpointing 300 ms");
    expect(changes({}, {}, "  ")).toBe("");
  });

  // Production is set at its own instance: each request names its world and the instance refuses
  // the other. Nothing is promoted from the sandbox.
  it("names production when --prod names it, and the sandbox otherwise", async () => {
    await inTheWorld("production", () => run(["set", "--agent", AGENT, "--voice", "amelia"], { out: written().stream, env: environment(A_LIVE_KEY) }));
    await run(["set", "--agent", AGENT, "--voice", "carolina"], { out: written().stream, env: environment() });

    const writes = gateway.heard.filter((one) => one.method === "PUT");
    expect(writes.map((one) => one.world)).toEqual(["production", "sandbox"]);
  });

  it("rolls one version back as the next one", async () => {
    await run(["rollback", "10", "--agent", AGENT, "--team"], { out: written().stream, env: environment() });

    expect(gateway.written).toEqual({ version: 10, team: true });
  });
});

describe("the processes", () => {
  it("lists every app holding the org's agents: whose, where it runs, the sdk, since when", async () => {
    const out = written();

    expect(await run(["list"], { out: out.stream, env: environment() })).toBe(0);

    expect(out.text()).toBe("app_7  clinica-norte, clinica-norte-sales  the org's · web-1 (34.1.2.3) · pinecall/0.5.1 · since 2025-09-19 16:40\n");
  });

  it("stops one by its id, in the world --prod names", async () => {
    const out = written();

    expect(await inTheWorld("production", () => run(["stop", "app_7"], { out: out.stream, env: environment(A_LIVE_KEY) }))).toBe(0);

    expect(gateway.heard.at(-1)).toMatchObject({ method: "POST", path: "/v1/apps/app_7/stop", world: "production" });
    expect(out.text()).toContain("stopped app_7");
  });

  it("asks which app when none is named", async () => {
    const err = written();

    expect(await run(["stop"], { out: written().stream, err: err.stream, env: environment() })).toBe(2);
    expect(err.text()).toContain("pinecall agent list");
    expect(await run(["stop", ""], { out: written().stream, err: written().stream, env: environment() })).toBe(2);
    expect(gateway.heard.filter((one) => one.method === "POST")).toEqual([]);
  });
});
