// The console reproduction door: listing and reading files, and path refusals.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { reproducingFrom } from "../../src/ui/reproducing.js";

const RUN = "run_0f3a";

/** A run folder with one file per failed golden. */
function aBrokenRun(): string {
  const under = mkdtempSync(join(tmpdir(), "pinecall-repro-"));
  mkdirSync(join(under, RUN), { recursive: true });
  writeFileSync(
    join(under, RUN, "pide-la-ficha.json"),
    JSON.stringify({ run: RUN, golden: "pide-la-ficha", asked: [{ role: "system" }] }),
  );
  writeFileSync(join(under, RUN, "confirma-la-cita.json"), JSON.stringify({ run: RUN, golden: "confirma-la-cita" }));
  writeFileSync(join(under, "secrets.json"), JSON.stringify({ never: "read" }));
  return under;
}

describe("what a run left behind", () => {
  it("names every golden that was written out, and where the folder is", async () => {
    const door = reproducingFrom(aBrokenRun());

    expect(await door.roster({ run: RUN })).toMatchObject({
      run: RUN,
      goldens: ["confirma-la-cita", "pide-la-ficha"],
    });
  });

  it("reads one of them whole, requests and all", async () => {
    const door = reproducingFrom(aBrokenRun());

    expect(await door.read({ run: RUN, golden: "pide-la-ficha" })).toMatchObject({
      golden: "pide-la-ficha",
      asked: [{ role: "system" }],
    });
  });

  it("says where it looked when a run left nothing", async () => {
    const door = reproducingFrom(aBrokenRun());

    await expect(door.roster({ run: "run_green" })).rejects.toMatchObject({ status: 404 });
    await expect(door.read({ run: RUN, golden: "never-ran" })).rejects.toMatchObject({ status: 404 });
  });

  // Both path parts come from the browser; neither may escape the folder.
  it("refuses a name that is a path", async () => {
    const door = reproducingFrom(aBrokenRun());

    await expect(door.read({ run: RUN, golden: "../secrets" })).rejects.toMatchObject({ status: 422 });
    await expect(door.roster({ run: "../.." })).rejects.toMatchObject({ status: 422 });
  });
});
