// What the CLI may import: the framework's client and wire, never the framework itself.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * The packages src/ may import, besides node's own. A class runs in its language's serve entry,
 * so `@pinecall/agents` bare (the class) and `@pinecall/agents/serve` are never here. `tsx` loads a
 * project's legacy persona files and `@livekit/rtc-node` is `simulate --listen`'s; both lazily. The
 * MCP SDK and zod are the `mcp` group's alone; `ignore` reads a project's .gitignore files for `deploy`.
 */
const MAY_IMPORT = ["@pinecall/agents/client", "@pinecall/agents/wire", "ws", "tsx", "@livekit/rtc-node", "@modelcontextprotocol/sdk", "zod", "ignore"];

/** The MCP server's own packages: imported under src/mcp/ and nowhere else, so no verb pays for them. */
const THE_MCPS = ["@modelcontextprotocol/sdk", "zod"];

// Matched after comments are stripped. The third alternative catches dynamic `import("x")`.
const SPECIFIER = /^(?:import|export)[\s\S]*?from\s+"([^"]+)"|^import\s+"([^"]+)"|\bimport\("([^"]+)"\)/gm;

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every package a file of src/ imports, by the file. */
function packages(): { file: string; spec: string }[] {
  const found: { file: string; spec: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (extname(full) === ".ts") {
        for (const [, named, bare, lazy] of withoutComments(readFileSync(full, "utf8")).matchAll(SPECIFIER)) {
          const spec = named ?? bare ?? lazy;
          if (spec !== undefined && !spec.startsWith(".") && !spec.startsWith("node:")) found.push({ file: relative(SRC, full), spec });
        }
      }
    }
  };
  walk(SRC);
  return found;
}

const allowed = (spec: string): boolean => MAY_IMPORT.some((one) => spec === one || spec.startsWith(`${one}/`));

describe("the CLI's imports", () => {
  it("are the framework's client and wire and the few packages named, never the class", () => {
    const broken = packages().filter(({ spec }) => !allowed(spec)).map(({ file, spec }) => `src/${file}: ${spec}`);

    expect(broken).toEqual([]);
  });

  it("keep the MCP server's packages under src/mcp/", () => {
    const outside = packages().filter(({ file, spec }) => THE_MCPS.some((one) => spec === one || spec.startsWith(`${one}/`)) && !file.startsWith("mcp/"));

    expect(outside.map(({ file, spec }) => `src/${file}: ${spec}`)).toEqual([]);
  });

  it("name nothing src/ does not actually import", () => {
    const used = new Set(packages().map(({ spec }) => MAY_IMPORT.find((one) => spec === one || spec.startsWith(`${one}/`))));

    expect(MAY_IMPORT.filter((one) => !used.has(one)), "delete the line, or the import it was written for is missing").toEqual([]);
  });
});
