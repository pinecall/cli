// `pinecall remember`: cases read from disk, the door it calls, and its output.

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ExtractionGolden, type ExtractionRun } from "@pinecall/agents/wire";

import { CASES, linesOf, NO_CASES, run } from "../src/remember.js";
import { extracted } from "../src/testing/gateway.js";
import type { Child } from "../src/child.js";
import type { Started } from "../src/language.js";
import { pointingAt } from "./home.js";
import { casesIn } from "../src/testing/goldens.js";
import { onStderr } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

const ANSWERED: ExtractionRun = {
  agent: "clinica-norte",
  model: "anthropic/claude-haiku-4-5",
  cases: 2,
  held: 1,
  took_ms: 4210.4,
  results: [
    { name: "anota la alergia", held: true, wrote: ["add · alergias · Es alérgica a la penicilina"], refused: [], broke: [] },
    {
      name: "la mañana sustituye a la tarde",
      held: false,
      wrote: ["add · cómo prefiere que le llamen · Prefiere la mañana"],
      refused: ["add · pagos · Paga con Visa"],
      broke: [{ check: "invalidates", detail: "'Prefiere la tarde' still holds beside what the call said" }],
    },
  ],
};

const A_CASE: ExtractionGolden = {
  name: "anota la alergia",
  said: [["caller", "Soy Marta, alérgica a la penicilina"]],
  expect: { writes: ["alergias"] },
};

/** A gateway with the extraction door, one known key, and the door's response shape. */
class FakeGateway {
  readonly heard: { path: string; body: unknown }[] = [];
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
    this.heard.push({ path: request.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    response.writeHead(request.headers.authorization === `Bearer ${A_KEY}` ? 200 : 401, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(ANSWERED));
  }
}

const gateway = new FakeGateway();

beforeEach(async () => await gateway.open());
afterEach(async () => await gateway.close());

describe("the door the verb knocks at", () => {
  it("posts every case whole to the agent's own extraction door", async () => {
    const answer = await extracted({ url: gateway.url, apiKey: A_KEY, world: "sandbox" }, "clinica-norte", [A_CASE]);

    expect(answer.agent).toBe("clinica-norte");
    expect(gateway.heard[0]?.path).toBe("/v1/agents/clinica-norte/memory/extraction");
    expect(gateway.heard[0]?.body).toEqual({ cases: [A_CASE] });
  });
});

describe("the cases a run reads off the disk", () => {
  it("names a case after its own file when the file did not name it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pinecall-remember-"));
    writeFileSync(join(directory, "anota-la-alergia.json"), JSON.stringify({ said: A_CASE.said }));

    const [read] = await casesIn<ExtractionGolden>([directory], CASES);

    expect(read?.name).toBe("anota-la-alergia");
  });
});

describe("what a person reads", () => {
  // A passing case is one line so large suites fit on screen; a failing one shows what broke, what
  // memory would have kept, and what admission refused.
  it("is one line per case, and the evidence under the ones that broke", () => {
    expect(linesOf(ANSWERED)).toEqual([
      "clinica-norte · anthropic/claude-haiku-4-5 · 2 cases · 1 held · 4210 ms",
      "  ✓ anota la alergia",
      "  ✗ la mañana sustituye a la tarde",
      "      invalidates  'Prefiere la tarde' still holds beside what the call said",
      "      kept      add · cómo prefiere que le llamen · Prefiere la mañana",
      "      refused   add · pagos · Paga con Visa",
    ]);
  });
});

describe("what remember needs before it can ask", () => {
  it("names the directory a case belongs in when there is none and nobody said a path", async () => {
    const said = onStderr();
    const previous = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "pinecall-empty-")));

    const code = await run([], { env: pointingAt(gateway.url, A_KEY) });

    process.chdir(previous);
    said.restore();
    expect(code).toBe(2);
    expect(said.text()).toContain(NO_CASES);
  });
});

describe("the agent the extraction reads", () => {
  // The gateway reads the agent's categories off its declaration, so the agent is held for the run.
  it("is served by a console's process for as long as the run takes, then stopped", async () => {
    // Real, as the cwd is: on macOS the temporary directory is a link.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pinecall-remember-")));
    const folder = join(root, "test", "clinica-norte", "memory");
    mkdirSync(folder, { recursive: true });
    mkdirSync(join(root, "agents", "clinica-norte"), { recursive: true });
    writeFileSync(join(root, "agents", "clinica-norte", "agent.tsx"), "");
    // A project that installs the framework, as the one serving the agent must: this repository's.
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"));
    writeFileSync(join(folder, "alergia.json"), JSON.stringify(A_CASE));
    const started: Started[] = [];
    let stopped = 0;
    const child: Child = {
      app: () => "app_1",
      registered: async () => "app_1",
      onEvent: () => () => undefined,
      exited: new Promise<number>(() => undefined),
      stop: async () => ((stopped += 1), 0),
    };
    const previous = process.cwd();
    process.chdir(root);

    const code = await run(["--json"], { env: pointingAt(gateway.url, A_KEY), out: writtenNowhere(), spawns: (asked) => (started.push(asked), child) });

    process.chdir(previous);
    expect(code).toBe(1);
    expect(started[0]?.command.slice(-6)).toEqual(["--file", join(root, "agents", "clinica-norte", "agent.tsx"), "--slug", "clinica-norte", "--console", "--events"]);
    expect(gateway.heard[0]?.path).toBe("/v1/agents/clinica-norte/memory/extraction");
    expect(stopped).toBe(1);
  });
});

function writtenNowhere(): NodeJS.WritableStream {
  return { write: () => true } as unknown as NodeJS.WritableStream;
}
