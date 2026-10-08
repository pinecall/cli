// The testing tools from an assistant: refusals in the person's words, and what each sends the gateway.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { A_PROJECTS_KEY, aClient, aProject, called, FakeGateway } from "../fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

async function opened(root = aProject(A_PROJECTS_KEY, gateway.url)) {
  const { client } = await aClient();
  await called(client, "project", { action: "open", path: root });
  return client;
}

describe("judges", () => {
  it("refuses a name that is no slug, and an add with no question", async () => {
    const client = await opened();

    expect((await called(client, "judges", { action: "add", name: "Offers A Callback", asks: "x" })).text).toContain("lowercase letters and digits joined by dashes");
    expect((await called(client, "judges", { action: "add", name: "offers-a-callback" })).text).toBe("add takes the question the judge asks");
  });

  it("puts the question on the agent's judges, or the org's", async () => {
    gateway.doors.set("PUT /v1/agents/front-desk/judges/offers-a-callback", [200, { judges: [] }]);
    gateway.doors.set("PUT /v1/org/judges/no-medical-advice", [200, { judges: [] }]);
    const client = await opened();

    await called(client, "judges", { action: "add", name: "offers-a-callback", asks: " The agent offered a call back. " });
    await called(client, "judges", { action: "add", name: "no-medical-advice", asks: "No medical advice.", org: true, on: "simulations" });

    expect(gateway.asked.map((one) => one.body)).toEqual([
      { question: "The agent offered a call back.", runs_on: "every-call" },
      { question: "No medical advice.", runs_on: "simulations" },
    ]);
  });
});

describe("personas", () => {
  it("needs a goal and a style to write one", async () => {
    gateway.doors.set("GET /v1/agents/front-desk/personas", [200, { personas: [] }]);
    const client = await opened();

    expect((await called(client, "personas", { action: "add", name: "hurried", goal: "a refund" })).text).toBe("a persona needs a goal and a style: what they want, and how they talk");
  });
});

describe("runs", () => {
  it("refuses a drift whose baseline is no longer than its window", async () => {
    const client = await opened();

    expect((await called(client, "runs", { action: "drift", window_days: 30, baseline_days: 7 })).text).toContain("longer than the window");
  });
});

describe("docs", () => {
  it("names the folder to fill when there is nothing to push, and the golden to write when there is none", async () => {
    const root = aProject(A_PROJECTS_KEY, gateway.url);
    const client = await opened(root);

    expect((await called(client, "docs", { action: "push" })).text).toBe(`nothing to push: put Markdown files under ${join(root, "docs", "front-desk")}, one subject a file`);
    expect((await called(client, "docs", { action: "eval" })).text).toContain(join(root, "test", "front-desk", "goldens", "docs.json"));
  });

  it("pushes the folder as the agent's base, one file per document", async () => {
    gateway.doors.set("PUT /v1/knowledge/front-desk", [200, { base: "front-desk", chunks: 2, took_ms: 10 }]);
    const root = aProject(A_PROJECTS_KEY, gateway.url);
    mkdirSync(join(root, "docs", "front-desk"), { recursive: true });
    writeFileSync(join(root, "docs", "front-desk", "refunds.md"), "# Refunds\n\nTen working days.\n");
    const client = await opened(root);

    const answer = JSON.parse((await called(client, "docs", { action: "push" })).text);

    expect(answer).toMatchObject({ files: 1, base: "front-desk", chunks: 2 });
    expect((gateway.asked[0]!.body as { files: { path: string }[] }).files.map((file) => file.path)).toEqual(["refunds.md"]);
  });
});

describe("deploy", () => {
  it("refuses a Ruby project, which Pinecall does not host", async () => {
    const client = await opened(aProject(A_PROJECTS_KEY, gateway.url, "agent.rb"));

    expect((await called(client, "deploy", { action: "deploy", name: "desk" })).text).toContain("agents/front-desk/agent.rb");
  });

  it("refuses a project that does not depend on what Pinecall starts it with", async () => {
    const root = aProject(A_PROJECTS_KEY, gateway.url);
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: {} }));
    const client = await opened(root);

    expect((await called(client, "deploy", { action: "deploy", name: "desk" })).text).toContain("pinecall");
  });
});

describe("eval", () => {
  it("sends the banned words and the budget as the replay's policy", async () => {
    gateway.doors.set("POST /v1/evals/replay/call_1", [200, { call: "call_1", passed: true, verdicts: [] }]);
    const client = await opened();

    await called(client, "eval", { call: "call_1", banned: ["refund"], budget: { e2e_latency: 2 } });

    expect(gateway.asked[0]!.body).toEqual({ banned: ["refund"], budget: { e2e_latency: 2 } });
  });
});
