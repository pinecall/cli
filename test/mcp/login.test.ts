// Signing a machine in from an assistant: a link handed back, the approval waited for, the key kept and never shown.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { A_WORD, aClient, called, FakeGateway, THE_MACHINES_KEY } from "./fake.js";

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

describe("login", () => {
  it("hands back the sign-in link at once, for the person to open", async () => {
    const { client } = await aClient();

    const started = JSON.parse((await called(client, "login", { action: "start", gateway: gateway.url })).text) as { link: string };

    expect(started.link).toBe(`${gateway.url}/cli?c=${A_WORD}`);
  });

  it("says it is still waiting while nobody approved, with the link again", async () => {
    const { client } = await aClient();
    await called(client, "login", { action: "start", gateway: gateway.url });

    const status = JSON.parse((await called(client, "login", { action: "status", wait_s: 0 })).text) as { signed_in: boolean; waiting: boolean };

    expect(status).toMatchObject({ signed_in: false, waiting: true });
  });

  it("turns signed in once the person approves, keeping the key for the machine and never answering it", async () => {
    const { client, home } = await aClient();
    await called(client, "login", { action: "start", gateway: gateway.url });
    gateway.approved = true;

    const status = await called(client, "login", { action: "status", wait_s: 10 });

    expect(JSON.parse(status.text)).toMatchObject({ signed_in: true, gateway: gateway.url, as: "Berna" });
    expect(status.text).not.toContain(THE_MACHINES_KEY);
    expect(existsSync(join(home, "session.json"))).toBe(true);
    expect(readFileSync(join(home, "session.json"), "utf8")).toContain(THE_MACHINES_KEY);
  });

  it("says there is nothing in flight when status comes before start", async () => {
    const { client } = await aClient();

    expect(JSON.parse((await called(client, "login", { action: "status", wait_s: 0 })).text)).toMatchObject({ signed_in: false });
  });
});
