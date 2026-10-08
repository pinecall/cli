// `pinecall test`: what a run asks the gateway to play — goldens, the org's cases by name, the dataset, a settings version — and what it refuses first.

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Child } from "../src/child.js";
import type { Started } from "../src/language.js";
import { run } from "../src/test.js";
import type { EvalRun } from "../src/testing/gateway.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

const DONE: EvalRun = {
  id: "run_1",
  agent: "clinica-norte",
  started_at: 1,
  finished_at: 2,
  status: "done",
  calls: [],
  matrix: { models: ["declared"], goldens: [], metrics: [], judge_calls: 0, runs: [], failures: [] },
  error: null,
};

/** A gateway that answers every run as done and remembers what each asked to play. */
class FakeGateway {
  readonly runs: unknown[] = [];
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
    if (request.method === "POST") this.runs.push(JSON.parse(text));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(request.method === "POST" ? DONE : { runs: [DONE] }));
  }
}

const gateway = new FakeGateway();
let was: string;

beforeEach(async () => {
  gateway.runs.length = 0;
  await gateway.open();
  was = process.cwd();
});

afterEach(async () => {
  process.chdir(was);
  await gateway.close();
});

/** A project of these agents, with the framework installed, and the goldens folder only when asked. */
function aProject(agents: string[], goldens?: Record<string, unknown>): string {
  // Real, as the cwd is: on macOS the temporary directory is a link.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pinecall-test-")));
  for (const agent of agents) {
    mkdirSync(join(root, "agents", agent), { recursive: true });
    writeFileSync(join(root, "agents", agent, "agent.tsx"), "");
  }
  symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"));
  if (goldens !== undefined) {
    const folder = join(root, "test", agents[0]!, "goldens");
    mkdirSync(folder, { recursive: true });
    for (const [name, golden] of Object.entries(goldens)) writeFileSync(join(folder, `${name}.json`), JSON.stringify(golden));
  }
  process.chdir(root);
  return root;
}

/** The agent's process, already registered as app_1. */
function spawns(started: Started[] = []): (asked: Started) => Child {
  return (asked) => {
    started.push(asked);
    return {
      app: () => "app_1",
      registered: async () => "app_1",
      onEvent: () => () => undefined,
      exited: new Promise<number>(() => undefined),
      stop: async () => 0,
    };
  };
}

async function tested(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const [out, err] = [written(), written()];
  const code = await run([...argv, "--json"], { out: out.stream, err: err.stream, env: pointingAt(gateway.url, A_KEY), spawns: spawns() });
  return { code, out: out.text(), err: err.text() };
}

const RESERVA = { name: "reserva", input: ["quiero el jueves"], expect: { tools: ["book"] } };

describe("the cases a run plays", () => {
  it("plays only the cases named when no path is given, and needs no goldens folder for it", async () => {
    aProject(["clinica-norte"]);

    const { code } = await tested(["--case", "jueves-tarde", "--case", "promises-me-llaman", "--case", "jueves-tarde"]);

    expect(code).toBe(0);
    expect(gateway.runs).toEqual([{ agent: "clinica-norte", goldens: [], cases: ["jueves-tarde", "promises-me-llaman"], app: "app_1" }]);
  });

  it("plays the dataset on the version named, and still not the goldens beside it", async () => {
    aProject(["clinica-norte"], { reserva: RESERVA });

    expect((await tested(["--dataset", "--version", "4"])).code).toBe(0);

    expect(gateway.runs).toEqual([{ agent: "clinica-norte", goldens: [], dataset: true, version: 4, app: "app_1" }]);
  });

  it("plays the goldens of the paths named and the cases together", async () => {
    const root = aProject(["clinica-norte"], { reserva: RESERVA });

    expect((await tested([join(root, "test", "clinica-norte", "goldens"), "--case", "jueves-tarde"])).code).toBe(0);

    expect(gateway.runs).toEqual([{ agent: "clinica-norte", goldens: [RESERVA], cases: ["jueves-tarde"], app: "app_1" }]);
  });

  it("sends none of the three when none is asked", async () => {
    aProject(["clinica-norte"], { reserva: RESERVA });

    expect((await tested([])).code).toBe(0);

    expect(gateway.runs).toEqual([{ agent: "clinica-norte", goldens: [RESERVA], app: "app_1" }]);
  });

  it("plays each agent's dataset in a project of several, and nothing but it", async () => {
    aProject(["clinica-norte", "recepcion"]);

    expect((await tested(["--dataset"])).code).toBe(0);

    expect(gateway.runs).toEqual([
      { agent: "clinica-norte", goldens: [], dataset: true, app: "app_1" },
      { agent: "recepcion", goldens: [], dataset: true, app: "app_1" },
    ]);
  });
});

describe("what is refused before a run is asked for", () => {
  it.each([
    [["--version", "0"], "--version 0: a version of the agent's settings is a whole number from 1"],
    [["--version", "v4"], "--version v4: a version of the agent's settings is a whole number from 1"],
    [["--case", "jueves-tarde", "--watch"], "--watch runs again when a golden file changes"],
  ])("%j", async (argv, sentence) => {
    aProject(["clinica-norte"]);

    const { code, err } = await tested(argv);

    expect(code).toBe(2);
    expect(err).toContain(sentence);
    expect(gateway.runs).toEqual([]);
  });

  it("names the agents when a case or a version is asked of a project of several", async () => {
    aProject(["clinica-norte", "recepcion"]);

    const { code, err } = await tested(["--case", "jueves-tarde"]);

    expect(code).toBe(2);
    expect(err).toContain("--case and --version are for one agent: add --agent clinica-norte or --agent recepcion");
    expect(gateway.runs).toEqual([]);
  });

  it("still says where the goldens go when there are none and no case is asked", async () => {
    aProject(["clinica-norte"]);

    const { code, err } = await tested([]);

    expect(code).toBe(2);
    expect(err).toContain("no goldens at");
  });
});
