// `pinecall cases`: the inbox, one case whole, a decision, a pull into the repository, a call kept, one forgotten — each by name, at its door.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/cases.js";
import type { EvalCase } from "../src/testing/cases.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

const NOW = 1_790_010_800;

const PROMISES: EvalCase = {
  id: "case_1",
  agent: "clinica-norte",
  name: "promises-me-llaman-manana-por-29d7c7",
  golden: {
    name: "promises-me-llaman-manana-por-29d7c7",
    state: { stage: "book" },
    input: ["Me llaman mañana por lo del jueves"],
    today: "2026-09-29",
    expect: { judges: ["promises"] },
    promoted_from: "call_29d7c7",
  },
  source_call: "call_29d7c7",
  source_env: "production",
  held_out: false,
  author: "the hang-up panel",
  created_at: NOW - 3 * 3600,
  status: "pending",
  broke: [{ judge: "promises", reason: "it promised a call back nobody will make" }],
  source_version: 4,
  kept_in_repo: false,
  decided_by: null,
};

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the dataset's doors over one org's cases; it leaves out what is at its default, as the real one may. */
class FakeGateway {
  readonly heard: Heard[] = [];
  cases: EvalCase[] = [];
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
    const url = new URL(heard.path, "http://gateway");
    const id = url.pathname.split("/")[4];
    const found = this.cases.find((one) => one.id === id);
    if (heard.method === "GET") {
      const status = url.searchParams.get("status");
      const cases = this.cases.filter((one) => one.agent === url.searchParams.get("agent") && (status === null || one.status === status));
      return this.#said(response, 200, { cases: cases.map(sent), pending: this.cases.filter((one) => one.status === "pending").length, pending_at_most: 50 });
    }
    if (heard.method === "POST") {
      const body = heard.body as { call: string; name: string; held_out?: boolean };
      const kept: EvalCase = { ...PROMISES, id: "case_2", name: body.name, source_call: body.call, status: "approved", broke: [], author: "m_ana", held_out: body.held_out ?? false };
      this.cases.push(kept);
      return this.#said(response, 200, sent(kept));
    }
    if (found === undefined) return this.#said(response, 404, { detail: `no case ${id} in this key's org` });
    if (heard.method === "DELETE") {
      this.cases = this.cases.filter((one) => one !== found);
      response.writeHead(204).end();
      return;
    }
    const decision = heard.body as Partial<EvalCase>;
    Object.assign(found, decision.status === undefined ? decision : { ...decision, decided_by: "m_ana" });
    this.#said(response, 200, sent(found));
  }

  #said(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

// What response_model_exclude_unset may leave out: a field at its default.
function sent(one: EvalCase): Partial<EvalCase> {
  const { kept_in_repo, decided_by, ...rest } = one;
  return { ...rest, ...(kept_in_repo ? { kept_in_repo } : {}), ...(decided_by === null ? {} : { decided_by }) };
}

const gateway = new FakeGateway();
let was: string;
let root: string;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.cases = [structuredClone(PROMISES)];
  await gateway.open();
  was = process.cwd();
  // Real, as the cwd is: on macOS the temporary directory is a link.
  root = realpathSync(mkdtempSync(join(tmpdir(), "pinecall-cases-")));
  mkdirSync(join(root, "agents", "clinica-norte"), { recursive: true });
  writeFileSync(join(root, "agents", "clinica-norte", "agent.tsx"), "");
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(was);
  await gateway.close();
});

async function cases(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const [out, err] = [written(), written()];
  const code = await run(argv, { out: out.stream, err: err.stream, env: pointingAt(gateway.url, A_KEY), now: () => NOW });
  return { code, out: out.text(), err: err.text() };
}

describe("the inbox", () => {
  it("is how many wait, then one line a case: status, name, what broke, where it came from, its age", async () => {
    const { code, out } = await cases([]);

    expect(code).toBe(0);
    expect(out).toBe("1 waiting of at most 50\npending    promises-me-llaman-manana-por-29d7c7  promises  production  3h\n");
    expect(gateway.heard.map((one) => `${one.method} ${one.path}`)).toEqual(["GET /v1/evals/cases?agent=clinica-norte"]);
  });

  it("asks for one status when --status names it, and says so when the agent has none", async () => {
    const { out } = await cases(["list", "--status", "approved"]);

    expect(gateway.heard[0]?.path).toBe("/v1/evals/cases?agent=clinica-norte&status=approved");
    expect(out).toContain("clinica-norte has no cases here");
  });

  it("answers --json with the defaults the gateway left out written in", async () => {
    const { out } = await cases(["--json"]);

    expect(JSON.parse(out)).toEqual({ cases: [PROMISES], pending: 1, pending_at_most: 50 });
  });
});

describe("one case", () => {
  it("is shown whole, with what broke, the caller's lines, the expect, and the commands that come next", async () => {
    const { code, out } = await cases(["show", PROMISES.name]);

    expect(code).toBe(0);
    expect(out).toContain("from call_29d7c7 (production, settings v4) · kept by the hang-up panel");
    expect(out).toContain("promises  it promised a call back nobody will make");
    expect(out).toContain('"Me llaman mañana por lo del jueves"');
    expect(out).toContain('expect  {"judges":["promises"]}');
    expect(out).toContain(`pinecall test --case ${PROMISES.name}`);
    expect(out).toContain(`pinecall cases approve ${PROMISES.name}`);
  });

  it("is refused by name when the agent has none called that, with exit 1", async () => {
    const { code, err } = await cases(["show", "jueves-tarde"]);

    expect(code).toBe(1);
    expect(err).toContain("clinica-norte has no case named jueves-tarde");
  });
});

describe("what a person decides", () => {
  it.each([
    [["approve"], { status: "approved" }, "approved: the nightly plays it"],
    [["reopen"], { status: "pending" }, "pending again"],
    [["dismiss"], { status: "dismissed" }, "dismissed"],
    [["dismiss", "--judge-was-wrong", "promises", "--note", "it did call back"], { status: "dismissed", judge_was_wrong: "promises", note: "it did call back" }, "promises labelled as wrong on call_29d7c7"],
  ])("%j", async (argv, body, line) => {
    const [verb, ...flags] = argv;
    const { code, out } = await cases([verb!, PROMISES.name, ...flags]);

    expect(code).toBe(0);
    expect(gateway.heard.at(-1)).toEqual({ method: "PATCH", path: "/v1/evals/cases/case_1", body });
    expect(out).toContain(line);
  });
});

describe("a case pulled into the repository", () => {
  it("is its golden written in the agent's goldens folder, then marked as kept there", async () => {
    const { code, out } = await cases(["pull", PROMISES.name]);

    const path = join(root, "test", "clinica-norte", "goldens", `${PROMISES.name}.json`);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(PROMISES.golden);
    expect(gateway.heard.at(-1)).toEqual({ method: "PATCH", path: "/v1/evals/cases/case_1", body: { kept_in_repo: true } });
    expect(out).toBe(`${path}\n${PROMISES.name} is kept in the repository now: the nightly plays the file, not the case\n`);
  });

  it("is written where --out says", async () => {
    const folder = join(root, "elsewhere");

    expect((await cases(["pull", PROMISES.name, "--out", folder])).code).toBe(0);

    expect(JSON.parse(readFileSync(join(folder, `${PROMISES.name}.json`), "utf8"))).toEqual(PROMISES.golden);
  });
});

describe("a call kept, and a case forgotten", () => {
  it("keeps a finished call as a case under the name given, held out when asked", async () => {
    const { code, out } = await cases(["keep", "call_8f4a2c", "--name", "jueves-tarde", "--held-out"]);

    expect(code).toBe(0);
    expect(gateway.heard[0]).toEqual({ method: "POST", path: "/v1/evals/cases", body: { call: "call_8f4a2c", name: "jueves-tarde", held_out: true } });
    expect(out).toContain("jueves-tarde kept · approved · clinica-norte · from call_8f4a2c");
  });

  it("forgets a case by its id, found by its name", async () => {
    const { code, out } = await cases(["forget", PROMISES.name]);

    expect(code).toBe(0);
    expect(gateway.heard.at(-1)).toEqual({ method: "DELETE", path: "/v1/evals/cases/case_1", body: null });
    expect(out).toContain("forgotten: the call it came from, call_29d7c7, stays");
    expect(gateway.cases).toEqual([]);
  });
});

describe("what is refused before the gateway is asked", () => {
  it.each([
    [["fly"], "usage: pinecall cases"],
    [["show"], "usage: pinecall cases"],
    [["list", "--status", "waiting"], "--status waiting: pending, approved, dismissed"],
    [["show", "x", "--status", "pending"], "--status means nothing to `cases show`"],
    [["approve", "x", "--judge-was-wrong", "promises"], "--judge-was-wrong means nothing to `cases approve`"],
    [["dismiss", "x", "--note", "why"], "--note is kept on the judge's calibration label"],
    [["keep", "call_1"], "keep names the case it makes: --name x"],
  ])("%j", async (argv, sentence) => {
    const { code, err } = await cases(argv);

    expect(code).toBe(2);
    expect(err).toContain(sentence);
    expect(gateway.heard).toEqual([]);
  });
});
