// A project packed as a release: what travels, what never does, and a tarball any tar reads.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { isLeftOut, packed, projectFiles } from "../src/packed.js";

function aProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pinecall-packed-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("what a release carries", () => {
  it("never carries the keys, the dependencies, the history or a build", () => {
    for (const path of [".env", ".env.production", "sub/.env.local", "node_modules/x/index.js", ".git/HEAD", "dist/agent.js"]) {
      expect(isLeftOut(path)).toBe(true);
    }
    expect(isLeftOut("agents/sales/agent.tsx")).toBe(false);
    expect(isLeftOut(".env.example")).toBe(true);
  });

  it("is every file of a folder that is no checkout, sorted, bar what is left out", () => {
    const root = aProject({ "package.json": "{}", "agents/a/agent.ts": "x", ".env": "PINECALL_KEY=pc_live_x", "node_modules/p/i.js": "" });

    expect(projectFiles(root)).toEqual(["agents/a/agent.ts", "package.json"]);
  });

  it("is what git would commit in a checkout: an ignored file stays home", () => {
    const root = aProject({ "package.json": "{}", ".gitignore": "notes.md\n", "notes.md": "mine", "agents/a/agent.ts": "x" });
    execFileSync("git", ["init", "-q"], { cwd: root });

    expect(projectFiles(root)).toEqual([".gitignore", "agents/a/agent.ts", "package.json"]);
  });

  it("leaves out a tracked file deleted on disk instead of crashing on it", () => {
    const root = aProject({ "package.json": "{}", "agents/a/agent.ts": "x", "gone.ts": "" });
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    rmSync(join(root, "gone.ts"));

    expect(projectFiles(root)).toEqual(["agents/a/agent.ts", "package.json"]);
  });
});

describe("the tarball", () => {
  it("is gzipped ustar that tar reads back file for file, long paths included", () => {
    const deep = `agents/${"a".repeat(60)}/${"b".repeat(60)}/agent.ts`;
    const root = aProject({ "package.json": '{"name":"x"}', [deep]: "export default 1" });
    const out = mkdtempSync(join(tmpdir(), "pinecall-unpacked-"));
    const archive = join(out, "release.tgz");
    writeFileSync(archive, packed(root, projectFiles(root)));

    execFileSync("tar", ["-xzf", archive, "-C", out]);

    expect(execFileSync("cat", [join(out, deep)]).toString()).toBe("export default 1");
    expect(execFileSync("cat", [join(out, "package.json")]).toString()).toBe('{"name":"x"}');
  });

  it("keeps a file's execute bit, and gives every other file 644", () => {
    const root = aProject({ "run.sh": "#!/bin/sh", "a.txt": "hi" });
    chmodSync(join(root, "run.sh"), 0o755);
    const out = mkdtempSync(join(tmpdir(), "pinecall-unpacked-"));
    writeFileSync(join(out, "release.tgz"), packed(root, projectFiles(root)));

    execFileSync("tar", ["-xzf", join(out, "release.tgz"), "-C", out]);

    expect(statSync(join(out, "run.sh")).mode & 0o777).toBe(0o755);
    expect(statSync(join(out, "a.txt")).mode & 0o777).toBe(0o644);
  });

  it("ends with the two empty blocks a tar reader looks for", () => {
    const tar = gunzipSync(packed(aProject({ "a.txt": "hi" }), ["a.txt"]));

    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(-1024).every((byte) => byte === 0)).toBe(true);
  });
});
