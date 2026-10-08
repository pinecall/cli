// The `cases` tool from an assistant: the same cores as `pinecall cases`, what each action sends, and its refusals.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { A_NOTE_ALONE } from "../../../src/testing/cases.js";
import { A_PROJECTS_KEY, aClient, aProject, called, FakeGateway } from "../fake.js";

const A_CASE = {
  id: "case_1",
  agent: "front-desk",
  name: "promises-me-llaman-manana-por-29d7c7",
  golden: { name: "promises-me-llaman-manana-por-29d7c7", input: ["Me llaman mañana"], expect: { judges: ["promises"] }, promoted_from: "call_29d7c7" },
  source_call: "call_29d7c7",
  source_env: "sandbox",
  held_out: false,
  author: "the hang-up panel",
  created_at: 1790000000,
  status: "pending",
  broke: [{ judge: "promises", reason: "it promised a call back nobody will make" }],
};

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
  gateway.doors.set("GET /v1/evals/cases?agent=front-desk", [200, { cases: [A_CASE], pending: 1, pending_at_most: 50 }]);
});

afterEach(async () => {
  await gateway.close();
});

async function opened(root = aProject(A_PROJECTS_KEY, gateway.url)) {
  const { client } = await aClient();
  await called(client, "project", { action: "open", path: root });
  return client;
}

describe("cases", () => {
  it("lists the agent's cases with the defaults the gateway left out written in", async () => {
    const client = await opened();

    const answer = JSON.parse((await called(client, "cases", { action: "list" })).text);

    expect(answer.pending).toBe(1);
    expect(answer.cases[0]).toMatchObject({ name: A_CASE.name, status: "pending", kept_in_repo: false, source_version: null });
  });

  it("dismisses one by its name, the judge called wrong and the note beside it", async () => {
    gateway.doors.set("PATCH /v1/evals/cases/case_1", [200, { ...A_CASE, status: "dismissed" }]);
    const client = await opened();

    await called(client, "cases", { action: "dismiss", name: A_CASE.name, judge_was_wrong: "promises", note: "it did call back" });

    expect(gateway.asked.at(-1)).toEqual({ door: "PATCH /v1/evals/cases/case_1", body: { status: "dismissed", judge_was_wrong: "promises", note: "it did call back" } });
  });

  it("pulls one into the agent's goldens folder, then marks it kept in the repository", async () => {
    gateway.doors.set("PATCH /v1/evals/cases/case_1", [200, { ...A_CASE, kept_in_repo: true }]);
    const root = aProject(A_PROJECTS_KEY, gateway.url);
    const client = await opened(root);

    const answer = JSON.parse((await called(client, "cases", { action: "pull", name: A_CASE.name })).text);

    expect(answer.path).toContain(join("test", "front-desk", "goldens", `${A_CASE.name}.json`));
    expect(JSON.parse(readFileSync(answer.path, "utf8"))).toEqual(A_CASE.golden);
    expect(gateway.asked.at(-1)).toEqual({ door: "PATCH /v1/evals/cases/case_1", body: { kept_in_repo: true } });
  });

  it("refuses a name the agent has none of, a note with no judge, and a keep with no call", async () => {
    const client = await opened();

    expect((await called(client, "cases", { action: "show", name: "jueves-tarde" })).text).toContain("front-desk has no case named jueves-tarde");
    expect((await called(client, "cases", { action: "dismiss", name: A_CASE.name, note: "why" })).text).toBe(A_NOTE_ALONE);
    expect((await called(client, "cases", { action: "keep", name: "jueves-tarde" })).text).toBe("keep takes the finished call and the name the case is played by");
  });
});
