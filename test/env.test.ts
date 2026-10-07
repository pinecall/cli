// Gateway and key resolution: PINECALL_KEY and PINECALL_URL from the environment, else the nearest
// `.env`. The sandbox's derived key is tested in the-sandbox-key-is-derived-from-productions.test.ts.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { anotherWorldsToken, CLOUD_URL, doorLine, keyFrom, NO_KEY, theDoor } from "../src/env.js";
import { readDotenv, writeDotenv } from "../src/dotenv.js";
import { inTheWorld, theChosenWorld, withoutTheWorldFlag } from "../src/world.js";
import { written } from "./said.js";

const BOX = "http://127.0.0.1:8080";
const A_KEY = "pc_the_persons_own_key_nobody_will_deploy";

let project = "";

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "pinecall-project-"));
});

describe("the door a verb is handed", () => {
  it("is the project's .env, read from the folder the verb runs in or any under it", () => {
    writeFileSync(join(project, ".env"), `# the app's own\nPINECALL_KEY=${A_KEY}\nPINECALL_URL="${BOX}"\n`);
    const deeper = join(project, "agents", "clinica");
    mkdirSync(deeper, { recursive: true });

    expect(keyFrom({}, deeper)).toEqual({ url: BOX, apiKey: A_KEY, source: join("..", "..", ".env") });
  });

  it("is the environment's first: a server's secrets, a CI job's", () => {
    writeFileSync(join(project, ".env"), "PINECALL_KEY=pc_the_file\n");

    expect(keyFrom({ PINECALL_KEY: A_KEY }, project)).toEqual({ url: CLOUD_URL, apiKey: A_KEY, source: "the environment" });
  });

  // Every connecting verb opens with this line: gateway, key source and world.
  it("is PINECALL_URL itself with --prod, named on one line with where the key was read", async () => {
    writeFileSync(join(project, ".env"), `PINECALL_KEY=${A_KEY}\n`);
    const open = await inTheWorld("production", async () => await theDoor({}, written().stream, project));

    expect(open).toEqual({ url: CLOUD_URL, apiKey: A_KEY, source: ".env", world: "production" });
    expect(doorLine(open!)).toBe(`gateway ${CLOUD_URL} · key from .env · production`);
  });
});

describe("a folder nobody linked", () => {
  it("is told the verb that links it", async () => {
    const said = written();

    expect(await theDoor({}, said.stream, project)).toBeUndefined();
    expect(said.text()).toBe(`${NO_KEY}\n`);
    expect(said.text()).toContain("`pinecall link`");
  });

  // PINECALL_API_KEY is v1's name; reading it would silently use another org's key.
  it("never reads v1's PINECALL_API_KEY", async () => {
    expect(await theDoor({ PINECALL_API_KEY: A_KEY }, written().stream, project)).toBeUndefined();
  });
});

describe("the .env link writes", () => {
  it("replaces its own lines where they stand and leaves the app's alone", () => {
    const file = join(project, ".env");
    writeFileSync(file, "DATABASE_URL=postgres://x\nPINECALL_KEY=pc_old\n");

    writeDotenv(file, { PINECALL_KEY: A_KEY, PINECALL_URL: BOX });

    expect(readDotenv(file)).toEqual({ DATABASE_URL: "postgres://x", PINECALL_KEY: A_KEY, PINECALL_URL: BOX });
  });
});

describe("--prod", () => {
  it("is taken out of the argv every group reads, and names production for this command only", async () => {
    expect(withoutTheWorldFlag(["agent", "set", "--prod", "--voice", "carolina"])).toEqual({ argv: ["agent", "set", "--voice", "carolina"], world: "production" });
    expect(withoutTheWorldFlag(["agent"])).toEqual({ argv: ["agent"], world: undefined });
    expect(await inTheWorld("production", async () => theChosenWorld())).toBe("production");
    expect(theChosenWorld()).toBe("sandbox");
  });
});

// A server token belongs to one instance and names its world in its prefix: nothing is derived
// from it, PINECALL_URL is where it was made, and --prod must match its world.
describe("a server's token", () => {
  const env = (key: string): NodeJS.ProcessEnv => ({ PINECALL_KEY: key, PINECALL_URL: BOX });

  it("knocks where it was made, in the world it names, and asks nobody else", async () => {
    expect(await theDoor(env("pc_test_the_orgs_ci_token"), written().stream, project)).toEqual({
      url: BOX,
      apiKey: "pc_test_the_orgs_ci_token",
      source: "the environment",
      world: "sandbox",
    });
    expect(await inTheWorld("production", async () => (await theDoor(env("pc_live_the_orgs_token"), written().stream, project))?.world)).toBe("production");
  });

  it("is refused in one sentence when --prod names the sandbox token's other world", async () => {
    const test = written();

    expect(await inTheWorld("production", async () => await theDoor(env("pc_test_the_orgs_token"), test.stream, project))).toBeUndefined();

    expect(test.text()).toBe(`${anotherWorldsToken("sandbox", BOX)}\n`);
    expect(test.text()).toContain("run the verb without --prod");
  });

  // A person's key is minted pc_live_ too: only the gateway can tell it from a production token.
  it("sends a pc_live_ key to the world asked, for the gateway to place", async () => {
    const live = written();

    expect((await theDoor(env("pc_live_the_orgs_token"), live.stream, project))?.world).toBe("sandbox");
    expect(live.text()).toBe("");
  });
});
