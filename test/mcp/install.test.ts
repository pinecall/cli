// `pinecall mcp install`: one entry written into every assistant here, everything else in each file left as it was.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { inJson, inToml } from "../../src/mcp/install/configs.js";
import { entryFor, hosts } from "../../src/mcp/install/hosts.js";
import { installEverywhere, listed } from "../../src/mcp/install/installing.js";

const ENTRY = { command: "npx", args: ["-y", "pinecall@latest", "mcp"] };

describe("a JSON config", () => {
  it("gains Pinecall beside the servers and settings already there", () => {
    const before = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } });

    const after = JSON.parse(inJson(before, "f.json", "mcpServers", ENTRY));

    expect(after).toEqual({ theme: "dark", mcpServers: { other: { command: "x" }, pinecall: ENTRY } });
  });

  it("has an older Pinecall entry replaced, not merged", () => {
    const before = JSON.stringify({ mcpServers: { pinecall: { command: "old", args: [], env: { PINECALL_API_KEY: "x" } } } });

    expect(JSON.parse(inJson(before, "f.json", "mcpServers", ENTRY)).mcpServers.pinecall).toEqual(ENTRY);
  });

  it("loses only Pinecall when it is removed", () => {
    const before = JSON.stringify({ mcpServers: { other: { command: "x" }, pinecall: ENTRY } });

    expect(JSON.parse(inJson(before, "f.json", "mcpServers", null))).toEqual({ mcpServers: { other: { command: "x" } } });
  });

  it("that is broken is refused, naming the file, rather than overwritten", () => {
    expect(() => inJson("{ nope", "/home/x/.claude.json", "mcpServers", ENTRY)).toThrow("/home/x/.claude.json is not valid JSON");
  });
});

describe("a TOML config", () => {
  const BEFORE = '# my codex\nmodel = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n';

  it("gains Pinecall's section, its comments and other sections untouched", () => {
    const after = inToml(BEFORE, "mcp_servers", ENTRY);

    expect(after.startsWith(BEFORE.trimEnd())).toBe(true);
    expect(after).toContain('[mcp_servers.pinecall]\ncommand = "npx"\nargs = ["-y", "pinecall@latest", "mcp"]\n');
  });

  it("has its Pinecall section replaced in place, and removed whole", () => {
    const once = inToml(BEFORE, "mcp_servers", { command: "old", args: [] });

    expect(inToml(once, "mcp_servers", ENTRY)).toBe(inToml(BEFORE, "mcp_servers", ENTRY));
    expect(inToml(inToml(BEFORE, "mcp_servers", ENTRY), "mcp_servers", null).trimEnd()).toBe(BEFORE.trimEnd());
  });
});

describe("installing everywhere", () => {
  it("writes the installed assistants only, backs up what it touched, and repairs on a second run", () => {
    const home = mkdtempSync(join(tmpdir(), "pinecall-hosts-"));
    mkdirSync(join(home, ".claude"));
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ theme: "dark" }));
    mkdirSync(join(home, ".codex"));

    const first = installEverywhere(false, home);
    const again = installEverywhere(false, home);

    expect(first.filter((one) => one.did === "added").map((one) => one.host.name).sort()).toEqual(["claude", "codex"]);
    expect(again.filter((one) => one.did === "replaced").map((one) => one.host.name).sort()).toEqual(["claude", "codex"]);
    expect(first.find((one) => one.host.name === "cursor")?.did).toBe("not installed");
    expect(existsSync(join(home, ".claude.json.bak"))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"))).toMatchObject({ theme: "dark", mcpServers: { pinecall: ENTRY } });
  });

  it("names the newest published CLI, never the bare name a project's older copy would answer to", () => {
    const [claude] = hosts(mkdtempSync(join(tmpdir(), "pinecall-hosts-")));

    expect(entryFor(claude!).args[1]).toBe("pinecall@latest");
  });

  it("gives a desktop app npx by its full path and node's folder on its PATH, which it launches without", () => {
    const desktop = hosts(mkdtempSync(join(tmpdir(), "pinecall-hosts-"))).find((one) => one.name === "claude-desktop")!;

    const entry = entryFor(desktop);

    expect(entry.command).toBe(join(dirname(process.execPath), "npx"));
    expect(entry.env?.PATH.split(":")[0]).toBe(dirname(process.execPath));
  });

  it("never writes a key, and starts the server with nothing but mcp: it acts in both worlds", () => {
    const [claude] = hosts(mkdtempSync(join(tmpdir(), "pinecall-hosts-")));

    expect(JSON.stringify(entryFor(claude!))).not.toMatch(/KEY|key/);
    expect(entryFor(claude!).args).toEqual(["-y", "pinecall@latest", "mcp"]);
  });

  it("takes Pinecall out again, and lists every assistant with its state", () => {
    const home = mkdtempSync(join(tmpdir(), "pinecall-hosts-"));
    mkdirSync(join(home, ".cursor"));
    installEverywhere(false, home);

    expect(listed(home).find((line) => line.includes("Cursor"))).toContain("registered");
    expect(installEverywhere(true, home).find((one) => one.host.name === "cursor")?.did).toBe("removed");
    expect(listed(home).find((line) => line.includes("Cursor"))).toContain("not registered");
  });
});
