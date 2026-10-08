// What a CLI core writes, kept as a tool's lines: never this process's stdout.

import { describe, expect, it } from "vitest";

import { collected } from "../../src/mcp/collected.js";

describe("lines collected", () => {
  it("are what was written, split, with no blank line", async () => {
    const lines = collected();
    lines.stream.write("front-desk · attached\n\n");
    lines.stream.write("second line\n");

    expect(lines.lines()).toEqual(["front-desk · attached", "second line"]);
  });
});
