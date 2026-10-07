// The console knowledge door: roster, push and refusals.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { knowingFrom, type Here } from "../../src/ui/knowing.js";
import type { Door } from "../../src/testing/gateway.js";

const DOOR: Door = { url: "http://127.0.0.1:1", apiKey: "pk_never_sent_anywhere", world: "sandbox" };

/** Two documents and a one-question golden. */
function aDirectory(): Here {
  const root = mkdtempSync(join(tmpdir(), "pinecall-knowledge-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "horarios.md"), "# Horarios\n");
  writeFileSync(join(root, "docs", "precios.md"), "# Precios\n");
  writeFileSync(join(root, "golden.json"), JSON.stringify([{ asks: "¿a qué hora abren?", expects: "Horarios" }]));
  return { agent: "clinica-norte", directory: join(root, "docs"), golden: join(root, "golden.json") };
}

describe("what this directory holds", () => {
  it("counts the markdown under it and the questions beside it", async () => {
    const here = aDirectory();
    const door = knowingFrom(DOOR, here.agent, async () => here);

    expect(await door.roster()).toMatchObject({ agent: "clinica-norte", base: "clinica-norte", files: 2, questions: 1 });
  });

  it("says there is nothing here when no class stands in this directory", async () => {
    const door = knowingFrom(DOOR, null, async () => ({ agent: null, directory: null, golden: null }));

    expect(await door.roster()).toMatchObject({ agent: null, files: 0, golden: null, questions: 0 });
  });
});

describe("pushing it", () => {
  it("refuses another agent: the files are the ones in this directory", async () => {
    const here = aDirectory();
    const door = knowingFrom(DOOR, here.agent, async () => here);

    await expect(door.push({ agent: "tienda-sur" })).rejects.toMatchObject({ status: 409 });
    await expect(door.measure({ agent: "tienda-sur" })).rejects.toMatchObject({ status: 409 });
  });

  it("says where it looked when the directory is not there, and knocks at no door", async () => {
    const gone: Here = { agent: "clinica-norte", directory: "/nowhere/docs/clinica-norte", golden: "/nowhere/golden.json" };
    const door = knowingFrom(DOOR, gone.agent, async () => gone);

    await expect(door.push({ agent: "clinica-norte" })).rejects.toMatchObject({
      status: 404,
      message: "no documents directory at /nowhere/docs/clinica-norte",
    });
    await expect(door.measure({ agent: "clinica-norte" })).rejects.toMatchObject({ status: 404 });
  });
});
