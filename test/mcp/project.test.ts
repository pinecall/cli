// The project the tools act on: shown, opened, and written new from the same templates `pinecall new` uses.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { aClient, aProject, called } from "./fake.js";

describe("project", () => {
  it("shows an opened folder's agents, their language, and that it has no key yet", async () => {
    const { client } = await aClient();
    const root = aProject();

    const shown = JSON.parse((await called(client, "project", { action: "open", path: root })).text);

    expect(shown).toMatchObject({ root, agents: [{ name: "front-desk", language: "typescript" }], key: "none: call link" });
  });

  it("writes a new TypeScript project, opens it, and says to install it before it runs", async () => {
    const { client } = await aClient();
    const parent = mkdtempSync(join(tmpdir(), "pinecall-new-"));

    const made = JSON.parse((await called(client, "project", { action: "new", name: "front-desk", path: parent })).text);

    expect(made.root).toBe(join(parent, "front-desk"));
    expect(existsSync(join(parent, "front-desk", "agents", "front-desk", "agent.tsx"))).toBe(true);
    expect(made.next).toContain("npm install");
    expect(JSON.parse((await called(client, "project", { action: "show" })).text).root).toBe(made.root);
  });

  it("writes a Ruby one when asked, with its own install step", async () => {
    const { client } = await aClient();
    const parent = mkdtempSync(join(tmpdir(), "pinecall-new-"));

    const made = JSON.parse((await called(client, "project", { action: "new", name: "desk", path: parent, language: "ruby" })).text);

    expect(made.agents).toEqual([{ name: "desk", language: "ruby" }]);
    expect(made.next).toContain("bundle install");
  });

  it("refuses a name the gateway would not take, in its words", async () => {
    const { client } = await aClient();

    const answer = await called(client, "project", { action: "new", name: "Front Desk", path: mkdtempSync(join(tmpdir(), "pinecall-new-")) });

    expect(answer.refused).toBe(true);
    expect(answer.text).toContain("lowercase letters, digits and dashes");
  });

  it("generates a second agent and a golden into the open project, and refuses a kind it does not write", async () => {
    const { client } = await aClient();
    const made = JSON.parse((await called(client, "project", { action: "new", name: "front-desk", path: mkdtempSync(join(tmpdir(), "pinecall-new-")) })).text);

    const agent = JSON.parse((await called(client, "project", { action: "generate", kind: "agent", name: "after-hours" })).text);
    const golden = JSON.parse((await called(client, "project", { action: "generate", kind: "golden", name: "a-refund", agent: "after-hours", input: ["I want a refund."], tools: ["takeMessage"] })).text);

    expect(agent.written).toContain("agents/after-hours/agent.tsx");
    expect(agent.agents.map((one: { name: string }) => one.name)).toEqual(["after-hours", "front-desk"]);
    expect(golden.written).toEqual([join(made.root, "test", "after-hours", "goldens", "a-refund.json")]);
    expect((await called(client, "project", { action: "generate", name: "x" })).text).toBe("generate takes a kind: agent or golden");
    expect((await called(client, "project", { action: "generate", kind: "golden", name: "y", input: ["hi"] })).text).toBe("name the agent: one of after-hours, front-desk");
  });
});
