// `pinecall memory`: a contact's history, current facts first and the superseded ones dimmed with
// their date; and forget, which asks once and prints how many facts went.

import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factLine, recallLines, run, SAY_YES } from "../src/memory.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";
const ANA = "+34600000001";

const CURRENT = { id: "f1", text: "prefiere que le llamen Ana", category: "preferencia", source: "CA_1", valid_from: 1_788_000_000, invalidated_at: null };
const GONE = { id: "f0", text: "prefiere que le llamen señora García", category: "preferencia", source: "CA_0", valid_from: 1_787_000_000, invalidated_at: 1_788_000_000 };

/** A gateway with the contact's memory doors — the history, the forget, and the golden. */
class FakeGateway {
  readonly heard: { method: string; path: string; body: unknown }[] = [];
  facts: unknown[] = [];
  score: unknown;
  settings: unknown = { world: "sandbox", yours: null, team: null, production: null };
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
    response.writeHead(200, { "content-type": "application/json" });
    // The settings door, for the one verb here that writes a corner of them: the policy.
    if ((request.url ?? "").endsWith("/settings")) {
      response.end(JSON.stringify(this.settings));
      return;
    }
    if (request.method === "POST") {
      response.end(JSON.stringify(this.score));
      return;
    }
    if (request.method === "DELETE") {
      response.end(JSON.stringify({ forgotten: this.facts.length }));
      return;
    }
    response.end(JSON.stringify({ facts: this.facts }));
  }
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.facts = [];
  gateway.settings = { world: "sandbox", yours: null, team: null, production: null };
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

describe("a contact's history", () => {
  it("prints every fact, the current ones as they are and the superseded ones with their date", async () => {
    gateway.facts = [CURRENT, GONE];
    const out = written();

    const code = await run([ANA], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard[0]).toEqual({ method: "GET", path: `/v1/contacts/${encodeURIComponent(ANA)}/memory`, body: null });
    expect(out.text()).toBe(
      "- prefiere que le llamen Ana (preferencia)\n" +
        "- prefiere que le llamen señora García (preferencia) · until 2026-08-29 10:40\n",
    );
  });

  it("dims a superseded fact only on a terminal", () => {
    expect(factLine(GONE, true)).toBe("\u001b[2m- prefiere que le llamen señora García (preferencia) · until 2026-08-29 10:40\u001b[0m");
    expect(factLine({ ...CURRENT, category: null }, true)).toBe("- prefiere que le llamen Ana");
  });

  it("says so when nothing was kept", async () => {
    const out = written();

    await run([ANA], { out: out.stream, env });

    expect(out.text()).toBe(`nothing remembered about ${ANA}\n`);
  });

  it("prints the usage with no contact, and knocks at no door", async () => {
    const err = written();

    const code = await run([], { err: err.stream, env });

    expect(code).toBe(2);
    expect(err.text()).toContain("usage: pinecall memory <contact>");
    expect(gateway.heard).toEqual([]);
  });
});

describe("forgetting a contact", () => {
  it("asks once, then deletes and prints how many facts went", async () => {
    gateway.facts = [CURRENT, GONE];
    const out = written();
    const asked: string[] = [];

    const code = await run(["forget", ANA], {
      out: out.stream,
      env,
      confirm: async (question) => {
        asked.push(question);
        return true;
      },
    });

    expect(code).toBe(0);
    expect(asked).toEqual([`forget everything memory kept about ${ANA}? [y/N] `]);
    expect(gateway.heard).toEqual([{ method: "DELETE", path: `/v1/contacts/${encodeURIComponent(ANA)}/memory`, body: null }]);
    expect(out.text()).toBe("forgotten: 2\n");
  });

  it("erases on --yes without asking, as a script must", async () => {
    gateway.facts = [CURRENT, GONE];
    const out = written();
    const asked: string[] = [];

    const code = await run(["forget", ANA, "--yes"], { out: out.stream, env, confirm: async (question) => (asked.push(question), false) });

    expect(code).toBe(0);
    expect(asked).toEqual([]);
    expect(out.text()).toBe("forgotten: 2\n");
  });

  it("erases nothing with nobody at a terminal and no --yes, and says what to add", async () => {
    const err = written();
    const tty = process.stdin.isTTY;
    process.stdin.isTTY = false;
    try {
      const code = await run(["forget", ANA], { err: err.stream, env });

      expect(code).toBe(2);
      expect(err.text()).toBe(`${SAY_YES(ANA)}\n`);
      expect(gateway.heard).toEqual([]);
    } finally {
      process.stdin.isTTY = tty;
    }
  });

  it("deletes nothing when the answer is no", async () => {
    const out = written();

    const code = await run(["forget", ANA], { out: out.stream, env, confirm: async () => false });

    expect(code).toBe(0);
    expect(gateway.heard).toEqual([]);
    expect(out.text()).toBe("nothing forgotten\n");
  });
});

describe("a golden held against recall", () => {
  const A_QUESTION = {
    holds: ["Prefiere mañanas", "Alérgica a la penicilina"],
    asks: "¿le va bien el martes?",
    expects: ["Prefiere mañanas"],
  };

  function aGolden(): string {
    const path = join(mkdtempSync(join(tmpdir(), "pinecall-golden-")), "golden.json");
    writeFileSync(path, JSON.stringify([A_QUESTION]));
    return path;
  }

  it("sends the whole golden to the one door and prints the two figures", async () => {
    gateway.score = { model: "bge-m3", questions: 1, k: 6, recall_at_k: 1, ndcg_at_10: 1, took_ms: 612.4, misses: [] };
    const out = written();

    const code = await run(["eval", aGolden(), "--k", "6"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard[0]).toEqual({ method: "POST", path: "/v1/contacts/memory/eval", body: { questions: [A_QUESTION], k: 6 } });
    expect(out.text()).toBe("memory · bge-m3 · 1 questions · recall@6 1.00 · nDCG@10 1.00 · 612 ms\n");
  });

  it("exits 1 on a question memory did not answer whole, so a golden belongs in CI", async () => {
    gateway.score = {
      model: "bge-m3", questions: 1, k: 1, recall_at_k: 0, ndcg_at_10: 0, took_ms: 90,
      misses: [{ asks: "¿le va bien el martes?", missing: ["Prefiere mañanas"], found: ["Alérgica a la penicilina"] }],
    };
    const out = written();

    const code = await run(["eval", aGolden(), "--k", "1"], { out: out.stream, env });

    expect(code).toBe(1);
    expect(out.text()).toContain("missed: ¿le va bien el martes? → wanted Prefiere mañanas, got Alérgica a la penicilina");
  });

  it("says where it looked when there is no golden there, and knocks at no door", async () => {
    const err = written();

    const code = await run(["eval", "/nope/golden.json"], { err: err.stream, env });

    expect(code).toBe(2);
    expect(err.text()).toContain("no golden at /nope/golden.json: a JSON list of {holds, asks, expects}");
    expect(gateway.heard).toEqual([]);
  });

  it("names every fact a question wanted and did not get", () => {
    const lines = recallLines({
      model: "m", questions: 1, k: 6, recall_at_k: 0.5, ndcg_at_10: 0.61, took_ms: 1,
      misses: [{ asks: "x", missing: ["uno", "dos"], found: [] }],
    });
    expect(lines[0]).toBe("memory · m · 1 questions · recall@6 0.50 · nDCG@10 0.61 · 1 ms");
    expect(lines[1]).toBe("  missed: x → wanted uno, dos, got nothing");
  });
});

// One `memory policy` took the voice, the stt, the llm, the greeting, the hangup and the attached
// base out of a corner, in one version (a real corner on the box, 2026-09-20). The policy is ONE
// field of the settings, and the whole set travels with a write: a body built on an empty row
// erases every field it does not carry. `agent set` learned this on 2026-09-19; the corner a
// write lands on is not always the one this key holds — a server's token, a CI key and a person
// acting in production all hold none, and the gateway writes the org's own.
describe("the policy is one field of a corner", () => {
  const THE_TEAMS = {
    world: "sandbox",
    yours: null,
    team: { version: 7, config: { voice: "carolina", llm: "anthropic/claude-haiku-4-5", bases: [{ base: "clinica-norte", k: 4 }] } },
    production: null,
  };

  it("keeps every other field when the key holds no corner of its own", async () => {
    gateway.settings = THE_TEAMS;

    await run(["policy", "--agent", "clinica-norte", "--remember", "what they want cleaned"], { out: written().stream, err: written().stream, env });

    const wrote = gateway.heard.find((heard) => heard.method === "PUT");
    const config = (wrote?.body as { config: Record<string, unknown> }).config;
    expect(config["voice"]).toBe("carolina");
    expect(config["llm"]).toBe("anthropic/claude-haiku-4-5");
    expect(config["bases"]).toEqual([{ base: "clinica-norte", k: 4 }]);
    expect(config["memory"]).toEqual({ remember: ["what they want cleaned"], forget: [] });
    expect((wrote?.body as { if_version: number }).if_version).toBe(7);
  });
});
