// The version this CLI says it is: package.json's, three numbers.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { version } from "../src/version.js";

describe("the CLI's version", () => {
  it("is the one package.json declares", () => {
    const declared = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

    expect(version()).toBe(declared);
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
