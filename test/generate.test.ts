// `pinecall generate`: a second agent from the templates `new` writes, and a golden from the caller's lines — never over a file.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CannotRun } from "../src/cannot-run.js";
import { aGoldenGenerated, anAgentGenerated, NO_PROJECT_HERE, run } from "../src/generate.js";
import { agentFilesOfTheProject, homeOf } from "../src/home.js";
import { scaffold } from "../src/new.js";
import { goldensIn } from "../src/testing/goldens.js";
import { written } from "./said.js";

function aProject(language: "typescript" | "ruby" = "typescript"): string {
  return scaffold(join(mkdtempSync(join(tmpdir(), "pinecall-generate-")), "front-desk"), "front-desk", language);
}

describe("a second agent", () => {
  it("is the same files the first was written with, under its own name, and every verb finds both", () => {
    const root = aProject();

    const files = anAgentGenerated(root, "after-hours");

    expect(files.sort()).toEqual(["agents/after-hours/agent.tsx", "test/after-hours/agent.test.ts", "test/after-hours/goldens/takes-the-message.json"]);
    expect(readFileSync(join(root, files[0]!), "utf8")).toContain("export default class AfterHours extends Agent");
    expect(agentFilesOfTheProject(root).map((file) => homeOf(file).name)).toEqual(["after-hours", "front-desk"]);
  });

  it("is in the project's language unless one is named", () => {
    const root = aProject("ruby");

    expect(anAgentGenerated(root, "sales")).toContain("agents/sales/agent.rb");
    expect(anAgentGenerated(root, "billing", "typescript")).toContain("agents/billing/agent.tsx");
  });

  it("is refused over an agent that is there, a name the gateway would not take, or outside a project", () => {
    const root = aProject();

    expect(() => anAgentGenerated(root, "front-desk")).toThrow("front-desk is an agent of this project already");
    expect(() => anAgentGenerated(root, "After Hours")).toThrow("lowercase letters, digits and dashes");
    const nowhere = mkdtempSync(join(tmpdir(), "pinecall-generate-"));
    expect(() => anAgentGenerated(nowhere, "sales")).toThrow(NO_PROJECT_HERE(nowhere));
  });
});

describe("a golden", () => {
  it("is the caller's lines in order and the tools that must be called, read by `pinecall test` as any other", async () => {
    const home = homeOf(join(aProject(), "agents", "front-desk", "agent.tsx"));

    const file = aGoldenGenerated(home, "asks-for-a-refund", ["Hi, I want a refund.", "  It's Ana Ruiz.  "], ["takeMessage"]);

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ input: ["Hi, I want a refund.", "It's Ana Ruiz."], expect: { tools: ["takeMessage"] } });
    expect((await goldensIn([home.goldens])).map((one) => one.name)).toContain("asks-for-a-refund");
  });

  it("is refused with no line for the caller, over a golden that is there, or under a name no file should have", () => {
    const home = homeOf(join(aProject(), "agents", "front-desk", "agent.tsx"));

    expect(() => aGoldenGenerated(home, "empty", ["  "], [])).toThrow("--input");
    expect(() => aGoldenGenerated(home, "takes-the-message", ["hi"], [])).toThrow("never written over");
    expect(() => aGoldenGenerated(home, "../escape", ["hi"], [])).toThrow("cannot be a golden's name");
    expect(existsSync(join(home.goldens, "empty.json"))).toBe(false);
  });
});

describe("the verb", () => {
  it("prints what it wrote, and names the agent a project of two must be told", async () => {
    const root = aProject();
    const out = written();
    await run(["agent", "after-hours"], out.stream, root);

    expect(out.text()).toContain("  wrote agents/after-hours/agent.tsx");
    await expect(run(["golden", "x", "--input", "hi"], written().stream, root)).rejects.toThrow("--agent after-hours or --agent front-desk");
    await run(["golden", "x", "--input", "hi", "--agent", "after-hours"], out.stream, root);
    expect(out.text()).toContain("  wrote test/after-hours/goldens/x.json");
  });

  it("refuses a kind it does not write, with its usage", async () => {
    await expect(run(["tool", "x"], written().stream, aProject())).rejects.toBeInstanceOf(CannotRun);
  });
});
