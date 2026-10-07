// The language of an agent file, and the command its serve entry is started with.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { commandFor, inspectOf, languageOf, startedWith } from "../src/language.js";

const DOOR = { url: "https://cloud.pinecall.io", apiKey: "pk_secret", world: "sandbox" as const };

// This repository installs the framework, as a tenant's project does.
const A_PROJECT = fileURLToPath(new URL("..", import.meta.url));

describe("an agent's language", () => {
  it("is its file's", () => {
    expect(["agents/a/agent.tsx", "agents/a/agent.ts", "agents/a/agent.rb", "agents/a/agent.py"].map(languageOf)).toEqual([
      "typescript",
      "typescript",
      "ruby",
      "python",
    ]);
  });
});

describe("the serve entry's command", () => {
  it("is this Node on the TypeScript entry, the inspect flags first, the verb and its flags last", () => {
    const command = commandFor("typescript", "start", ["--file", "a.tsx"], { root: A_PROJECT, inspect: ["--inspect-brk"] });

    expect(command[0]).toBe(process.execPath);
    expect(command[1]).toBe("--inspect-brk");
    expect(command.at(-3)).toBe("start");
    expect(command.slice(-2)).toEqual(["--file", "a.tsx"]);
    expect(command.some((part) => /serve[/\\]index\.(ts|js)$/.test(part))).toBe(true);
  });

  it("is the project's own framework, and a project that installs none is refused by name", () => {
    const bare = mkdtempSync(join(tmpdir(), "bare-"));

    expect(() => commandFor("typescript", "prompt", [], { root: bare })).toThrow("this project does not install @pinecall/agents");
  });

  it("is Ruby through bundler when the project has a Gemfile, and Ruby alone when it has none", () => {
    const bundled = mkdtempSync(join(tmpdir(), "ruby-"));
    writeFileSync(join(bundled, "Gemfile"), "");
    const plain = mkdtempSync(join(tmpdir(), "ruby-"));

    expect(commandFor("ruby", "prompt", ["--file", "agent.rb"], { root: bundled }).slice(0, 4)).toEqual(["bundle", "exec", "ruby", "-r"]);
    expect(commandFor("ruby", "prompt", ["--file", "agent.rb"], { root: plain })).toEqual([
      "ruby", "-r", "pinecall", "-e", "exit Pinecall::Serve.main(ARGV)", "--", "prompt", "--file", "agent.rb",
    ]);
  });

  it("refuses a Node debugger for Ruby, and Python altogether, in a sentence", () => {
    expect(() => commandFor("ruby", "start", [], { root: "/p", inspect: ["--inspect"] })).toThrow("a Ruby agent runs no Node");
    expect(() => commandFor("python", "start", [], { root: "/p" })).toThrow("not served by this CLI yet");
  });

  it("carries the door in its environment and never in its argv", () => {
    const started = startedWith(DOOR, join(A_PROJECT, "agents/a/agent.tsx"), "start", ["--file", "x"], { root: A_PROJECT });

    expect(started.env).toMatchObject({ PINECALL_URL: DOOR.url, PINECALL_KEY: "pk_secret", PINECALL_ENV: "sandbox" });
    expect(started.command.join(" ")).not.toContain("pk_secret");
  });
});

describe("Node's inspect flags", () => {
  it("are taken out of a verb's argv as they were typed", () => {
    expect(inspectOf(["--state", "f", "--inspect=0.0.0.0:9230", "--inspect-brk"])).toEqual({
      inspect: ["--inspect=0.0.0.0:9230", "--inspect-brk"],
      rest: ["--state", "f"],
    });
  });
});
