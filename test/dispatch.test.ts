// The dispatcher: every designed group is declared, and unbuilt ones say so.

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PLANNED, notBuiltYet, plannedGroup } from "../src/groups.js";
import { builtNames, groupFor, groupNames, main, usage } from "../src/index.js";
import { written } from "./said.js";

// A stream that keeps what was written, so a test can read output as a string.
function collected(): { stream: NodeJS.WritableStream; text(): string } {
  const written: string[] = [];
  const stream = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => written.join("") };
}

describe("the groups the CLI answers to", () => {
  // One name per idea: the gateway, console and runtime CLI all say `numbers`, not `phones`.
  it("declares every group of the design's verb list", () => {
    const declared = groupNames();

    expect(declared).not.toContain("phones");

    for (const group of ["new", "generate", "link", "start", "chat", "prompt", "test", "simulate", "runs", "cases", "personas", "eval", "sessions", "docs", "memory", "login", "whoami", "tokens", "numbers", "agent", "lexicon", "supervise", "observe", "call", "costs", "deploy"]) {
      expect(declared).toContain(group);
    }
  });

  it("answers `g` as `generate`, as a person who knows `rails g` types it", async () => {
    expect(await groupFor("g")).toBe(await groupFor("generate"));
  });

  it("tells a person what a group that does not exist yet will be, and leaves with a zero", async () => {
    const out = collected();

    const code = await main(["costs"], out.stream);

    expect(out.text()).toBe("costs is not built yet: what the calls cost, by agent, model or channel\n");
    expect(code).toBe(0);
  });

  // `talk` is a console screen served by the box, not a verb. `console` is built: it only opens a
  // browser at the box.
  it("holds a built `console` verb and no `talk` of its own", () => {
    expect(Object.keys(PLANNED)).not.toContain("console");
    expect(builtNames()).toContain("console");
    expect(Object.keys(PLANNED)).not.toContain("talk");
    expect(groupNames()).not.toContain("talk");
  });

  it("names the verb and its purpose, so the line reads without the table beside it", () => {
    expect(notBuiltYet("costs", PLANNED["costs"]!)).toBe(
      "costs is not built yet: what the calls cost, by agent, model or channel",
    );
  });

  it("refuses a group nobody declared, with the usage a person can read", async () => {
    const out = collected();
    const err = collected();

    const code = await main(["fly"], out.stream, err.stream);

    expect(code).toBe(2);
    expect(err.text()).toContain("no such group: fly");
  });

  it("prints every group under --help, built and planned alike", async () => {
    const out = collected();

    expect(await main(["--help"], out.stream)).toBe(0);
    expect(out.text()).toContain("start     the app and its doors");
    expect(out.text()).toContain("supervise");
  });

  // Flags are documented per group; the console's old page-serving flags must not return.
  it("prints a group's own help under its own name, and names no console flag", async () => {
    const out = collected();

    expect(await main(["start", "--help"], out.stream)).toBe(0);

    expect(out.text()).toContain("pinecall start — the app and its doors");
    expect(out.text()).toContain("--show-prompt");
    expect(out.text()).not.toContain("--console");
    expect(out.text()).not.toContain("--open");
  });

  it("prints the group's help when --help comes after a subverb", async () => {
    const out = collected();

    expect(await main(["memory", "policy", "--help"], out.stream)).toBe(0);

    expect(out.text()).toContain("pinecall memory policy");
  });

  it("marks every planned group as such in the usage, so no verb reads as built", () => {
    for (const [name, purpose] of Object.entries(PLANNED)) {
      expect(usage()).toContain(`${name.padEnd(10)}${purpose} — not built yet`);
    }
  });

  // A verb that reaches no gateway refuses --prod, since the flag would imply production was consulted.
  it("refuses --prod on a verb that reaches no gateway", async () => {
    const err = collected();

    const code = await main(["prompt", "--prod", "--state", "nothing.json"], collected().stream, err.stream);

    expect(code).toBe(2);
    expect(err.text()).toContain("prompt reaches no gateway, so --prod names nothing");
  });

  // Node's parse error mentions `--` and positionals; name the verb and its help instead.
  it("names the verb and its help when a flag is not one of that verb's", async () => {
    const err = collected();

    const code = await main(["whoami", "--json"], collected().stream, err.stream);

    expect(code).toBe(2);
    expect(err.text()).toContain("pinecall: no such flag for whoami: '--json'");
    expect(err.text()).toContain("`pinecall whoami --help`");
  });

  it("prints nothing but the line when a planned group runs", () => {
    const out = collected();

    plannedGroup("costs", PLANNED["costs"]!, out.stream).run([]);

    expect(out.text()).toBe("costs is not built yet: what the calls cost, by agent, model or channel\n");
  });
});

