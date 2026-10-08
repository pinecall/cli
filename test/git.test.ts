// What git says about a file: ignored, not ignored, or no repository at all (nothing could commit it).

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ignoredByGit } from "../src/git.js";

function aRepository(ignoring: string): string {
  const folder = mkdtempSync(join(tmpdir(), "pinecall-git-"));
  spawnSync("git", ["init", "-q"], { cwd: folder });
  writeFileSync(join(folder, ".gitignore"), ignoring);
  return folder;
}

describe("whether git would commit a file", () => {
  it("says ignored when .gitignore names it", () => {
    const folder = aRepository(".env\n");
    writeFileSync(join(folder, ".env"), "PINECALL_KEY=x\n");

    expect(ignoredByGit(join(folder, ".env"))).toBe(true);
  });

  it("says not ignored when nothing names it, so the key would be committed", () => {
    const folder = aRepository("node_modules/\n");
    writeFileSync(join(folder, ".env"), "PINECALL_KEY=x\n");

    expect(ignoredByGit(join(folder, ".env"))).toBe(false);
  });

  it("says ignored outside a repository, where nothing can commit it", () => {
    const folder = mkdtempSync(join(tmpdir(), "pinecall-nogit-"));
    writeFileSync(join(folder, ".env"), "PINECALL_KEY=x\n");

    expect(ignoredByGit(join(folder, ".env"))).toBe(true);
  });
});
