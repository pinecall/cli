// `pinecall new`: a project of one agent the other verbs find, in either language, and nothing written over.

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { agentFilesOfTheProject } from "../src/home.js";
import { run, scaffold } from "../src/new.js";
import { written } from "./said.js";

function aFolder(): string {
  return mkdtempSync(join(tmpdir(), "pinecall-new-"));
}

function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(root, path));
    }
  };
  walk(root);
  return found.sort();
}

describe("a TypeScript project", () => {
  it("is the layout every verb reads, under the name it was given", () => {
    const root = scaffold(join(aFolder(), "front-desk"), "front-desk", "typescript");

    expect(filesUnder(root)).toEqual([
      ".env.example",
      ".gitignore",
      "README.md",
      "agents/front-desk/agent.tsx",
      "package.json",
      "test/front-desk/agent.test.ts",
      "test/front-desk/goldens/takes-the-message.json",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
    expect(agentFilesOfTheProject(root)).toEqual([join(root, "agents/front-desk/agent.tsx")]);
  });

  it("names its class after the slug and depends on this CLI and the framework it is released with", () => {
    const root = scaffold(join(aFolder(), "front-desk"), "front-desk", "typescript");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; dependencies: Record<string, string> };
    const ours = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; dependencies: Record<string, string> };

    expect(readFileSync(join(root, "agents/front-desk/agent.tsx"), "utf8")).toContain("export default class FrontDesk extends Agent");
    expect(manifest.name).toBe("front-desk");
    expect(manifest.dependencies).toEqual({ "@pinecall/agents": ours.dependencies["@pinecall/agents"], pinecall: `^${ours.version}` });
    expect(filesUnder(root).join("\n")).not.toMatch(/\{\{|__slug__/);
  });
});

describe("a Ruby project", () => {
  it("is the same layout, with the view beside the class and a Gemfile", () => {
    const root = scaffold(join(aFolder(), "front-desk"), "front-desk", "ruby");

    expect(filesUnder(root)).toEqual([
      ".env.example",
      ".gitignore",
      "Gemfile",
      "README.md",
      "Rakefile",
      "agents/front-desk/agent.rb",
      "agents/front-desk/views/front-desk.erb",
      "test/front-desk/agent_test.rb",
      "test/front-desk/goldens/takes-the-message.json",
    ]);
    expect(readFileSync(join(root, "agents/front-desk/agent.rb"), "utf8")).toContain("class FrontDesk < Pinecall::Agent");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toMatch(/^\.env$/m);
  });
});

describe("a Python project", () => {
  it("is the same layout, with the view beside the class, a pyproject.toml, and pytest", () => {
    const root = scaffold(join(aFolder(), "front-desk"), "front-desk", "python");

    expect(filesUnder(root)).toEqual([
      ".env.example",
      ".gitignore",
      "README.md",
      "agents/front-desk/agent.py",
      "agents/front-desk/views/front-desk.jinja",
      "pyproject.toml",
      "test/front-desk/goldens/takes-the-message.json",
      "test/front-desk/test_agent.py",
    ]);
    expect(readFileSync(join(root, "agents/front-desk/agent.py"), "utf8")).toContain("class FrontDesk(Agent):");
    expect(readFileSync(join(root, "agents/front-desk/views/front-desk.jinja"), "utf8")).toContain("{{ message.name }}");
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toContain('dependencies = ["pinecall>=0.2,<1"]');
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toMatch(/^\.venv\/$/m);
    expect(agentFilesOfTheProject(root)).toEqual([join(root, "agents/front-desk/agent.py")]);
  });
});

describe("what new refuses", () => {
  it("a name the gateway would not take as a slug", () => {
    for (const name of ["Front", "front_desk", "1desk", "desk-"]) {
      expect(() => scaffold(join(aFolder(), name), name, "typescript")).toThrow(/cannot be an agent's name/);
    }
  });

  it("a folder somebody already wrote in", () => {
    const root = aFolder();
    writeFileSync(join(root, "notes.md"), "mine");

    expect(() => scaffold(root, "notes", "ruby")).toThrow(/already holds files/);
  });

  it("both languages at once", async () => {
    await expect(run(["desk", "--ruby", "--typescript"], written().stream, aFolder())).rejects.toThrow(/not both/);
    await expect(run(["desk", "--python", "--ruby"], written().stream, aFolder())).rejects.toThrow("--ruby or --python, not both");
  });
});

it("says the next commands, from the folder it ran in", async () => {
  const out = written();

  expect(await run(["front-desk", "--ruby"], out.stream, aFolder())).toBe(0);
  expect(out.text()).toContain("cd front-desk\n  bundle install\n  pinecall link");
  const python = written();
  expect(await run(["front-desk", "--python"], python.stream, aFolder())).toBe(0);
  expect(python.text()).toContain("a Python agent\n\n  cd front-desk\n  uv sync\n  pinecall link");
});
