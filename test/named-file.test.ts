// Errors for a file named on the command line: a wrong path or invalid JSON.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CannotRun } from "../src/cannot-run.js";
import { readNamedJson } from "../src/named-file.js";

function aFile(name: string, text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "named-")), name);
  writeFileSync(path, text, "utf8");
  return path;
}

describe("a JSON file a flag named", () => {
  it("is parsed when it is there and it is JSON", () => {
    expect(readNamedJson("--state", aFile("state.json", '{"stage":"choose"}'))).toEqual({ stage: "choose" });
  });

  // Node's raw ENOENT names neither the flag nor the fix.
  it("says which flag named a path that is not there, and cannot run", () => {
    let failed: unknown;
    try {
      readNamedJson("--policy", "/no/such/policy.json");
    } catch (thrown) {
      failed = thrown;
    }

    expect(failed).toBeInstanceOf(CannotRun);
    expect((failed as Error).message).toBe("--policy: cannot read /no/such/policy.json — no such file");
  });

  it("says which file is not JSON, with the parser's own complaint", () => {
    const path = aFile("policy.json", "{banned: [] }");

    expect(() => readNamedJson("--policy", path)).toThrow(new RegExp(`--policy: ${path.replace(/\//g, "\\/")} is not JSON`));
  });
});
