// Linking a project from an assistant: the person's orgs listed, the key minted and written into .env, and never answered.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NOT_SIGNED_IN } from "../../src/mcp/tools/link.js";
import { signIn } from "../../src/signed-in.js";
import { A_PROJECTS_KEY, aClient, aProject, called, FakeGateway, THE_MACHINES_KEY } from "./fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

describe("link", () => {
  it("asks for a sign-in first when the machine has none", async () => {
    const { client } = await aClient();

    expect(await called(client, "link", { action: "orgs" })).toEqual({ text: NOT_SIGNED_IN, refused: true });
  });

  it("lists the person's orgs by their names", async () => {
    const { client, home } = await aClient();
    signIn(gateway.url, THE_MACHINES_KEY, home);

    expect(JSON.parse((await called(client, "link", { action: "orgs" })).text)).toEqual({ orgs: [{ slug: "clinica", this_machines: false }] });
  });

  it("writes the key minted in the org into the project's .env, answering everything but the key", async () => {
    const { client, home } = await aClient();
    signIn(gateway.url, THE_MACHINES_KEY, home);
    const root = aProject();
    writeFileSync(join(root, ".gitignore"), ".env\n");
    await called(client, "project", { action: "open", path: root });

    const answer = await called(client, "link", { action: "write" });

    expect(JSON.parse(answer.text)).toMatchObject({ org: "clinica", written: ["PINECALL_KEY", "PINECALL_URL"] });
    expect(answer.text).not.toContain(A_PROJECTS_KEY);
    expect(readFileSync(join(root, ".env"), "utf8")).toContain(`PINECALL_KEY=${A_PROJECTS_KEY}`);
  });

  it("warns when .gitignore does not name .env, since the key would be committed", async () => {
    const { client, home } = await aClient();
    signIn(gateway.url, THE_MACHINES_KEY, home);
    await called(client, "project", { action: "open", path: aProject() });

    expect(JSON.parse((await called(client, "link", { action: "write", org: "clinica" })).text)).toHaveProperty("warning");
  });

  it("refuses an org the person is no member of, naming the ones they are", async () => {
    const { client, home } = await aClient();
    signIn(gateway.url, THE_MACHINES_KEY, home);
    await called(client, "project", { action: "open", path: aProject() });

    const answer = await called(client, "link", { action: "write", org: "elsewhere" });

    expect(answer).toEqual({ text: "the person is no member of elsewhere: one of clinica", refused: true });
  });
});
