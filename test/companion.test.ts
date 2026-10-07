// The CLI's own socket beside the agent's process: it answers the console, takes no call, declares nothing.

import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { FakeGateway } from "@pinecall/agents/client/testing";
import { COMPANION_SDK, companionFor, type Companion } from "../src/companion.js";
import { homeOf } from "../src/home.js";
import type { Serving } from "../src/serving.js";
import { written } from "./said.js";

const KEY = "pk_test";
const HOME = homeOf(fileURLToPath(new URL("./clinic/agents/clinica-norte/agent.tsx", import.meta.url)));

const SERVING: Serving = { app: () => "app_9", registered: async () => "app_9", onEvent: () => () => undefined };

let gateway: FakeGateway | null = null;
let companion: Companion | null = null;

afterEach(async () => {
  await companion?.close();
  await gateway?.close();
  companion = null;
  gateway = null;
});

async function connected(): Promise<FakeGateway> {
  const held = await FakeGateway.start({ apiKey: KEY });
  gateway = held;
  companion = companionFor({ url: held.url, apiKey: KEY, world: "sandbox" }, [HOME], SERVING, written().stream);
  await companion.pc.connect();
  return held;
}

async function until(found: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !found(); tries += 1) await new Promise((wake) => setTimeout(wake, 5));
  expect(found()).toBe(true);
}

describe("the companion socket", () => {
  it("registers as the one that answers the console, takes no call, and says it is the CLI", async () => {
    const held = await connected();

    expect(held.commandsOf("agent.register")[0]?.data).toMatchObject({
      takes_unclaimed: false,
      answers_dev: true,
      sdk: COMPANION_SDK,
    });
    expect(COMPANION_SDK).toMatch(/^pinecall-cli\//);
  });

  // A registration inherits the agent's process's declaration; one sent from here would replace it.
  it("sends no declaration of its own", async () => {
    const held = await connected();

    expect(held.commandsOf("agent.configure")).toEqual([]);
  });

  it("answers a golden roster from the agent's folder, and leaves view.render to the class's process", async () => {
    const held = await connected();
    held.emit("clinica-norte", null, "dev.request", { id: "dev_1", verb: "goldens.roster", data: {} });
    held.emit("clinica-norte", null, "dev.request", { id: "dev_2", verb: "view.render", data: { contact: "c", call: "CA_1" } });
    await until(() => held.commandsOf("dev.answer").length === 2);

    const answers = held.commandsOf("dev.answer").map((answer) => answer.data);
    expect(answers).toContainEqual({ id: "dev_1", result: expect.objectContaining({ agent: "clinica-norte" }) });
    expect(answers).toContainEqual({ id: "dev_2", refused: expect.objectContaining({ status: 404 }) });
  });
});
