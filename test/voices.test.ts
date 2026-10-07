// `pinecall voices`: one voice per line with the id first, filtered by country; and a sample
// played from a file with the vendor's timings.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aDuration, run, type Played } from "../src/voices.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";
const MARTA = "de38f545-c574-44e8-9b54-a7d6fec1c6b1";
const A_WAV = Buffer.from("RIFF....WAVEfmt ");

const VOICES = [
  { id: MARTA, name: "Marta - Friendly Guide", language: "es", gender: "feminine", country: "ES", accent: "castilian", description: "" },
  { id: "2fc4f1ec", name: "Mateo - Friendly Host", language: "es", gender: "masculine", country: "MX", accent: "", description: "" },
];

const A_CATALOGUE = {
  providers: [
    { name: "cartesia", voices_listed: true },
    { name: "rime", voices_listed: false },
    { name: "elevenlabs", voices_listed: true },
  ],
  defaults: { llm: "anthropic", stt: "deepgram", tts: "cartesia" },
};

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** The list and sample doors; the sample is a WAV with or without Server-Timing. */
class FakeGateway {
  readonly heard: Heard[] = [];
  refuse: { status: number; detail: string } | undefined;
  /** The GET /v1/voices response; the default list unless a test overrides it. */
  listed: unknown = { tts: "cartesia", language: "es", voices: VOICES };
  timing: string | null = "first-audio;dur=210, total;dur=900";
  /** GET /v1/providers: the box's voice, and which vendors list theirs. */
  catalogue: unknown = A_CATALOGUE;
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
    this.heard.push({ method: request.method ?? "", path: request.url ?? "", body: text === "" ? null : (JSON.parse(text) as unknown) });
    if (request.headers.authorization !== `Bearer ${A_KEY}`) return this.#said(response, 401, { detail: "this door takes an API key" });
    if (this.refuse !== undefined) return this.#said(response, this.refuse.status, { detail: this.refuse.detail });
    if (request.method === "POST") {
      response.writeHead(200, { "content-type": "audio/wav", ...(this.timing === null ? {} : { "server-timing": this.timing }) });
      response.end(A_WAV);
      return;
    }
    this.#said(response, 200, request.url === "/v1/providers" ? this.catalogue : this.listed);
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
  gateway.refuse = undefined;
  gateway.listed = { tts: "cartesia", language: "es", voices: VOICES };
  gateway.timing = "first-audio;dur=210, total;dur=900";
  gateway.catalogue = A_CATALOGUE;
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

/** A player that records the file it was given and reports it played. */
function aPlayer(files: string[]): (file: string) => Played {
  return (file) => {
    files.push(file);
    return { player: "afplay" };
  };
}

describe("listing", () => {
  it("asks the box's own voice when no vendor is named, and prints the id first in aligned columns", async () => {
    const out = written();

    const code = await run(["--language", "es"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(gateway.heard.map((one) => one.path)).toEqual(["/v1/providers", "/v1/voices?tts=cartesia&language=es"]);
    const lines = out.text().trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.startsWith(`${MARTA}  Marta - Friendly Guide  feminine   ES castilian`)).toBe(true);
    expect(lines[1]!.indexOf("Mateo")).toBe(lines[0]!.indexOf("Marta"));
  });

  it("asks no list of a vendor whose plugin lists none, and names the vendors that do", async () => {
    const err = written();

    const code = await run(["--tts", "rime"], { err: err.stream, env });

    expect(code).toBe(1);
    expect(err.text()).toBe(
      "rime lists no voices: its voice is the vendor's own id, set as it is — these list theirs: cartesia, elevenlabs (--tts <vendor>)\n",
    );
    expect(gateway.heard.map((one) => one.path)).toEqual(["/v1/providers"]);
  });

  it("says so when the box's own voice is one that lists none", async () => {
    gateway.catalogue = { ...A_CATALOGUE, defaults: { tts: "rime" } };
    const err = written();

    const code = await run([], { err: err.stream, env });

    expect(code).toBe(1);
    expect(err.text()).toContain("rime lists no voices");
  });

  it("keeps only the voices from one country, whatever case it was typed in", async () => {
    const out = written();

    await run(["--country", "es"], { out: out.stream, env });

    expect(out.text()).toContain("Marta");
    expect(out.text()).not.toContain("Mateo");
  });

  it("says so when no voice matches", async () => {
    const out = written();

    const code = await run(["--country", "UY"], { out: out.stream, env });

    expect(code).toBe(0);
    expect(out.text()).toBe("no voice matches: try another --language or --country\n");
  });

  it("refuses a 200 that is not the list, in the wire's words", async () => {
    gateway.listed = { voices: "not a list" };
    const err = written();

    const code = await run([], { err: err.stream, env });

    expect(code).toBe(1);
    expect(err.text()).toContain("voices");
  });

  it("says the gateway's own refusal", async () => {
    gateway.refuse = { status: 503, detail: "cartesia has no API key in this process" };
    const err = written();

    const code = await run([], { err: err.stream, env });

    expect(code).toBe(1);
    expect(err.text()).toContain("cartesia has no API key");
  });

  // Unknown flags must propagate: the dispatcher (cli/index.ts) turns them into exit 2.
  it("lets a flag it does not take reach the dispatcher, which names the verb", async () => {
    await expect(run(["--bogus"], { env })).rejects.toThrow("Unknown option '--bogus'");
    await expect(run(["play", MARTA, "--bogus"], { env })).rejects.toThrow("Unknown option '--bogus'");
    expect(gateway.heard).toHaveLength(0);
  });
});

describe("playing", () => {
  it("sends the voice and the words, plays the WAV from a file and prints the two numbers", async () => {
    const out = written();
    const files: string[] = [];

    const code = await run(["play", MARTA, "Hola", "--model", "sonic-3", "--language", "es"], { out: out.stream, env, play: aPlayer(files) });

    expect(code).toBe(0);
    expect(gateway.heard[1]).toMatchObject({
      method: "POST",
      path: "/v1/voices/sample",
      body: { tts: "cartesia", voice: MARTA, model: "sonic-3", language: "es", text: "Hola" },
    });
    expect(out.text()).toBe(`${MARTA} · first audio 210 ms · whole sentence 900 ms · afplay\n`);
    expect(files).toHaveLength(1);
    expect(existsSync(files[0]!)).toBe(false);
  });

  it("sends no words when none were given: the gateway reads a line in the language", async () => {
    await run(["play", MARTA, "--language", "es"], { out: written().stream, env, play: aPlayer([]) });

    expect(gateway.heard[1]!.body).toEqual({ tts: "cartesia", voice: MARTA, model: null, language: "es", text: null });
  });

  it("keeps the WAV where --save says, plays it from there, and says where", async () => {
    const out = written();
    const files: string[] = [];
    const kept = join(mkdtempSync(join(tmpdir(), "pinecall-voices-test-")), "marta.wav");

    const code = await run(["play", MARTA, "--save", kept], { out: out.stream, env, play: aPlayer(files) });

    expect(code).toBe(0);
    expect(files).toEqual([kept]);
    expect(readFileSync(kept)).toEqual(A_WAV);
    expect(out.text()).toContain(` · saved ${kept}\n`);
  });

  it("prints a dash for a number the gateway did not send", async () => {
    gateway.timing = null;
    const out = written();

    await run(["play", MARTA], { out: out.stream, env, play: aPlayer([]) });

    expect(out.text()).toBe(`${MARTA} · first audio — · whole sentence — · afplay\n`);
  });

  it("says why nothing was heard, names the file it kept, and exits 1", async () => {
    const err = written();
    const files: string[] = [];

    const code = await run(["play", MARTA], {
      err: err.stream,
      env,
      play: (file) => {
        files.push(file);
        return { failed: "afplay could not play it (exit 1)" };
      },
    });

    expect(code).toBe(1);
    expect(err.text()).toBe(`afplay could not play it (exit 1): the sample is ${files[0]}\n`);
    expect(existsSync(files[0]!)).toBe(true);
  });

  it("wants a voice and at most one sentence, and says how to ask", async () => {
    const err = written();

    expect(await run(["play"], { err: err.stream, env })).toBe(2);
    expect(await run(["play", MARTA, "one", "two"], { err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("pinecall voices play <voice>");
    expect(gateway.heard).toHaveLength(0);
  });

  it("says a vendor's refusal and plays nothing", async () => {
    gateway.refuse = { status: 422, detail: "no cartesia model 'sonic-9'; this build has sonic-3, sonic-2" };
    const err = written();
    let played = false;

    const code = await run(["play", MARTA, "--model", "sonic-9"], {
      err: err.stream,
      env,
      play: () => {
        played = true;
        return { player: "afplay" };
      },
    });

    expect(code).toBe(1);
    expect(err.text()).toContain("no cartesia model 'sonic-9'");
    expect(played).toBe(false);
  });
});

describe("reading Server-Timing", () => {
  it("finds each metric by name, and null for one the gateway did not send", () => {
    expect(aDuration("first-audio;dur=210, total;dur=900", "total")).toBe(900);
    expect(aDuration("first-audio;dur=210, total;dur=900", "first-audio")).toBe(210);
    expect(aDuration("first-audio;dur=210", "total")).toBeNull();
  });
});
