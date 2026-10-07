// `pinecall link`: a project's folder tied to one org of the person's — their key for it, in the
// folder's own `.env`. The machine is signed in already here; the browser's dance is login.test.ts.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readDotenv } from "../src/dotenv.js";
import { link } from "../src/linking.js";
import { signIn } from "../src/signed-in.js";
import { written } from "./said.js";

const SIGNED_IN = "pc_this_machine_signed_in_as_berna";
const IN_THE_OTHER_ORG = "pc_berna_in_the_other_org";

/** The two doors link knocks at: the person's orgs, and their key in another one. */
class FakeGateway {
  readonly minted: string[] = [];
  /** The `pinecall-env` of every request, in order. */
  readonly worlds: (string | string[] | undefined)[] = [];
  #server!: Server;
  url = "";

  async open(): Promise<void> {
    this.#server = createServer((request, response) => void this.#answer(request, response));
    await new Promise<void>((bound) => this.#server.listen(0, "127.0.0.1", bound));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((closed) => this.#server.close(() => closed()));
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.worlds.push(request.headers["pinecall-env"]);
    if (request.headers.authorization !== `Bearer ${SIGNED_IN}`) return said(response, 401, { detail: "this door takes an API key" });
    if (request.url === "/v1/login/orgs") {
      return said(response, 200, {
        orgs: [
          { org: "org_1", slug: "clinica-norte", here: true },
          { org: "org_2", slug: "cloudacio", here: false },
          { org: "org_3", slug: "visited", here: false, member: false },
        ],
      });
    }
    if (request.url === "/v1/login/org") {
      let text = "";
      for await (const chunk of request) text += String(chunk);
      this.minted.push((JSON.parse(text) as { org: string }).org);
      return said(response, 200, { key: IN_THE_OTHER_ORG });
    }
    said(response, 404, { detail: "no such door" });
  }
}

function said(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const gateway = new FakeGateway();
let home = "";
let project = "";

beforeEach(async () => {
  gateway.minted.length = 0;
  gateway.worlds.length = 0;
  await gateway.open();
  home = mkdtempSync(join(tmpdir(), "pinecall-home-"));
  project = mkdtempSync(join(tmpdir(), "pinecall-project-"));
  signIn(gateway.url, SIGNED_IN, home);
});

afterEach(async () => {
  await gateway.close();
});

function linked(argv: string[], choose?: (slugs: string[]) => Promise<string | undefined>): Promise<number> {
  return link(argv, { out: written().stream, err: written().stream, env: { PINECALL_HOME: home }, from: project, ...(choose ? { choose } : {}) });
}

describe("linking a project", () => {
  it("writes the person's key for the org this machine signed in to, and the gateway beside it", async () => {
    expect(await linked(["--org", "clinica-norte"])).toBe(0);

    expect(readDotenv(join(project, ".env"))).toEqual({ PINECALL_KEY: SIGNED_IN, PINECALL_URL: gateway.url });
    expect(gateway.minted).toEqual([]);
  });

  it("mints the person's key in another org of theirs, and writes that one", async () => {
    await linked(["--org", "cloudacio"]);

    expect(readDotenv(join(project, ".env"))["PINECALL_KEY"]).toBe(IN_THE_OTHER_ORG);
    expect(gateway.minted).toEqual(["org_2"]);
  });

  // A person is kept in production: link signs in and mints there, and writes the one key that
  // opens both worlds — nothing of the sandbox's own, because the sandbox has nothing of its own.
  it("asks production, saying so on every request, and writes the one key and the gateway", async () => {
    await linked(["--org", "cloudacio"]);

    expect(gateway.worlds).toEqual(["production", "production"]);
    expect(Object.keys(readDotenv(join(project, ".env")))).toEqual(["PINECALL_KEY", "PINECALL_URL"]);
  });

  it("asks which org when the person belongs to several, and offers none they only visit", async () => {
    const offered: string[][] = [];

    await linked([], async (slugs) => {
      offered.push(slugs);
      return "cloudacio";
    });

    expect(offered).toEqual([["clinica-norte", "cloudacio"]]);
    expect(readDotenv(join(project, ".env"))["PINECALL_KEY"]).toBe(IN_THE_OTHER_ORG);
  });

  it("is refused an org the person is not in, naming the ones they are", async () => {
    const err = written();

    const code = await link(["--org", "nadie"], { out: written().stream, err: err.stream, env: { PINECALL_HOME: home }, from: project });

    expect(code).toBe(2);
    expect(err.text()).toBe("you are no member of nadie: --org clinica-norte | cloudacio\n");
  });

  it("keeps the app's own variables, and says so when git would commit .env", async () => {
    spawnSync("git", ["init", "-q"], { cwd: project });
    writeFileSync(join(project, ".env"), "DATABASE_URL=postgres://x\n");
    const err = written();

    await link(["--org", "clinica-norte"], { out: written().stream, err: err.stream, env: { PINECALL_HOME: home }, from: project });

    expect(readFileSync(join(project, ".env"), "utf8")).toContain("DATABASE_URL=postgres://x");
    expect(err.text()).toContain("git would commit .env");
    writeFileSync(join(project, ".gitignore"), "node_modules\n.env\n");
    const quiet = written();
    await link(["--org", "clinica-norte"], { out: written().stream, err: quiet.stream, env: { PINECALL_HOME: home }, from: project });
    expect(quiet.text()).toBe("");
  });
});
