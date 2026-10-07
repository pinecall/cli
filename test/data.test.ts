// `pinecall data`: each verb at its door, an erasure refused without --yes, retention set and read, the export streamed.

import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/data.js";
import type { Erasure, OrgPolicyRow } from "@pinecall/agents/wire";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";

const AN_ERASURE: Erasure = {
  id: 7, at: 1758300000, what: "call", subject: "CA_1", env: "sandbox", asked_by: "m_ana",
  calls: 1, entries: 12, memories: 2, recordings: 1,
};

const NOTHING_SET = { retention_days: null, calling_hours: null, per_number_day: null, consent_everywhere: false, disclosure: null, recording_notice: true };

const EXPORTED = '{"kind": "export", "org": "org_1", "env": "sandbox"}\n{"kind": "call", "call": "CA_1"}\n';

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

const A_READ = { subject: "CA_1", what: "recording", env: "production", reader: "m_ana", at: 1758300000 };

/** A gateway with the data doors: erasures, the reads, the policy, the export. */
class FakeGateway {
  readonly heard: Heard[] = [];
  policy: OrgPolicyRow = { policy: NOTHING_SET, set_by: null, set_at: null };
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
    if (heard.path === "/v1/org/export") {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end(EXPORTED);
      return;
    }
    if (heard.path === "/v1/org/erasures") return this.#said(response, 200, { erasures: [AN_ERASURE] });
    if (heard.path.startsWith("/v1/org/reads")) return this.#said(response, 200, { reads: [A_READ] });
    if (heard.path === "/v1/org/policy") {
      if (heard.method === "PUT") this.policy = { policy: heard.body as OrgPolicyRow["policy"], set_by: "m_ana", set_at: 1758300000 };
      return this.#said(response, 200, this.policy);
    }
    if (heard.path === "/v1/calls/CA_live") return this.#said(response, 409, { detail: "call CA_live is still running: it can be erased once it has ended" });
    return this.#said(response, 200, { ...AN_ERASURE, what: heard.path.startsWith("/v1/contacts/") ? "contact" : "call" });
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
  gateway.policy = { policy: NOTHING_SET, set_by: null, set_at: null };
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
});

afterEach(async () => {
  await gateway.close();
});

describe("erasing", () => {
  it("asks for --yes before it asks the gateway anything", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["erase", "call", "CA_1"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(err.text()).toContain("cannot be undone");
    expect(gateway.heard).toEqual([]);
  });

  it("erases a call at its door and says what went", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["erase", "call", "CA_1", "--yes"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "DELETE", path: "/v1/calls/CA_1" });
    expect(out.text()).toContain("call CA_1  1 call(s), 12 entries, 2 memories, 1 recording(s)  by m_ana");
  });

  it("erases a contact by their number, encoded", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["erase", "contact", "+14155550142", "--yes"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "DELETE", path: "/v1/contacts/%2B14155550142" });
  });

  it("says the gateway's refusal of a call still running and exits 1", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["erase", "call", "CA_live", "--yes"], { out: out.stream, err: err.stream, env })).toBe(1);
    expect(err.text()).toContain("still running");
  });

  it("lists the trail", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["erasures"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(out.text()).toContain("call CA_1");
  });

  it("lists who read the org's calls, and one call's readers at its own query", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["reads"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["reads", "CA_1"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(gateway.heard.map((heard) => heard.path)).toEqual(["/v1/org/reads", "/v1/org/reads?subject=CA_1"]);
    expect(out.text()).toContain("recording  CA_1  by m_ana  (production)");
  });
});

describe("policy", () => {
  it("reads it, changes one field at a time with the rest kept, and clears one", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["policy"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["policy", "--retention-days", "365"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["policy", "--calling-hours", "9-20", "--per-number-day", "2"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["policy", "--keep-all"], { out: out.stream, err: err.stream, env })).toBe(0);
    const writes = gateway.heard.filter((one) => one.method === "PUT").map((one) => one.body);
    expect(writes).toEqual([
      { ...NOTHING_SET, retention_days: 365 },
      { ...NOTHING_SET, retention_days: 365, calling_hours: { from: 9, until: 20 }, per_number_day: 2 },
      { ...NOTHING_SET, calling_hours: { from: 9, until: 20 }, per_number_day: 2 },
    ]);
    expect(out.text()).toContain("every sealed call is kept until it is erased");
    expect(out.text()).toContain("a sealed call is erased 365 day(s) after it started");
    expect(out.text()).toContain("a number is rung from 9:00 to 20:00 of its own day");
    expect(out.text()).toContain("one number is rung at most 2 time(s) a day");
  });

  it("refuses a count that is no whole number, hours that are no window, and both flags of one field", async () => {
    const [out, err] = [written(), written()];
    expect(await run(["policy", "--retention-days", "0"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["policy", "--calling-hours", "20-9"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["policy", "--per-number-day", "3", "--no-per-number"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["policy", "--disclosure", "Hi", "--no-disclosure"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["policy", "--disclosure", "  "], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(await run(["policy", "--consent-everywhere", "--consent-by-law"], { out: out.stream, err: err.stream, env })).toBe(2);
    expect(gateway.heard).toEqual([]);
  });

  it("sets consent everywhere, the org's own disclosure, none, the platform's again, and the notice off", async () => {
    const [out, err] = [written(), written()];
    const said = "Hi, this is Ana, Clínica Norte's virtual assistant.";
    expect(await run(["policy", "--consent-everywhere", "--disclosure", said], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["policy", "--no-disclosure", "--no-recording-notice"], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(await run(["policy", "--platform-disclosure"], { out: out.stream, err: err.stream, env })).toBe(0);
    const writes = gateway.heard.filter((heard) => heard.method === "PUT").map((heard) => heard.body);
    expect(writes).toEqual([
      { ...NOTHING_SET, consent_everywhere: true, disclosure: said },
      { ...NOTHING_SET, consent_everywhere: true, disclosure: "", recording_notice: false },
      { ...NOTHING_SET, consent_everywhere: true, disclosure: null, recording_notice: false },
    ]);
    expect(out.text()).toContain(`outbound opens: "${said}"`);
    expect(out.text()).toContain("nothing: the agent's own greeting must disclose it");
    expect(out.text()).toContain("a recorded call says nothing of it");
    expect(out.text()).toContain("every number needs a consent on file");
  });
});

describe("export", () => {
  it("streams the lines to a file", async () => {
    const [out, err] = [written(), written()];
    const file = join(mkdtempSync(join(tmpdir(), "export-")), "org.jsonl");
    expect(await run(["export", "--out", file], { out: out.stream, err: err.stream, env })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(EXPORTED);
    expect(err.text()).toContain(`written to ${file}`);
  });
});
