// `pinecall carriers`: an account is kept with its secret read on stdin and never printed, the org's
// accounts are read back one per line, and one is forgotten by its id.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountOf, aLine, run } from "../src/carriers.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_own_key";
// Must never appear in any output.
const THE_SECRET = "twilio-secret-the-clinic-brought";
const THE_PASSWORD = "the-pbx-password";

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
}

/** A gateway with the four carrier doors and one org's accounts. */
class FakeGateway {
  readonly heard: Heard[] = [];
  carriers: unknown[] = [];
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
    const body = text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
    this.heard.push({ method: request.method ?? "", path: request.url ?? "", body });
    if (request.headers.authorization !== `Bearer ${A_KEY}`) return this.#said(response, 401, { detail: "this door takes an API key" });
    if (this.refuse !== undefined) return this.#said(response, this.refuse.status, { detail: this.refuse.detail });
    if (request.url === "/v1/carriers") return this.#said(response, 200, { carriers: this.carriers });
    if (request.method === "DELETE") return this.#said(response, 204, null);
    if (request.method === "PUT") {
      const networks = Array.isArray(body?.["addresses"]) ? body["addresses"].map((network) => ({ network, state: "waiting" })) : [];
      return this.#said(response, 200, { kind: body?.["kind"], account: "acc_1", label: body?.["label"] ?? "", networks });
    }
    return this.#said(response, 200, this.carriers[0] ?? {});
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

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

/** Run the verb against the fake gateway, the secrets given in order, and what it wrote. */
async function carriers(argv: string[], secrets: string[] = []) {
  const out = written();
  const err = written();
  const code = await run(argv, {
    out: out.stream,
    err: err.stream,
    env: pointingAt(gateway.url, A_KEY),
    secrets: async (names) => names.map((_, at) => secrets[at] ?? ""),
  });
  return { code, out: out.text(), err: err.text() };
}

describe("adding an account", () => {
  it("sends a Twilio account's secret in the body of the PUT, and never prints it", async () => {
    const done = await carriers(["add", "twilio", "--account-sid", "AC123", "--user", "SK456", "--label", "Clínica"], [THE_SECRET]);
    expect(done.code).toBe(0);
    expect(gateway.heard.at(-1)).toEqual({
      method: "PUT",
      path: "/v1/carrier",
      body: { kind: "twilio", account_sid: "AC123", user: "SK456", label: "Clínica", secret: THE_SECRET },
    });
    expect(done.out).toContain("kept: acc_1 · twilio · Clínica");
    expect(done.out + done.err).not.toContain(THE_SECRET);
  });

  it("reads a SIP peer's password, and its outbound password second when an outbound user is named", async () => {
    const argv = ["add", "sip", "--username", "pbx", "--address", "203.0.113.0/24", "--address", "198.51.100.7"];
    const done = await carriers([...argv, "--outbound-host", "sip.carrier.example", "--outbound-username", "out"], [THE_PASSWORD, "out-pass"]);
    expect(done.code).toBe(0);
    expect(gateway.heard.at(-1)?.body).toEqual({
      kind: "sip",
      username: "pbx",
      addresses: ["203.0.113.0/24", "198.51.100.7"],
      outbound_host: "sip.carrier.example",
      outbound_username: "out",
      password: THE_PASSWORD,
      outbound_password: "out-pass",
    });
    expect(done.out).toContain("operator approves it");
    expect(done.out).not.toContain(THE_PASSWORD);
  });

  it("keeps a WhatsApp number with its token", async () => {
    await carriers(["add", "whatsapp", "--phone-number-id", "1055"], ["meta-token"]);
    expect(gateway.heard.at(-1)?.body).toEqual({ kind: "whatsapp", phone_number_id: "1055", access_token: "meta-token" });
  });

  it("sends nothing when a secret is empty, and says which one", async () => {
    const done = await carriers(["add", "twilio", "--account-sid", "AC123", "--user", "SK456"], [""]);
    expect(done.code).toBe(2);
    expect(done.err).toContain("no Twilio secret");
    expect(gateway.heard).toHaveLength(0);
  });

  it("names what a kind takes when a flag it needs is missing, and sends nothing", async () => {
    const done = await carriers(["add", "sip", "--username", "pbx"]);
    expect(done.code).toBe(2);
    expect(done.err).toContain("at least one --address");
    expect(gateway.heard).toHaveLength(0);
  });

  it("shows the gateway's refusal as it was said", async () => {
    gateway.refuse = { status: 400, detail: "Twilio refused these credentials" };
    const done = await carriers(["add", "twilio", "--account-sid", "AC123", "--user", "SK456"], [THE_SECRET]);
    expect(done.code).toBe(1);
    expect(done.err).toContain("Twilio refused these credentials");
  });
});

describe("reading and forgetting accounts", () => {
  it("lists every account of the org, one per line, a peer's networks with where each stands", async () => {
    gateway.carriers = [
      { kind: "twilio", account: "acc_1", label: "Clínica", networks: [] },
      { kind: "sip", account: "acc_2", label: "", networks: [{ network: "203.0.113.0/24", state: "approved" }] },
    ];
    const done = await carriers(["list"]);
    expect(done.out.trim().split("\n")).toEqual(["acc_1 · twilio · Clínica", "acc_2 · sip · 203.0.113.0/24 approved"]);
  });

  it("says how to add one when the org holds none", async () => {
    expect((await carriers(["list"])).out).toContain("pinecall carriers add twilio");
  });

  it("shows and drops the account named, by its id", async () => {
    gateway.carriers = [{ kind: "twilio", account: "acc_1", label: "", networks: [] }];
    await carriers(["show", "acc_1"]);
    expect(gateway.heard.at(-1)).toMatchObject({ method: "GET", path: "/v1/carrier?account=acc_1" });
    const dropped = await carriers(["drop", "acc_1"]);
    expect(gateway.heard.at(-1)).toMatchObject({ method: "DELETE", path: "/v1/carrier?account=acc_1" });
    expect(dropped.out).toContain("stay routed");
  });
});

describe("the account the flags describe", () => {
  it("asks which kind when none is named", () => {
    expect(accountOf(undefined, {})).toContain("twilio, sip or whatsapp");
  });

  it("is one line per account, a label only when there is one", () => {
    expect(aLine({ kind: "whatsapp", account: "acc_3", label: "", networks: [] })).toBe("acc_3 · whatsapp");
  });
});
