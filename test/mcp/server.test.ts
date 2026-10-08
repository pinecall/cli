// The MCP server as a host sees it: its tools and their manuals, refusals a model can act on, and no key in any answer.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { instructions } from "../../src/mcp/instructions.js";
import { serve, serverOf } from "../../src/mcp/server.js";
import { tool } from "../../src/mcp/tool.js";
import { NO_KEY_HERE, NO_PRODUCTION, NO_PROJECT, Session } from "../../src/mcp/session.js";
import { TOOLS } from "../../src/mcp/tools/all.js";
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
  it("are every tool, each with a sentence a host lists it by", async () => {
    const { client } = await aClient();

    const listed = (await client.listTools()).tools;

    expect(listed.map((one) => one.name)).toEqual(TOOLS.map((one) => one.name));
    expect(listed.every((one) => (one.description ?? "").length > 20)).toBe(true);
  });

  it("each carry a manual, and the instructions carry every one of them", () => {
    const said = instructions(TOOLS);

    for (const one of TOOLS) {
      expect(one.manual.length, one.name).toBeGreaterThan(40);
      expect(said).toContain(one.manual);
    }
  });

  it("each have a row on the page that documents them", () => {
    const page = readFileSync(new URL("../../docs/the-mcp.md", import.meta.url), "utf8");

    expect(TOOLS.filter((one) => !page.includes(`| \`${one.name}\``)).map((one) => one.name)).toEqual([]);
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
    const server = serverOf("0", {}, false, leaky);
    const [ours, theirs] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "a-test", version: "0" });
    await Promise.all([server.connect(theirs), client.connect(ours)]);

    expect((await called(client, "says")).text).toBe('{\n  "key": "***"\n}');
    expect(await called(client, "fails")).toEqual({ text: "bad key ***", refused: true });
  });
});

describe("production", () => {
  it("is refused by a server a person did not start with --prod, naming how to allow it", async () => {
    const session = new Session({}, false, async () => []);
    session.open(aProject(A_PROJECTS_KEY, gateway.url));

    await expect(session.door(true)).rejects.toThrow(NO_PRODUCTION);
    expect((await session.door()).world).toBe("sandbox");
  });

  it("is the door's world on a server started with --prod, when a tool asks for it", async () => {
    const session = new Session({}, true, async () => []);
    session.open(aProject(A_PROJECTS_KEY, gateway.url));

    expect((await session.door(true)).world).toBe("production");
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
