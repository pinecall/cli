// `pinecall start` before any gateway: the prompt through each agent's serve entry, and one language a process.

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { run } from "../src/start.js";
import { onStderr } from "./said.js";

const CLINIC = fileURLToPath(new URL("./clinic", import.meta.url));

const was = process.cwd();

afterEach(() => process.chdir(was));

function aProject(files: string[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a-project-")));
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

describe("pinecall start", () => {
  it("prints the prompt a fresh instance would produce through the agent's serve entry, with no gateway", async () => {
    process.chdir(CLINIC);
    const said: string[] = [];
    const before = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => (said.push(String(chunk)), true)) as typeof process.stdout.write;
    try {
      expect(await run(["--show-prompt"])).toBe(0);
    } finally {
      process.stdout.write = before;
    }

    expect(said.join("")).toContain("Saluda y pide nombre y teléfono.");
    expect(said.join("")).toContain("── tools ──");
  });

  it("refuses a project whose agents are in two languages, naming each one to run apart", async () => {
    process.chdir(aProject(["agents/dispatch/agent.rb", "agents/sales/agent.tsx"]));
    const err = onStderr();
    let code: number;
    try {
      code = await run([]);
    } finally {
      err.restore();
    }

    expect(code).toBe(2);
    expect(err.text()).toContain("one process serves one language: add --agent dispatch or --agent sales");
  });
});
