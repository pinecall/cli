// `pinecall prompt --state`: the loader, the goldens file, and every block under its header in order.

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { main } from "../src/index.js";
import { firstState, run } from "../src/prompt.js";

const AGENT = fileURLToPath(new URL("./clinic/agents/clinica-norte/agent.tsx", import.meta.url));
const GOLDENS = fileURLToPath(new URL("./choose.json", import.meta.url));

function collected(): { stream: NodeJS.WritableStream; text(): string } {
  const written: string[] = [];
  const stream = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => written.join("") };
}

describe("the goldens file a state comes from", () => {
  it("takes the first case unless --case names another", () => {
    expect(firstState(GOLDENS, undefined)).toMatchObject({ patient: { name: "Ana García" } });
    expect(firstState(GOLDENS, "1")).toMatchObject({ slots: [{ when: "martes 16:00" }] });
  });

  it("refuses a case the file does not have, by number", () => {
    expect(() => firstState(GOLDENS, "9")).toThrow(/no case 9/);
  });
});

describe("the prompt a state would produce", () => {
  it("prints every block under its header, the static ones before the history and the view after it", async () => {
    const out = collected();

    const code = await run([AGENT, "--state", GOLDENS], out.stream);

    expect(code).toBe(0);
    const printed = out.text();
    expect(printed.indexOf("── identity (static) ──")).toBe(0);
    expect(printed.indexOf("── tools (static) ──")).toBeLessThan(printed.indexOf("── history ──"));
    expect(printed.indexOf("── history ──")).toBeLessThan(printed.indexOf("── view (dynamic) ──"));
  });

  it("renders the view against the state the goldens describe, not against a fresh instance", async () => {
    const out = collected();

    await run([AGENT, "--state", GOLDENS, "--case", "1"], out.stream);

    // Case 1 has a patient and one slot: the view takes the identified branch.
    expect(out.text()).toContain("Ofrece 1 horas");
  });

  // Exit codes: 1 means a measurement failed or a gateway refused, 2 means the command cannot run
  // as typed. Refusals thrown deep must still exit 2, not 1 via the dispatcher's generic catch.
  it("exits 2 for a case the golden does not have, not 1", async () => {
    const err = collected();

    const code = await main(["prompt", AGENT, "--state", GOLDENS, "--case", "99"], collected().stream, err.stream);

    expect(code).toBe(2);
    expect(err.text()).toContain("has no case 99");
  });

  it("shows the channel block a phone call gets, unless --channel and --medium name another call", async () => {
    const byPhone = collected();
    const onAPage = collected();

    await run([AGENT, "--state", GOLDENS], byPhone.stream);
    await run([AGENT, "--state", GOLDENS, "--channel", "web", "--medium", "text"], onAPage.stream);

    expect(byPhone.text()).toContain("<channel>\nYou are on a phone call.");
    expect(onAPage.text()).toContain("<channel>\nYou are in a written chat on a website.");
    expect(onAPage.text()).not.toContain("You are on a phone call.");
  });

  it("refuses a channel or a medium no call has", async () => {
    const err = collected();

    expect(await run([AGENT, "--state", GOLDENS, "--channel", "fax"], collected().stream, err.stream)).toBe(2);
    expect(await run([AGENT, "--state", GOLDENS, "--medium", "video"], collected().stream, err.stream)).toBe(2);
    expect(err.text()).toContain("--channel is phone, web or whatsapp, and --medium is voice or text");
  });

  // The CLI reads the goldens file; the agent's process is handed the state field by field.
  it("starts the agent's serve entry with the case's state as pairs, the slug its folder's name", async () => {
    const asked: string[][] = [];
    const code = await run([AGENT, "--state", GOLDENS, "--case", "1"], collected().stream, collected().stream, async (started) => {
      asked.push(started.command);
      return 0;
    });

    expect(code).toBe(0);
    const command = asked[0]!;
    expect(command.slice(command.indexOf("prompt"))).toEqual([
      "prompt", "--file", AGENT, "--slug", "clinica-norte",
      ...Object.entries(firstState(GOLDENS, "1")).flatMap(([field, value]) => ["--state", `${field}=${JSON.stringify(value)}`]),
      "--channel", "phone", "--show-machine",
    ]);
  });

  it("asks for the state file rather than guessing one", async () => {
    const err = collected();

    expect(await run([AGENT], collected().stream, err.stream)).toBe(2);
    expect(err.text()).toContain("--state <file> is required");
  });
});
