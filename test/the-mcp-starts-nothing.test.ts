// The MCP server never starts a process: nothing it can reach imports child_process or cluster.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SPAWNERS = ["node:child_process", "child_process", "node:cluster", "cluster"];

// Matched after comments are stripped, as the-imports does; the last alternative is a dynamic import.
const STATIC = /^(?:import|export)[\s\S]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm;
const DYNAMIC = /\bimport\("([^"]+)"\)/g;

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The modules a file imports: relative ones resolved to their .ts file, packages as written. */
function importsOf(file: string, dynamic: boolean): string[] {
  const text = withoutComments(readFileSync(file, "utf8"));
  const found = [...text.matchAll(STATIC)].map((match) => match[1] ?? match[2] ?? "");
  if (dynamic) found.push(...[...text.matchAll(DYNAMIC)].map((match) => match[1] ?? ""));
  return found.filter((spec) => spec !== "").map((spec) => (spec.startsWith(".") ? resolve(dirname(file), spec.replace(/\.js$/, ".ts")) : spec));
}

/** Every chain from `start` to a spawner, following static imports and, when asked, dynamic ones. */
function chainsToASpawner(start: string, dynamic: boolean): string[] {
  const chains: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, path: string[]): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of importsOf(file, dynamic)) {
      if (SPAWNERS.includes(next)) chains.push([...path, next].join(" → "));
      else if (next.startsWith("/") && existsSync(next)) walk(next, [...path, next.slice(SRC.length + 1)]);
    }
  };
  walk(start, [start.slice(SRC.length + 1)]);
  return chains;
}

describe("the MCP server", () => {
  it("reaches no module that imports child_process or cluster, statically or dynamically", () => {
    expect(chainsToASpawner(join(SRC, "mcp", "index.ts"), true)).toEqual([]);
  });

  it("is dispatched by a CLI entry whose static imports start nothing either", () => {
    expect(chainsToASpawner(join(SRC, "index.ts"), false)).toEqual([]);
  });

  it("would be caught: a CLI verb that does spawn is found by the same walk", () => {
    expect(chainsToASpawner(join(SRC, "chat.ts"), true).length).toBeGreaterThan(0);
  });
});
