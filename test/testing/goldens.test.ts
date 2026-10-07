// Loading goldens from disk: file naming, contents, and --grep.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { goldensIn, matching, type Golden } from "../../src/testing/goldens.js";

async function aFolder(files: Record<string, unknown>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "goldens-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(folder, name), JSON.stringify(body), "utf8");
  }
  return folder;
}

const ONE = { state: { stage: "choose" }, input: ["¿el martes?"], expect: { tools: ["freeSlots"] } };

describe("what a golden is called", () => {
  it("is the file's own name, so a report names something a person can grep for", async () => {
    const folder = await aFolder({ "ofrece-el-martes.json": ONE });

    const [golden] = await goldensIn([join(folder, "ofrece-el-martes.json")]);

    expect(golden!.name).toBe("ofrece-el-martes");
  });

  it("is numbered when one file holds several, and left alone when a golden named itself", async () => {
    const folder = await aFolder({ "cases.json": [ONE, { ...ONE, name: "el propio" }] });

    const goldens = await goldensIn([join(folder, "cases.json")]);

    expect(goldens.map((one) => one.name)).toEqual(["cases #1", "el propio"]);
  });
});

describe("which goldens a run walks", () => {
  it("reads a directory one level deep, sorted, and skips what is not a golden file", async () => {
    const folder = await aFolder({ "b.json": ONE, "a.json": ONE });
    await writeFile(join(folder, "notes.md"), "not a golden", "utf8");

    const goldens = await goldensIn([folder]);

    expect(goldens.map((one) => one.name)).toEqual(["a", "b"]);
  });

  it("keeps the goldens whose name carries the text, whatever its case", async () => {
    const goldens = [{ name: "ofrece-el-martes" }, { name: "identifica" }] as Golden[];

    expect(matching(goldens, "MARTES").map((one) => one.name)).toEqual(["ofrece-el-martes"]);
  });

  it("keeps all of them when nobody narrowed the run", async () => {
    const goldens = [{ name: "uno" }, { name: "dos" }] as Golden[];

    expect(matching(goldens, undefined)).toHaveLength(2);
  });
});

describe("an agent with no goldens yet", () => {
  it("answers none for the default folder that is not there, never an ENOENT", async () => {
    // A missing goldens folder yields an empty list, not ENOENT.
    const folder = await mkdtemp(join(tmpdir(), "no-goldens-"));
    const before = process.cwd();
    process.chdir(folder);
    try {
      expect(await goldensIn([])).toEqual([]);
    } finally {
      process.chdir(before);
    }
  });
});
