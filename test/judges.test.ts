// `pinecall judges`: the org's judges and the agent's own at their doors, the refusals before any request, `--json`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/judges.js";
import type { Judge } from "@pinecall/agents/wire";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

/** A project with one agent, `clinica-norte`. */
const CLINIC = fileURLToPath(new URL("./clinic", import.meta.url));

/** A project whose agent is called `sales` and whose class is called `bidfire-sales`. */
const BIDFIRE = fileURLToPath(new URL("./bidfire", import.meta.url));

const SLOT: Judge = { name: "offers-next-slot", question: "The agent offered the next free slot.", runs_on: "every-call", author: "m_ana", set_at: 1758300000 };

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the three judge doors and one list per agent. */
class FakeGateway {
  readonly heard: Heard[] = [];
  judges: Judge[] = [];
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
    const name = decodeURIComponent(heard.path.split("/").at(-1) ?? "");
    if (heard.method === "PUT") {
      const body = heard.body as { question: string; runs_on: Judge["runs_on"] };
      this.judges = [...this.judges.filter((judge) => judge.name !== name), { ...SLOT, ...body, name }];
    }
    if (heard.method === "DELETE") {
      if (!this.judges.some((judge) => judge.name === name)) return this.#said(response, 404, { detail: `clinica-norte has no judge called ${name}` });
      this.judges = this.judges.filter((judge) => judge.name !== name);
    }
    this.#said(response, 200, { judges: this.judges });
  }

  #said(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;
let was: string;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.judges = [];
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
  was = process.cwd();
  process.chdir(CLINIC);
});

afterEach(async () => {
  process.chdir(was);
  await gateway.close();
});

describe("whose judges", () => {
  it("asks the door of the project's one agent", async () => {
    expect(await run(["list"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard.map((one) => `${one.method} ${one.path}`)).toEqual(["GET /v1/agents/clinica-norte/judges"]);
  });

  it("asks the door of the agent --agent names, by its folder's name, whatever the class is called", async () => {
    process.chdir(BIDFIRE);

    expect(await run(["list", "--agent", "sales"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard.map((one) => one.path)).toEqual(["/v1/agents/sales/judges"]);
  });

  it("asks the org's door with --org, from anywhere and with no class in sight", async () => {
    process.chdir(was);
    const out = written();

    expect(await run(["add", "never-medical-advice", "--org", "--asks", "No medical advice."], { out: out.stream, env })).toBe(0);
    expect(await run(["list", "--org"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard.map((one) => `${one.method} ${one.path}`)).toEqual([
      "PUT /v1/org/judges/never-medical-advice",
      "GET /v1/org/judges",
    ]);
  });

  it("refuses --org beside --agent before asking anything, since they name two lists", async () => {
    const err = written();

    expect(await run(["list", "--org", "--agent", "clinica-norte"], { err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("--org and --agent name two lists");
    expect(gateway.heard).toEqual([]);
  });
});

describe("the verbs it answers to", () => {
  it("says the agent has none yet rather than printing an empty page", async () => {
    const out = written();

    expect(await run([], { out: out.stream, env })).toBe(0);
    expect(out.text()).toContain("clinica-norte has no judges yet");
  });

  it("writes one on every call unless told otherwise, and lists it with its question", async () => {
    const out = written();

    expect(await run(["add", "offers-next-slot", "--asks", SLOT.question], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("offers-next-slot written · 1 judge(s)\n");
    expect(gateway.heard[0]).toEqual({ method: "PUT", path: "/v1/agents/clinica-norte/judges/offers-next-slot", body: { question: SLOT.question, runs_on: "every-call" } });

    const listed = written();
    expect(await run(["list"], { out: listed.stream, env })).toBe(0);
    expect(listed.text()).toBe(`offers-next-slot  every call   ${SLOT.question}\n`);
  });

  it("writes one that reads only simulations when --on says so", async () => {
    expect(await run(["add", "names-the-doctor", "--asks", "Named the doctor.", "--on", "simulations"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard[0]?.body).toEqual({ question: "Named the doctor.", runs_on: "simulations" });
  });

  it("drops one, and says the gateway's sentence for a name nobody wrote", async () => {
    gateway.judges = [SLOT];
    const out = written();
    const err = written();

    expect(await run(["rm", "offers-next-slot"], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("offers-next-slot dropped · 0 judge(s)\n");
    expect(await run(["rm", "offers-next-slot"], { out: written().stream, err: err.stream, env })).toBe(1);
    expect(err.text()).toContain("clinica-norte has no judge called offers-next-slot");
  });

  it("answers --json with the agent's judges as the gateway sent them", async () => {
    gateway.judges = [SLOT];
    const out = written();

    expect(await run(["list", "--json"], { out: out.stream, env })).toBe(0);
    expect(JSON.parse(out.text())).toEqual({ judges: [SLOT] });
  });
});

describe("what is refused before the gateway is asked", () => {
  it.each([
    [["fly"], "usage: pinecall judges"],
    [["add"], "usage: pinecall judges"],
    [["rm"], "usage: pinecall judges"],
    [["add", "Offers_Slot", "--asks", "q"], "is no name for a judge"],
    [["add", "offers-next-slot"], "a judge needs --asks"],
    [["add", "offers-next-slot", "--asks", "  "], "a judge needs --asks"],
    [["add", "offers-next-slot", "--asks", "q", "--on", "sometimes"], "--on sometimes: every-call or simulations"],
  ])("%j", async (argv, sentence) => {
    const err = written();

    expect(await run(argv, { out: written().stream, err: err.stream, env })).toBe(2);
    expect(err.text()).toContain(sentence);
    expect(gateway.heard).toEqual([]);
  });
});
