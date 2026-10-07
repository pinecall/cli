// One gateway serves both worlds: a verb knocks at PINECALL_URL with the project's key whatever
// the world, and `pinecall-env` says which — the sandbox without --prod, production with it.
// A server's token has one world, its prefix's, and `--prod` must agree.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { anotherWorldsToken, doorIn, doorLine, theDoor, type Open } from "../src/env.js";
import { readSession } from "../src/signed-in.js";
import { run as whoami, whoIs } from "../src/whoami.js";
import { inTheWorld } from "../src/world.js";
import { OneGateway, PERSONS_KEY } from "./one-gateway.js";
import { written } from "./said.js";

let gateway = new OneGateway();
let home = "";

beforeEach(async () => {
  gateway = new OneGateway();
  home = mkdtempSync(join(tmpdir(), "pinecall-home-"));
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

function environment(key: string = PERSONS_KEY): NodeJS.ProcessEnv {
  return { PINECALL_KEY: key, PINECALL_URL: gateway.url, PINECALL_HOME: home };
}

async function aVerb(prod: boolean, key?: string): Promise<Open | undefined> {
  const err = written().stream;
  const opened = (): Promise<Open | undefined> => theDoor(environment(key), err, home);
  const door = await (prod ? inTheWorld("production", opened) : opened());
  if (door !== undefined) await whoIs(door);
  return door;
}

describe("a person's key at one gateway", () => {
  it("knocks at PINECALL_URL saying `pinecall-env: sandbox` without --prod", async () => {
    const door = await aVerb(false);

    expect(door).toEqual({ url: gateway.url, apiKey: PERSONS_KEY, source: "the environment", world: "sandbox" });
    expect(gateway.heard).toEqual([expect.objectContaining({ path: "/v1/whoami", bearer: PERSONS_KEY, world: "sandbox" })]);
  });

  it("knocks at the same URL with the same key saying `pinecall-env: production` with --prod", async () => {
    const door = await aVerb(true);

    expect(door).toEqual({ url: gateway.url, apiKey: PERSONS_KEY, source: "the environment", world: "production" });
    expect(gateway.heard).toEqual([expect.objectContaining({ path: "/v1/whoami", bearer: PERSONS_KEY, world: "production" })]);
  });

  it("asks nobody where the sandbox is, mints nothing and keeps nothing", async () => {
    await aVerb(false);
    await aVerb(true);

    expect(gateway.heard.map((knock) => knock.path)).toEqual(["/v1/whoami", "/v1/whoami"]);
    expect(readSession(home).gateways).toEqual({});
  });

  it("is refused production in the gateway's words while the switch is off", async () => {
    gateway.opensProduction = false;

    await expect(aVerb(true)).rejects.toThrow("the gateway answered 403: Berna has no production access: an admin gives it in Team");
  });

  it("opens with a door line of three parts, and no instance", () => {
    const door = { url: gateway.url, apiKey: PERSONS_KEY, source: ".env", world: "sandbox" as const };

    expect(doorLine(door)).toBe(`gateway ${gateway.url} · key from .env · sandbox`);
  });
});

describe("a server's token", () => {
  it("acts in the world its prefix names, and knocks nowhere to learn it", () => {
    const project = { url: gateway.url, apiKey: "pc_test_the_ci_token", source: "the environment", world: "sandbox" as const };

    expect(doorIn("sandbox", project)).toEqual({ ...project, world: "sandbox" });
    expect(gateway.heard).toEqual([]);
  });

  it("is refused before it knocks when --prod names the other world", async () => {
    const err = written();

    expect(await inTheWorld("production", () => theDoor(environment("pc_test_the_ci_token"), err.stream, home))).toBeUndefined();
    expect(err.text()).toBe(`${anotherWorldsToken("sandbox", gateway.url)}\n`);
    expect(gateway.heard).toEqual([]);
  });

  // pc_live_ is a person's key's prefix too: the CLI sends it, and the gateway says what it is.
  it("is refused by the gateway without --prod when it is production's", async () => {
    gateway.tokens.add("pc_live_the_servers_token");
    const err = written();

    expect((await theDoor(environment("pc_live_the_servers_token"), err.stream, home))?.world).toBe("sandbox");
    expect(await whoami([], written().stream, err.stream, environment("pc_live_the_servers_token"))).toBe(1);
    expect(err.text()).toBe(
      "sandbox: the gateway answered 403: this key is a production server's token, and this request is for sandbox: a server's token opens the world it was made in\n",
    );
  });

  it("lets a person's key, minted pc_live_ as the runtime mints it, act in the sandbox", async () => {
    const err = written();

    expect((await theDoor(environment("pc_live_a_persons_key"), err.stream, home))?.world).toBe("sandbox");
    expect(err.text()).toBe("");
  });
});

describe("whoami", () => {
  it("prints the one door, who the key is in the sandbox, and that a person's key opens both worlds", async () => {
    const out = written();

    expect(await whoami([], out.stream, written().stream, environment())).toBe(0);

    expect(out.text()).toBe(
      `gateway ${gateway.url} · key from the environment · sandbox\n`
        + "  org clinica · key k_laptop · sandbox · the laptop · production: yes\n"
        + "  a person's key: the sandbox without --prod, production with it\n",
    );
  });

  it("asks production with --prod, and says so", async () => {
    const out = written();

    expect(await inTheWorld("production", () => whoami([], out.stream, written().stream, environment()))).toBe(0);

    expect(out.text()).toContain(`gateway ${gateway.url} · key from the environment · production\n`);
    expect(out.text()).toContain("· production · the laptop · production: yes\n");
  });

  it("says production is refused while the person's switch is off", async () => {
    gateway.opensProduction = false;
    const out = written();

    expect(await whoami([], out.stream, written().stream, environment())).toBe(0);

    expect(out.text()).toContain("production: no\n");
    expect(out.text()).toContain("  a person's key: the sandbox; production is refused until an admin turns your switch on in Team\n");
  });

  it("leaves with a one, in the gateway's words, when --prod is refused", async () => {
    gateway.opensProduction = false;
    const err = written();

    expect(await inTheWorld("production", () => whoami([], written().stream, err.stream, environment()))).toBe(1);

    expect(err.text()).toBe("production: the gateway answered 403: Berna has no production access: an admin gives it in Team\n");
  });

  it("says a server's token opens its one world", async () => {
    gateway.tokens.add("pc_live_the_servers_token");
    const out = written();

    expect(await inTheWorld("production", () => whoami([], out.stream, written().stream, environment("pc_live_the_servers_token")))).toBe(0);

    expect(out.text()).toBe(
      `gateway ${gateway.url} · key from the environment · production\n`
        + "  org clinica · key k_server · production · the server · production: yes\n"
        + "  a production server's token: that world alone, with --prod\n",
    );
  });
});
