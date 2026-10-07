// `pinecall docs`: the folder pushed whole under a name, the bases listed, one dropped — and
// the gateway's own refusal printed as it was said.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { theKItIsReadWith, markdownUnder, pushedLine, run, scoreLines } from "../src/docs.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

/** One request as the gateway heard it: the method, the path, and the body it was sent. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the three base doors, which knows one key and answers in the wire's shapes. */
class FakeGateway {
  readonly heard: Heard[] = [];
  bases: { base: string; chunks: number; pushed_at: number }[] = [];
  settings: unknown = { world: "sandbox", yours: null, team: null, production: null };
  score: unknown = { questions: 0, k: 8, recall_at_k: 0, ndcg_at_10: 0, model: "pplx", took_ms: 0, misses: [] };
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
    const heard: Heard = { method: request.method ?? "", path: request.url ?? "", body: text === "" ? null : JSON.parse(text) };
    this.heard.push(heard);
    if (request.headers.authorization !== `Bearer ${A_KEY}`) return this.#said(response, 401, { detail: "this door takes an API key" });
    if (this.refuse !== undefined) return this.#said(response, this.refuse.status, { detail: this.refuse.detail });
    if (heard.path.endsWith("/settings")) return this.#said(response, 200, this.settings);
    if (heard.path.includes("/eval")) return this.#said(response, 200, this.score);
    if (heard.method === "PUT") {
      const files = (heard.body as { files: unknown[] }).files;
      return this.#said(response, 200, { base: heard.path.split("/").at(-1), chunks: files.length * 3, took_ms: 812.4 });
    }
    if (heard.method === "DELETE") return this.#said(response, 204, null);
    return this.#said(response, 200, { bases: this.bases });
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
let docs = "";
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.bases = [];
  gateway.refuse = undefined;
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
  docs = mkdtempSync(join(tmpdir(), "pinecall-docs-"));
  mkdirSync(join(docs, "seguros"));
  writeFileSync(join(docs, "tarifas.md"), "# Tarifas\n\nRevisión, cuarenta euros.\n");
  writeFileSync(join(docs, "seguros", "dkv.md"), "# DKV\n\nCon autorización previa.\n");
  writeFileSync(join(docs, "notas.txt"), "no es markdown\n");
});

afterEach(async () => {
  await gateway.close();
});

describe("pushing a folder", () => {
  it("sends every *.md under the directory, by its path relative to it, and prints one line", async () => {
    const out = written();

    const code = await run(["push", docs, "--base", "clinica-norte"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard).toHaveLength(1);
    expect(gateway.heard[0]?.method).toBe("PUT");
    expect(gateway.heard[0]?.path).toBe("/v1/knowledge/clinica-norte");
    expect(gateway.heard[0]?.body).toEqual({
      files: [
        { path: "seguros/dkv.md", text: "# DKV\n\nCon autorización previa.\n" },
        { path: "tarifas.md", text: "# Tarifas\n\nRevisión, cuarenta euros.\n" },
      ],
    });
    expect(out.text()).toBe("clinica-norte · 2 files · 6 chunks · 812 ms\n");
  });

  it("reads only markdown, in a stable order", () => {
    expect(markdownUnder(docs).map((file) => file.path)).toEqual(["seguros/dkv.md", "tarifas.md"]);
  });

  it("says where it looked when the directory is not there, and sends nothing", async () => {
    const err = written();

    const code = await run(["push", join(docs, "nadie"), "--base", "x"], { err: err.stream, env });

    expect(code).toBe(2);
    expect(err.text()).toContain(`no documents directory at ${join(docs, "nadie")}`);
    expect(gateway.heard).toEqual([]);
  });

  it("prints the gateway's own sentence when it refuses, word for word", async () => {
    gateway.refuse = { status: 503, detail: "this gateway keeps no knowledge: it runs on a dev key" };
    const err = written();

    const code = await run(["push", docs, "--base", "x"], { err: err.stream, env });

    expect(code).toBe(1);
    expect(err.text()).toBe("the gateway answered 503: this gateway keeps no knowledge: it runs on a dev key\n");
  });

  it("writes the line from what the gateway answered and what was sent", () => {
    expect(pushedLine({ base: "tienda-sur", chunks: 14, took_ms: 99.6 }, 3)).toBe("tienda-sur · 3 files · 14 chunks · 100 ms");
  });
});

describe("listing and dropping", () => {
  it("prints one line per base, with when it was pushed", async () => {
    gateway.bases = [{ base: "clinica-norte", chunks: 14, pushed_at: 1_788_000_000 }];
    const out = written();

    const code = await run(["list"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "GET", path: "/v1/knowledge" });
    expect(out.text()).toBe("clinica-norte · 14 chunks · pushed 2026-08-29 10:40\n");
  });

  it("names the push verb when nothing was pushed yet", async () => {
    const out = written();

    await run(["list"], { out: out.stream, env });

    expect(out.text()).toContain("pinecall docs push sends docs/<name>/");
  });

  it("drops a base by name and says so", async () => {
    const out = written();

    const code = await run(["drop", "clinica-norte"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "DELETE", path: "/v1/knowledge/clinica-norte" });
    expect(out.text()).toBe("dropped clinica-norte\n");
  });

  it("prints the usage on a sub-verb it does not have, and knocks at no door", async () => {
    const err = written();

    const code = await run(["rm", "x"], { err: err.stream, env });

    expect(code).toBe(2);
    expect(err.text()).toContain("usage: pinecall docs push");
    expect(gateway.heard).toEqual([]);
  });
});

describe("a golden held against a base", () => {
  it("prints the two figures on one line, and the base's own embedder", () => {
    expect(
      scoreLines({
        base: "clinica-norte",
        model: "pplx-embed-context-v1-0.6b",
        questions: 3,
        k: 4,
        recall_at_k: 1,
        ndcg_at_10: 0.87,
        took_ms: 412.4,
        misses: [],
      }),
    ).toEqual(["clinica-norte · pplx-embed-context-v1-0.6b · 3 questions · recall@4 1.00 · nDCG@10 0.87 · 412 ms"]);
  });

  it("prints a line per question it missed, with what came back instead", () => {
    const lines = scoreLines({
      base: "clinica-norte",
      model: "bge-m3",
      questions: 1,
      k: 4,
      recall_at_k: 0,
      ndcg_at_10: 0,
      took_ms: 90,
      misses: [{ asks: "¿cuánto cuesta?", expects: "tarifas.md", found: ["horarios.md › Horario"] }],
    });
    expect(lines[1]).toBe("  missed: ¿cuánto cuesta? → wanted tarifas.md, got horarios.md › Horario");
  });

  it("says nothing came back when the base returned no chunk at all", () => {
    const lines = scoreLines({
      base: "b", model: "m", questions: 1, k: 4, recall_at_k: 0, ndcg_at_10: 0, took_ms: 1,
      misses: [{ asks: "x", expects: "y", found: [] }],
    });
    expect(lines[1]).toContain("got nothing");
  });
});

// A golden asks what a TURN gets, so it asks with the k this agent reads that base with. The
// gateway's own default is eight, and a base attached with `--k 4` was being measured at eight:
// `recall@8 0.92` printed for calls that were running at `recall@4 0.75` (production, 2026-09-20).
describe("the k a golden is asked with", () => {
  const attached = (bases: { base: string; k?: number }[]): unknown => ({
    world: "sandbox",
    yours: { version: 1, config: { bases } },
    team: null,
    production: null,
  });

  it("is the one the agent's own corner attached the base with", () => {
    expect(theKItIsReadWith(attached([{ base: "clinica-norte", k: 4 }]) as never, "clinica-norte")).toBe(4);
  });

  it("falls back to the team's corner when this key set none of its own", () => {
    const standing = { world: "sandbox", yours: null, team: { version: 3, config: { bases: [{ base: "clinica", k: 6 }] } }, production: null };
    expect(theKItIsReadWith(standing as never, "clinica")).toBe(6);
  });

  it("is nobody's when the base is not attached, so the door answers with its own default", () => {
    expect(theKItIsReadWith(attached([{ base: "otra", k: 4 }]) as never, "clinica-norte")).toBeUndefined();
    expect(theKItIsReadWith(null, "clinica-norte")).toBeUndefined();
  });

  it("is nobody's when the attachment named none, which is the door's default too", () => {
    expect(theKItIsReadWith(attached([{ base: "clinica-norte" }]) as never, "clinica-norte")).toBeUndefined();
  });
});

// The path a project actually takes: `pinecall docs eval` in an agent's own directory walks the
// project, loads the class and hands the base along — and it used to hand `file` and `base` both,
// which is how the k lookup above was skipped in the only shape that happens. It asked at the
// door's default of eight while the agent read its base with four (2026-09-20).
describe("eval in a project, where the class is on disk", () => {
  const CLINIC = fileURLToPath(new URL("./clinic", import.meta.url));
  let was: string;

  beforeEach(() => {
    was = process.cwd();
    process.chdir(CLINIC);
    gateway.settings = {
      world: "sandbox",
      yours: null,
      team: { version: 2, config: { bases: [{ base: "clinica-norte", k: 4 }] } },
      production: null,
    };
    gateway.score = { questions: 1, k: 4, recall_at_k: 1, ndcg_at_10: 1, model: "pplx", took_ms: 12, misses: [] };
  });

  afterEach(() => process.chdir(was));

  it("asks the golden with the k the agent's own corner attached the base with", async () => {
    expect(await run(["eval"], { out: written().stream, err: written().stream, env })).toBe(0);

    const asked = gateway.heard.find((heard) => heard.path.includes("/eval"));
    expect((asked?.body as { k?: number }).k).toBe(4);
  });
});
