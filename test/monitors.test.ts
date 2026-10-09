/** `pinecall monitors`: the numbers watched listed, one added with its line, one forgotten. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run, type Monitor } from "../src/monitors.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_KEY = "pc_live_the_orgs_own_key";
const SLOW: Monitor = {
  id: "mon_3f9a1c2b4d5e",
  name: "slow answers",
  metric: "e2e_median_s",
  above: true,
  threshold: 2,
  window_days: 7,
  agent: null,
  created_by: "m_ana",
  fired_on: "2026-10-08",
  fired_value: 2.41,
};

interface Heard { method: string; path: string; body: unknown }

class FakeGateway {
  readonly heard: Heard[] = [];
  monitors: Monitor[] = [];
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
    const text = Buffer.concat(chunks).toString("utf8");
    const body: unknown = text === "" ? null : JSON.parse(text);
    this.heard.push({ method: request.method ?? "", path: request.url ?? "", body });
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ monitors: this.monitors }));
      return;
    }
    if (request.method === "POST") {
      const kept = { ...SLOW, ...(body as object), id: "mon_8b1d2e3f4a5c", fired_on: null, fired_value: null };
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(kept));
      return;
    }
    if (this.monitors.length === 0) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "no monitor mon_nope" }));
      return;
    }
    response.writeHead(204);
    response.end();
  }
}

let gateway: FakeGateway;
beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});
afterEach(async () => gateway.close());

describe("pinecall monitors", () => {
  it("says the org watches nothing, then lists each monitor with its rule and when it fired", async () => {
    const out = written();
    expect(await run([], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.monitors = [SLOW, { ...SLOW, id: "mon_8b1d2e3f4a5c", name: "judges", metric: "held_rate", above: false, threshold: 0.9, agent: "front-desk", fired_on: null, fired_value: null }];
    expect(await run([], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    expect(out.text()).toContain("watches nothing");
    expect(out.text()).toContain("mon_3f9a1c2b4d5e  slow answers  e2e_median_s above 2 over 7 days  every agent  fired 2026-10-08 at 2.41");
    expect(out.text()).toContain("mon_8b1d2e3f4a5c  judges        held_rate below 0.9 over 7 days   front-desk   never fired");
  });

  it("adds one with its line above or below, the window and the agent as the gateway takes them", async () => {
    const out = written();
    const code = await run(["add", "judges slipping", "--metric", "held_rate", "--below", "0.9", "--days", "30", "--agent", "front-desk"], { out: out.stream, env: pointingAt(gateway.url, A_KEY) });
    expect(code).toBe(0);
    expect(gateway.heard[0]).toMatchObject({ method: "POST", path: "/v1/monitors", body: { name: "judges slipping", metric: "held_rate", above: false, threshold: 0.9, window_days: 30, agent: "front-desk" } });
    expect(out.text()).toBe("mon_8b1d2e3f4a5c · judges slipping · held_rate below 0.9 over 30 days · front-desk\n");
  });

  it("refuses an unknown metric, two lines, no line and a window that is not a day, asking the gateway nothing", async () => {
    const err = written();
    const env = pointingAt(gateway.url, A_KEY);
    const codes = [
      await run(["add", "x", "--metric", "p50", "--above", "1"], { err: err.stream, env }),
      await run(["add", "x", "--metric", "calls", "--above", "1", "--below", "1"], { err: err.stream, env }),
      await run(["add", "x", "--metric", "calls"], { err: err.stream, env }),
      await run(["add", "x", "--metric", "calls", "--above", "1", "--days", "3"], { err: err.stream, env }),
      await run(["add"], { err: err.stream, env }),
    ];
    expect(codes).toEqual([2, 2, 2, 2, 2]);
    expect(gateway.heard).toEqual([]);
    expect(err.text()).toContain("--metric names one of e2e_median_s");
    expect(err.text()).toContain("one of them");
    expect(err.text()).toContain("--days is 1, 7 or 30, not 3");
  });

  it("forgets one, and says so in the gateway's words when there is none", async () => {
    const out = written();
    const err = written();
    gateway.monitors = [SLOW];
    expect(await run(["rm", SLOW.id], { out: out.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(0);
    gateway.monitors = [];
    expect(await run(["rm", "mon_nope"], { out: out.stream, err: err.stream, env: pointingAt(gateway.url, A_KEY) })).toBe(1);
    expect(gateway.heard.map((one) => one.path)).toEqual([`/v1/monitors/${SLOW.id}`, "/v1/monitors/mon_nope"]);
    expect(out.text()).toBe(`${SLOW.id} forgotten\n`);
    expect(err.text()).toContain("no monitor mon_nope");
  });
});
