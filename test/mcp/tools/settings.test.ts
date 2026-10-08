// The settings tools from an assistant: checked as the CLI checks them before anything is written, and the version the gateway answered.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { A_PROJECTS_KEY, aClient, aProject, called, FakeGateway } from "../fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

const SETTINGS = "/v1/agents/front-desk/settings";
const ROW = (version: number, config: Record<string, unknown>) => ({ holder: "m_1", version, author: "m_1", note: null, set_at: 0, config });

async function opened() {
  const { client } = await aClient();
  await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });
  return client;
}

describe("agent", () => {
  it("refuses a confidence outside (0, 1] and a model nobody names, before anything is asked", async () => {
    const client = await opened();

    expect((await called(client, "agent", { action: "set", settings: { "eot-threshold": 3 } })).text).toBe("eot-threshold 3 is not a confidence: a number above 0 and no higher than 1");
    expect(gateway.asked).toEqual([]);
  });

  it("writes the fields named over the version it read, the tier expanded to its model, and answers the new version", async () => {
    gateway.doors.set(`GET ${SETTINGS}`, [200, { world: "sandbox", yours: ROW(4, { voice: "v1" }), team: null, production: null }]);
    gateway.doors.set(`PUT ${SETTINGS}`, [200, { world: "sandbox", yours: ROW(5, { voice: "v1", llm: "anthropic/claude-haiku-4-5-20251001" }), team: null, production: null }]);
    const client = await opened();

    const answer = JSON.parse((await called(client, "agent", { action: "set", settings: { llm: "haiku", "max-duration": 15 }, note: "from a test" })).text);

    const written = gateway.asked.find((one) => one.door.startsWith("PUT"))!.body as { config: Record<string, unknown>; if_version: number; note: string };
    expect(written.config).toMatchObject({ voice: "v1", max_duration_s: 900 });
    expect(String(written.config["llm"])).toMatch(/^anthropic\/claude-haiku/);
    expect(written.if_version).toBe(4);
    expect(written.note).toBe("from a test");
    expect(answer.yours.version).toBe(5);
  });

  it("needs the version to roll back to", async () => {
    const client = await opened();

    expect((await called(client, "agent", { action: "rollback" })).text).toContain("rollback takes the version");
  });
});

describe("numbers", () => {
  it("imports as a dry run unless told otherwise: the steps, nothing written", async () => {
    gateway.doors.set("POST /v1/numbers?dry_run=true", [200, { steps: ["route: +1555 to front-desk: to do"], dry_run: true }]);
    const client = await opened();

    const answer = JSON.parse((await called(client, "numbers", { action: "import", number: "+15550100", agent: "front-desk" })).text);

    expect(answer).toEqual({ steps: ["route: +1555 to front-desk: to do"], dry_run: true });
    expect(gateway.asked).toEqual([{ door: "POST /v1/numbers?dry_run=true", body: { number: "+15550100", agent: "front-desk" } }]);
  });

  it("refuses an import that names no number or no agent", async () => {
    const client = await opened();

    expect((await called(client, "numbers", { action: "import", number: "+15550100" })).text).toBe("import takes the number and the agent that answers it");
  });
});

describe("lexicon", () => {
  it("adds a word over the words already there, guarded by the version read", async () => {
    gateway.doors.set("GET /v1/agents/front-desk/lexicon", [200, { world: "sandbox", yours: { holder: "m_1", version: 2, author: "m_1", note: null, set_at: 0, lexicon: { said: [{ word: "Vidal", spoken: "bee-dal" }], heard: ["Vidal"] } }, team: null, production: null }]);
    gateway.doors.set("PUT /v1/agents/front-desk/lexicon", [200, { ok: true }]);
    const client = await opened();

    await called(client, "lexicon", { action: "add", word: "Pinecall", say: "pine call" });

    const put = gateway.asked.find((one) => one.door.startsWith("PUT"))!.body as { lexicon: { said: unknown[]; heard: string[] }; if_version: number };
    expect(put.lexicon.said).toEqual([{ word: "Vidal", spoken: "bee-dal" }, { word: "Pinecall", spoken: "pine call" }]);
    expect(put.lexicon.heard).toEqual(["Vidal"]);
    expect(put.if_version).toBe(2);
  });
});

describe("the tools that never take a secret", () => {
  it("offer no way to add a provider key, a carrier or an app's secret", async () => {
    const client = await opened();
    const tools = (await client.listTools()).tools;

    const schemas = JSON.stringify(tools.map((one) => one.inputSchema));
    expect(schemas).not.toMatch(/api_key|apiKey|secret|password|auth_token/i);
    expect(tools.map((one) => one.name)).not.toContain("secrets");
  });
});
