// The MCP's tool pages are what the tools say about themselves: a page that drifted from a schema, or an example a tool would refuse, fails here.

import { readFileSync } from "node:fs";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import { examples, pageOf, PAGES } from "../scripts/mcp-pages.js";
import { STAGES, TOOLS } from "../src/mcp/tools/all.js";

describe("the MCP's tool pages", () => {
  it("are each what scripts/mcp-pages writes from the tools today", () => {
    const kept = examples();

    for (const stage of STAGES) {
      expect(readFileSync(`${PAGES}${stage.page}.md`, "utf8"), `docs/mcp/${stage.page}.md is stale: run scripts/mcp-pages`).toBe(pageOf(stage, kept));
    }
  });

  it("show a real call of every tool, with arguments the tool takes", () => {
    const kept = examples();

    for (const tool of TOOLS) {
      const calls = kept[tool.name] ?? [];
      expect(calls.length, `${tool.name} has no example in docs/mcp/examples.json`).toBeGreaterThan(0);
      for (const call of calls) expect(() => z.object(tool.schema).strict().parse(call.args), tool.name).not.toThrow();
    }
    expect(Object.keys(kept).filter((name) => !TOOLS.some((tool) => tool.name === name))).toEqual([]);
  });

  it("each describe every parameter, the action included", () => {
    const silent = TOOLS.flatMap((tool) => {
      const { properties } = z.toJSONSchema(z.object(tool.schema)) as { properties?: Record<string, { description?: string }> };
      return Object.entries(properties ?? {}).filter(([, field]) => (field.description ?? "") === "").map(([name]) => `${tool.name}.${name}`);
    });

    expect(silent).toEqual([]);
  });

  it("are each linked from the page of the server", () => {
    const page = readFileSync(new URL("../docs/the-mcp.md", import.meta.url), "utf8");

    expect(STAGES.filter((stage) => !page.includes(`(mcp/${stage.page}.md)`)).map((stage) => stage.page)).toEqual([]);
  });

  it("hold no key, no login code and no path of the machine they were recorded on", () => {
    const text = readFileSync(`${PAGES}examples.json`, "utf8");

    expect(text).not.toMatch(/pc_(live|test)_[A-Za-z0-9]|lc_[A-Za-z0-9]{6}|\/private\/|\/Users\/(?!you\/)/);
  });
});
