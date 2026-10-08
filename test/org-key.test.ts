// A project's key as data: the key written into .env (0600), the gateway only when it is not Cloud, the org by its name.

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CLOUD_URL } from "../src/env.js";
import { keyIn, keyWritten, slugOf } from "../src/org-key.js";

describe("the key a project runs on", () => {
  it("is written alone into .env, readable by nobody else, for Pinecall Cloud", () => {
    const root = mkdtempSync(join(tmpdir(), "pinecall-link-"));

    const { file, names } = keyWritten(root, CLOUD_URL, "pc_key");

    expect(names).toEqual(["PINECALL_KEY"]);
    expect(readFileSync(file, "utf8")).toBe("PINECALL_KEY=pc_key\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("carries the gateway too when it is somebody's own", () => {
    const root = mkdtempSync(join(tmpdir(), "pinecall-link-"));

    const { file, names } = keyWritten(root, "http://127.0.0.1:8080", "pc_key");

    expect(names).toEqual(["PINECALL_KEY", "PINECALL_URL"]);
    expect(readFileSync(file, "utf8")).toContain("PINECALL_URL=http://127.0.0.1:8080\n");
  });

  it("is the machine's own key when the org chosen is the one it already opens, minting nothing", async () => {
    const door = { url: "http://unreachable.invalid", apiKey: "pc_machine", world: "production" as const };

    expect(await keyIn(door, { org: "org_1", here: true })).toBe("pc_machine");
  });

  it("names an org by its slug, or by its id when it has none", () => {
    expect(slugOf({ org: "org_1", slug: "clinica", here: false })).toBe("clinica");
    expect(slugOf({ org: "org_1", here: false })).toBe("org_1");
  });
});
