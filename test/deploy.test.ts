// `pinecall deploy`: the release sent as a tarball, followed until it is live or said failed, and the rest of the verbs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/deploy.js";
import type { HostedApp, Release } from "@pinecall/agents/wire";
import { inTheWorld } from "../src/world.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_live_the_orgs_own_key";

interface Heard {
  method: string;
  path: string;
  type: string;
  body: Buffer;
}

/** A gateway with the hosting doors; `after` says what the runner makes of each release. */
class FakeGateway {
  readonly heard: Heard[] = [];
  apps = new Map<string, HostedApp>();
  releases = new Map<string, Release[]>();
  after: "live" | "failed" | "nothing" = "live";
  /** What each read of an app's logs answers, in turn; the last one repeats. */
  logs: { lines: string; at: number | null }[] = [];
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
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const url = new URL(request.url ?? "/", this.url);
    const heard = { method: request.method ?? "", path: url.pathname, type: request.headers["content-type"] ?? "", body: Buffer.concat(chunks) };
    this.heard.push(heard);
    const [, , , name, action, number, what] = url.pathname.split("/");
    if (url.pathname === "/v1/hosted") return this.#said(response, 200, { apps: [...this.apps.values()] });
    if (heard.method === "POST" && (action === "stop" || action === "start")) {
      const app = this.apps.get(name!);
      if (app === undefined) return this.#said(response, 404, { detail: `the box hosts no app called ${name}` });
      this.apps.set(name!, { ...app, stopped: action === "stop" });
      response.writeHead(204).end();
      return;
    }
    if (heard.method === "POST" && action === "rollback") {
      const wanted = (JSON.parse(heard.body.toString()) as { release: number }).release;
      return this.#said(response, 200, this.#kept(name!, Buffer.from(`sources of release ${wanted}`), `rollback to release ${wanted}`));
    }
    if (action === "logs") {
      const next = this.logs.length > 1 ? this.logs.shift()! : (this.logs[0] ?? { lines: "", at: null });
      return this.#said(response, 200, { name, host: `${name}-r1-abcdef12`, ...next });
    }
    if (heard.method === "POST") return this.#said(response, 200, this.#kept(name!, heard.body, url.searchParams.get("note") ?? ""));
    if (heard.method === "DELETE") {
      if (!this.apps.delete(name!)) return this.#said(response, 404, { detail: `the box hosts no app called ${name}` });
      response.writeHead(204).end();
      return;
    }
    if (what === "source") {
      response.writeHead(200, { "content-type": "application/gzip" });
      response.end(Buffer.from(`sources of release ${number}`));
      return;
    }
    return this.#said(response, 200, { releases: [...(this.releases.get(name!) ?? [])].reverse() });
  }

  #kept(name: string, body: Buffer, note: string): Release {
    const kept = this.releases.get(name) ?? [];
    const release: Release = { name, release: kept.length + 1, sha256: "a".repeat(64), bytes: body.length, author: "m_ana", note, created_at: 1790000000 };
    this.releases.set(name, [...kept, release]);
    const before = this.apps.get(name);
    const live = this.after === "live" ? release.release : (before?.live_release ?? null);
    const failed = this.after === "failed" ? "installing the dependencies failed:\nnpm ERR! 404" : null;
    this.apps.set(name, { name, release: release.release, live_release: live, failed_why: failed, stopped: false, created_by: "m_ana", created_at: 1790000000 });
    return release;
  }

  #said(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

function aProject(): string {
  const root = join(mkdtempSync(join(tmpdir(), "pinecall-deploy-")), "support-line");
  mkdirSync(join(root, "agents/support"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"dependencies":{"pinecall":"0.9.20","@pinecall/agents":"0.9.20"}}');
  writeFileSync(join(root, "agents/support/agent.ts"), "export default 1");
  writeFileSync(join(root, ".env"), `PINECALL_KEY=${A_KEY}`);
  return root;
}

const gateway = new FakeGateway();
let env: NodeJS.ProcessEnv;
let cwd: string;

beforeEach(async () => {
  gateway.heard.length = 0;
  gateway.apps.clear();
  gateway.releases.clear();
  gateway.after = "live";
  await gateway.open();
  env = pointingAt(gateway.url, A_KEY);
  cwd = aProject();
});

afterEach(async () => {
  await gateway.close();
});

const deploying = (argv: string[], out = written(), err = written()) =>
  inTheWorld("production", () => run(argv, { out: out.stream, err: err.stream, env, cwd, everyMs: 5, withinMs: 200 }));

describe("pinecall deploy", () => {
  it("sends the folder as a gzipped tarball named after the folder, without its .env, and follows it live", async () => {
    const out = written();

    expect(await deploying(["--note", "first"], out)).toBe(0);

    const [sent] = gateway.heard.filter((one) => one.method === "POST");
    expect(sent!.type).toBe("application/gzip");
    expect(sent!.path).toBe("/v1/hosted/support-line/releases");
    const tar = gunzipSync(sent!.body).toString("latin1");
    expect(tar).toContain("agents/support/agent.ts");
    expect(tar).not.toContain(".env");
    expect(tar).not.toContain(A_KEY);
    expect(out.text()).toContain("support-line: release 1 sent");
    expect(out.text()).toContain("support-line: release 1 is live");
  });

  it("says a release that failed, with why, and that the one before keeps serving", async () => {
    await deploying([]);
    gateway.after = "failed";
    const out = written();

    expect(await deploying([], out)).toBe(1);

    expect(out.text()).toContain("release 2 failed — release 1 keeps serving");
    expect(out.text()).toContain("npm ERR! 404");
  });

  it("gives up following when the box says nothing in time, and says where to look", async () => {
    gateway.after = "nothing";
    const out = written();

    expect(await deploying([], out)).toBe(1);

    expect(out.text()).toContain("release 1 is not live after 0s: `pinecall deploy list`");
  });

  it("returns once sent with --no-follow, having read nothing after", async () => {
    gateway.after = "nothing";

    expect(await deploying(["--no-follow"])).toBe(0);

    expect(gateway.heard.map((one) => one.method)).toEqual(["POST"]);
  });

  it("refuses a name that is not an app's before asking anything", async () => {
    const err = written();

    expect(await deploying(["--name", "Support_Line"], written(), err)).toBe(2);

    expect(err.text()).toContain("Support_Line is no name for an app");
    expect(gateway.heard).toEqual([]);
  });

  it("refuses a project that does not depend on the CLI and the framework the box starts it with", async () => {
    writeFileSync(join(cwd, "package.json"), '{"dependencies":{"pinecall":"0.9.20"}}');
    const err = written();

    expect(await deploying([], written(), err)).toBe(2);

    expect(err.text()).toContain("does not list @pinecall/agents in dependencies: npm i @pinecall/agents");
    expect(gateway.heard).toEqual([]);
  });
});

describe("the other verbs", () => {
  it("rolls back on the box's own door, and follows the release it made live", async () => {
    await deploying([]);
    await deploying([]);
    const out = written();

    expect(await deploying(["rollback", "1"], out)).toBe(0);

    const [again] = gateway.heard.filter((one) => one.method === "POST").slice(-1);
    expect(again!.path).toBe("/v1/hosted/support-line/rollback");
    expect(JSON.parse(again!.body.toString())).toEqual({ release: 1 });
    expect(gateway.heard.some((one) => one.path.endsWith("/source"))).toBe(false);
    expect(out.text()).toContain("release 1's sources sent again as release 3");
    expect(out.text()).toContain("release 3 is live");
  });

  it("stops and starts an app, and the list says it is stopped", async () => {
    await deploying([]);
    const out = written();

    expect(await deploying(["stop"], out)).toBe(0);
    expect(await deploying(["list"], out)).toBe(0);
    expect(await deploying(["start"], out)).toBe(0);

    expect(out.text()).toContain("support-line: stopped — its process drains");
    expect(out.text()).toContain("support-line  stopped · newest release 1");
    expect(out.text()).toContain("support-line: started");
  });

  it("waits for lines read after the ask and prints them", async () => {
    await deploying([]);
    gateway.logs = [{ lines: "old\n", at: 1 }, { lines: "old\n", at: 1 }, { lines: "connected\ndoors web\n", at: Date.now() / 1000 + 5 }];
    const out = written();

    expect(await deploying(["logs"], out)).toBe(0);

    expect(out.text()).toBe("connected\ndoors web\n");
  });

  it("says the lines are old when the box sends nothing new in time, and nothing when there is none", async () => {
    await deploying([]);
    gateway.logs = [{ lines: "connected\n", at: 1 }];
    const out = written();
    expect(await deploying(["logs"], out)).toBe(0);
    gateway.logs = [{ lines: "", at: null }];
    const none = written();
    expect(await deploying(["logs"], none)).toBe(1);

    expect(out.text()).toMatch(/^support-line: the box sent nothing new; these are its lines from \d+s ago\nconnected\n$/);
    expect(none.text()).toContain("the box sent no lines yet");
  });

  it("lists every app with what serves it and what failed", async () => {
    await deploying([]);
    gateway.after = "failed";
    await deploying([]);
    const out = written();

    expect(await deploying(["list"], out)).toBe(0);

    expect(out.text()).toBe("support-line  live: release 1 · release 2 failed: installing the dependencies failed:\n");
  });

  it("drops an app, and says the gateway's refusal for one it does not host", async () => {
    await deploying([]);
    const err = written();

    expect(await deploying(["rm"])).toBe(0);
    expect(await deploying(["rm"], written(), err)).toBe(1);

    expect(err.text()).toContain("the box hosts no app called support-line");
  });

  it("follows: prints what came after each read, until it is told to end", async () => {
    await deploying([]);
    const now = Date.now() / 1000;
    gateway.logs = [
      { lines: "a\nb\n", at: now + 5 },
      { lines: "a\nb\n", at: now + 5 },
      { lines: "b\nc\n", at: now + 10 },
      { lines: "c\nd\n", at: now + 15 },
    ];
    const out = written();
    let reads = 0;

    const code = await inTheWorld("production", () =>
      run(["logs", "--follow"], { out: out.stream, err: written().stream, env, cwd, everyMs: 5, withinMs: 200, until: () => ++reads > 4 }),
    );

    expect(code).toBe(0);
    expect(out.text()).toBe("a\nb\nc\nd\n");
  });
});
