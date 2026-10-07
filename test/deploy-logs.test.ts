// `pinecall deploy logs`: what a follow prints of a newer read of an app's last lines.

import { describe, expect, it } from "vitest";

import { newLines } from "../src/deploy-logs.js";

describe("a follow prints only what came after", () => {
  it("prints the lines after the part two reads share", () => {
    expect(newLines("a\nb\nc\n", "b\nc\nd\ne\n")).toEqual(["d", "e"]);
  });

  it("prints nothing when nothing came", () => {
    expect(newLines("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("prints the whole read when the two share nothing, as after a restart", () => {
    expect(newLines("a\nb\n", "x\ny\n")).toEqual(["x", "y"]);
  });
});
