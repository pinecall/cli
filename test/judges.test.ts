// `pinecall judges`: the library switched, own judges written whole, a try, the refusals before any request, `--json`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/judges.js";
import type { JudgeRow, JudgeTried } from "@pinecall/agents/wire";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

/** A project with one agent, `clinica-norte`. */
const CLINIC = fileURLToPath(new URL("./clinic", import.meta.url));

/** A project whose agent is called `sales` and whose class is called `bidfire-sales`. */
const BIDFIRE = fileURLToPath(new URL("./bidfire", import.meta.url));

const CONSENT: JudgeRow = {
  name: "consent",
  owner: "pinecall",
  on: true,
  question: "Did every irreversible tool run after the caller agreed?",
  answer: "verdict",
  choices: [],
  when: "always",
  trigger: "",
  reads: ["facts"],
  summary: "Every irreversible tool ran only after the caller agreed to that action.",
  version: 1,
};

const SLOT: JudgeRow = {
  name: "offers-next-slot",
  owner: "clinica-norte",
  on: true,
  question: "The agent offered the next free slot.",
  answer: "verdict",
  choices: [],
  when: "always",
  trigger: "",
  reads: [],
  author: "m_ana",
  set_at: 1758300000,
};

const TRIED: JudgeTried = {
  rows: [
    { call: "CA_one", judgment: { name: SLOT.name, verdict: "held", criteria: SLOT.question, reason: "Offered Thursday.", evidence: { seqs: [14] } } },
    { call: "CA_two", judgment: { name: SLOT.name, verdict: "na", criteria: SLOT.question, reason: "Only the address.", evidence: { seqs: [] } } },
    { call: "CA_three", judgment: null, not_judged: "the call has not finished" },
  ],
  evals: 1,
  cost_usd: 0.0021,
};

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the judge doors: the library first, then the judges written, and a try. */
class FakeGateway {
  readonly heard: Heard[] = [];
  judges: JudgeRow[] = [];
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
    if (heard.path.endsWith("/try")) return this.#said(response, 200, TRIED);
    const name = decodeURIComponent(heard.path.split("/").at(-1) ?? "");
    const body = heard.body as Partial<JudgeRow> | null;
    if (heard.method === "PUT" && name === CONSENT.name) {
      if (body?.question !== undefined) return this.#said(response, 409, { detail: "consent is one of Pinecall's judges: only whether it runs is written" });
      this.judges = this.judges.map((judge) => (judge.name === name ? { ...judge, on: body?.on === true } : judge));
    } else if (heard.method === "PUT") {
      if (body?.on !== undefined) return this.#said(response, 409, { detail: `${name} is a judge of your own: it runs while it is written, and DELETE stops it` });
      this.judges = [...this.judges.filter((judge) => judge.name !== name), { ...SLOT, ...body, name }];
    }
    if (heard.method === "DELETE") {
      if (name === CONSENT.name) return this.#said(response, 409, { detail: "consent is one of Pinecall's judges and is never deleted" });
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
  gateway.judges = [CONSENT];
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

    expect(await run(["add", "never-medical-advice", "--org", "--asks", "No medical advice."], { out: written().stream, env })).toBe(0);
    expect(await run(["off", "consent", "--org"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard.map((one) => `${one.method} ${one.path}`)).toEqual([
      "PUT /v1/org/judges/never-medical-advice",
      "PUT /v1/org/judges/consent",
    ]);
  });

  it("refuses --org beside --agent before asking anything, since they name two lists", async () => {
    const err = written();

    expect(await run(["list", "--org", "--agent", "clinica-norte"], { err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("--org and --agent name two lists");
    expect(gateway.heard).toEqual([]);
  });
});

describe("the list", () => {
  it("prints Pinecall's with its summary and yours with its question, whose each is and whether it runs", async () => {
    gateway.judges = [{ ...CONSENT, on: false }, { ...SLOT, answer: "choice", choices: ["offered", "asked"], when: "trigger", trigger: "A slot was discussed." }];
    const out = written();

    expect(await run([], { out: out.stream, env })).toBe(0);
    expect(out.text().split("\n")).toEqual([
      `consent           pinecall       off  verdict                always        ${CONSENT.summary}`,
      `offers-next-slot  clinica-norte  on   choice: offered|asked  on a trigger  ${SLOT.question}`,
      "",
    ]);
  });

  it("says the agent has none yet rather than printing an empty page", async () => {
    gateway.judges = [];
    const out = written();

    expect(await run([], { out: out.stream, env })).toBe(0);
    expect(out.text()).toContain("clinica-norte has no judges yet");
  });

  it("answers --json with the judges as the gateway sent them", async () => {
    const out = written();

    expect(await run(["list", "--json"], { out: out.stream, env })).toBe(0);
    expect(JSON.parse(out.text())).toEqual({ judges: [CONSENT] });
  });
});

describe("writing one of your own", () => {
  it("writes a verdict on every call unless told otherwise", async () => {
    const out = written();

    expect(await run(["add", "offers-next-slot", "--asks", SLOT.question], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("offers-next-slot written · 2 judge(s)\n");
    expect(gateway.heard[0]).toEqual({
      method: "PUT",
      path: "/v1/agents/clinica-norte/judges/offers-next-slot",
      body: { question: SLOT.question, answer: "verdict", when: "always" },
    });
  });

  it("writes a choice on a trigger that reads the prompt and the facts", async () => {
    const argv = ["add", "call-reason", "--asks", "Why did they call?", "--answer", "choice:book, cancel,question", "--when", "trigger:A booking was asked for.", "--reads", "prompt,facts"];

    expect(await run(argv, { out: written().stream, env })).toBe(0);
    expect(gateway.heard[0]?.body).toEqual({
      question: "Why did they call?",
      answer: "choice",
      choices: ["book", "cancel", "question"],
      when: "trigger",
      trigger: "A booking was asked for.",
      reads: ["prompt", "facts"],
    });
  });

  it("writes a score on simulations only", async () => {
    expect(await run(["add", "warmth", "--asks", "How warm was it?", "--answer", "score", "--when", "simulations"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard[0]?.body).toEqual({ question: "How warm was it?", answer: "score", when: "simulations" });
  });

  it("says a name of Pinecall's is switched, not written", async () => {
    const err = written();

    expect(await run(["add", "consent", "--asks", "q"], { out: written().stream, err: err.stream, env })).toBe(1);
    expect(err.text()).toContain("pinecall judges on|off consent");
  });
});

describe("switching and dropping", () => {
  it("turns one of Pinecall's off with nothing but on: false", async () => {
    const out = written();

    expect(await run(["off", "consent"], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("consent off · 1 judge(s)\n");
    expect(gateway.heard[0]).toEqual({ method: "PUT", path: "/v1/agents/clinica-norte/judges/consent", body: { on: false } });
  });

  it("says one of your own is dropped, not switched", async () => {
    const err = written();

    expect(await run(["on", "offers-next-slot"], { out: written().stream, err: err.stream, env })).toBe(1);
    expect(err.text()).toContain("pinecall judges rm offers-next-slot");
  });

  it("drops one of your own, and says the gateway's sentence for a name nobody wrote", async () => {
    gateway.judges = [CONSENT, SLOT];
    const out = written();
    const err = written();

    expect(await run(["rm", "offers-next-slot"], { out: out.stream, env })).toBe(0);
    expect(out.text()).toBe("offers-next-slot dropped · 1 judge(s)\n");
    expect(await run(["rm", "offers-next-slot"], { out: written().stream, err: err.stream, env })).toBe(1);
    expect(err.text()).toContain("clinica-norte has no judge called offers-next-slot");
  });

  it("says Pinecall's are switched off, never dropped", async () => {
    const err = written();

    expect(await run(["rm", "consent"], { out: written().stream, err: err.stream, env })).toBe(1);
    expect(err.text()).toContain("pinecall judges off consent turns it off");
  });
});

describe("trying one", () => {
  it("asks a written one of the agent's last calls by its name, and prints each call's answer", async () => {
    const out = written();

    expect(await run(["try", "offers-next-slot", "--last", "3"], { out: out.stream, env })).toBe(0);
    expect(gateway.heard[0]).toEqual({ method: "POST", path: "/v1/agents/clinica-norte/judges/try", body: { name: "offers-next-slot", last: 3 } });
    expect(out.text().split("\n")).toEqual([
      "CA_one    ✓ held  Offered Thursday.  [seq 14]",
      "CA_two    – n/a  Only the address.",
      "CA_three  · not judged: the call has not finished",
      "1 eval · $0.0021 · nothing was written",
      "",
    ]);
  });

  it("sends one not yet saved whole, on the calls named", async () => {
    expect(await run(["try", "warmth", "--asks", "How warm?", "--answer", "score", "--calls", "CA_one,CA_two"], { out: written().stream, env })).toBe(0);

    expect(gateway.heard[0]?.body).toEqual({ name: "warmth", question: "How warm?", answer: "score", when: "always", calls: ["CA_one", "CA_two"] });
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
    [["add", "x", "--asks", "q", "--answer", "choice:one"], "two choices at least"],
    [["add", "x", "--asks", "q", "--answer", "maybe"], "--answer maybe"],
    [["add", "x", "--asks", "q", "--when", "sometimes"], "--when sometimes"],
    [["add", "x", "--asks", "q", "--when", "trigger:"], "--when trigger:"],
    [["add", "x", "--asks", "q", "--reads", "prompt,mood"], "--reads mood"],
    [["try", "x"], "try needs the calls"],
    [["try", "x", "--last", "3", "--calls", "CA_one"], "try needs the calls"],
    [["try", "x", "--last", "51"], "--last 51 is not 1 to 50 calls"],
    [["try", "x", "--last", "3", "--org"], "try asks one agent's calls"],
  ])("%j", async (argv, sentence) => {
    const err = written();

    expect(await run(argv, { out: written().stream, err: err.stream, env })).toBe(2);
    expect(err.text()).toContain(sentence);
    expect(gateway.heard).toEqual([]);
  });
});
