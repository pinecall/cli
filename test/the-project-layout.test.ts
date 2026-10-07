// One layout: agents/<name>/agent.ts, and every folder of the agent's by its name under the root.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentFilesOfTheProject, homeOf, homesFor, theAgentHere } from "../src/home.js";

function aProject(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "a-project-"));
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

describe("the agents of a project", () => {
  it("are the folders under agents/ that hold a class, sorted, and never a folder without one", () => {
    const root = aProject(["agents/sales/agent.tsx", "agents/dispatch/agent.ts", "agents/dispatch/callbacks.ts", "agents/notes/README.md"]);

    expect(agentFilesOfTheProject(root)).toEqual([join(root, "agents/dispatch/agent.ts"), join(root, "agents/sales/agent.tsx")]);
  });

  it("are none outside a project", () => {
    expect(agentFilesOfTheProject(aProject(["README.md"]))).toEqual([]);
  });
});

describe("an agent's home", () => {
  it("is every folder of the project by the agent's name, the goldens holding the retrieval and recall goldens too", () => {
    const root = aProject(["agents/sales/agent.tsx"]);

    expect(homeOf(join(root, "agents/sales/agent.tsx"))).toEqual({
      file: join(root, "agents/sales/agent.tsx"),
      name: "sales",
      root,
      goldens: join(root, "test/sales/goldens"),
      personas: join(root, "test/sales/personas"),
      docs: join(root, "docs/sales"),
      docsGolden: join(root, "test/sales/goldens/docs.json"),
      memoryGolden: join(root, "test/sales/goldens/memory.json"),
      memoryCases: join(root, "test/sales/memory"),
    });
  });

  it("is found for every agent at the root, or for the one --agent names by its name", async () => {
    const root = aProject(["agents/dispatch/agent.tsx", "agents/sales/agent.tsx"]);
    const was = process.cwd();
    process.chdir(root);
    try {
      expect((await homesFor()).map((home) => home.name)).toEqual(["dispatch", "sales"]);
      expect((await homesFor(undefined, "sales")).map((home) => home.name)).toEqual(["sales"]);
    } finally {
      process.chdir(was);
    }
  });

  it("names the agents when nobody said which, and where it looked when there is none", async () => {
    const two = aProject(["agents/dispatch/agent.tsx", "agents/sales/agent.tsx"]);
    const none = aProject(["README.md"]);
    const was = process.cwd();
    try {
      process.chdir(two);
      expect(() => theAgentHere()).toThrow("this project has 2 agents: name one with --agent dispatch or --agent sales");
      process.chdir(none);
      expect(() => theAgentHere()).toThrow(/no agent here: looked for agents\/<name>\/agent\.tsx or agent\.ts or agent\.rb or agent\.py in /);
    } finally {
      process.chdir(was);
    }
  });
});
