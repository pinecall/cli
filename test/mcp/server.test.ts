// The MCP server as a host sees it: its tools and their manuals, refusals a model can act on, no key in any answer, and a trace per call.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { instructions } from "../../src/mcp/instructions.js";
import { serve, serverOf } from "../../src/mcp/server.js";
import { tool } from "../../src/mcp/tool.js";
import { NO_KEY_HERE, NO_PRODUCTION, NO_PROJECT, Session } from "../../src/mcp/session.js";
import { STAGES, TOOLS } from "../../src/mcp/tools/all.js";
import { A_PROJECTS_KEY, aClient, aProject, called, FakeGateway } from "./fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

describe("the tools a host is offered", () => {
  it("are every tool, each described by its sentence and its manual, said once", async () => {
    const { client } = await aClient();

    const listed = (await client.listTools()).tools;

    expect(listed.map((one) => one.name)).toEqual(TOOLS.map((one) => one.name));
    for (const one of TOOLS) {
      expect(one.manual.length, one.name).toBeGreaterThan(40);
      expect(listed.find((shown) => shown.name === one.name)?.description).toBe(`${one.description}\n\n${one.manual}`);
    }
  });

  it("are named by stage in the instructions, which carry the journey and no manual twice", () => {
    const said = instructions(STAGES);

    for (const one of TOOLS) {
      expect(said).toContain(`\`${one.name}\``);
      expect(said).not.toContain(one.manual);
    }
    expect(said).toContain("Every tool acts in the sandbox");
  });

  it("each have a row on the page that documents them", () => {
    const page = readFileSync(new URL("../../docs/the-mcp.md", import.meta.url), "utf8");

    expect(TOOLS.filter((one) => !page.includes(`| \`${one.name}\``)).map((one) => one.name)).toEqual([]);
  });

  it("take `prod` wherever they open the project's door, and nowhere they act on the agent held", async () => {
    const { client } = await aClient();

    const listed = (await client.listTools()).tools;
    const takesProd = listed.filter((one) => "prod" in ((one.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})).map((one) => one.name);

    expect(takesProd).toContain("whoami");
    expect(takesProd).toContain("agent");
    expect(takesProd).toContain("deploy");
    expect(takesProd).toContain("start");
    for (const one of ["chat", "test", "simulate", "remember", "stop", "status", "logs", "login", "link", "project", "prompt", "docs_search", "get_doc"]) expect(takesProd).not.toContain(one);
  });
});

describe("a refusal", () => {
  it("names the tool that opens a project when there is none", async () => {
    const { client } = await aClient();

    expect(await called(client, "whoami")).toEqual({ text: NO_PROJECT, refused: true });
  });

  it("names `link` when the project has no key", async () => {
    const { client } = await aClient();
    const root = aProject();
    await called(client, "project", { action: "open", path: root });

    expect(await called(client, "whoami")).toEqual({ text: NO_KEY_HERE(root), refused: true });
  });

  it("says what was wrong with the arguments, in one line", async () => {
    const { client } = await aClient();

    const answer = await called(client, "project", { action: "rename" });

    expect(answer.refused).toBe(true);
    expect(answer.text).toContain("action");
  });
});

describe("an answer", () => {
  it("is the gateway's, with the project's key hidden even where the gateway repeated it", async () => {
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });

    const answer = await called(client, "whoami");

    expect(answer.refused).toBe(false);
    expect(JSON.parse(answer.text)).toMatchObject({ org: "clinica", environment: "sandbox", production_allowed_for_this_server: false });
    expect(answer.text).not.toContain(A_PROJECTS_KEY);
  });

  it("hides any key a tool answers with, and any a refusal says", async () => {
    const leaky = [
      tool({ name: "says", description: "answers a key", manual: "a tool for this test", schema: {}, handler: async () => ({ key: A_PROJECTS_KEY }) }),
      tool({ name: "fails", description: "refuses with a key", manual: "a tool for this test", schema: {}, handler: async () => { throw new Error(`bad key ${A_PROJECTS_KEY}`); } }),
    ];
    const server = serverOf("0", {}, false, { stages: [{ stage: "a test", page: "a-test", tools: leaky }] });
    const [ours, theirs] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "a-test", version: "0" });
    await Promise.all([server.connect(theirs), client.connect(ours)]);

    expect((await called(client, "says")).text).toBe('{\n  "key": "***"\n}');
    expect(await called(client, "fails")).toEqual({ text: "bad key ***", refused: true });
  });

  it("leaves one line in the trace per call: the tool, how long, how it ended, and nothing it was asked or answered", async () => {
    const traced: string[] = [];
    const { client } = await aClient(false, (line) => traced.push(line));
    await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });

    await called(client, "whoami");
    await called(client, "chat", { action: "say", text: "a secret line" });

    expect(traced).toHaveLength(3);
    expect(traced[1]).toMatch(/^pinecall-mcp · whoami · \d+ ms · ok$/);
    expect(traced[2]).toMatch(/^pinecall-mcp · chat · \d+ ms · refused$/);
    expect(traced.join("\n")).not.toContain("a secret line");
  });
});

describe("production", () => {
  it("is refused by a server a person did not start with --prod, naming how to allow it", async () => {
    const session = new Session({}, false, async () => []);
    session.open(aProject(A_PROJECTS_KEY, gateway.url));

    await expect(session.door(true)).rejects.toThrow(NO_PRODUCTION);
    expect((await session.door()).world).toBe("sandbox");
  });

  it("is where a tool acts when it says `prod`, on a server started with --prod", async () => {
    const { client } = await aClient(true);
    await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });

    expect(JSON.parse((await called(client, "whoami")).text).environment).toBe("sandbox");
    expect(JSON.parse((await called(client, "whoami", { prod: true })).text)).toMatchObject({ environment: "production", production_allowed_for_this_server: true });
  });

  it("is refused on a tool, in the same words, by any other server", async () => {
    const { client } = await aClient();
    await called(client, "project", { action: "open", path: aProject(A_PROJECTS_KEY, gateway.url) });

    expect(await called(client, "calls", { prod: true })).toEqual({ text: NO_PRODUCTION, refused: true });
  });
});

describe("serving", () => {
  it("ends when the host closes the connection, so the process exits with nothing left running", async () => {
    const [ours, theirs] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "a-test", version: "0" });
    const serving = serve("0", {}, false, theirs);
    await client.connect(ours);

    await client.close();

    await expect(serving).resolves.toBeUndefined();
  });
});
