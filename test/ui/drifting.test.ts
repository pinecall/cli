// The console drift door: windows and pass-rate counts.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { driftingFrom } from "../../src/ui/drifting.js";

const NOW = 1_800_000_000;
const A_DAY = 24 * 60 * 60;

/** Fake gateway with one agent's finished, judged calls. */
class FakeGateway {
  calls: Record<string, unknown>[] = [];
  scores: Record<string, string> = {};
  asked: string[] = [];
  #server!: Server;
  url = "";

  async open(): Promise<void> {
    this.#server = createServer((request, response) => {
      const path = request.url ?? "";
      this.asked.push(path);
      response.writeHead(200, { "content-type": "application/json" });
      if (path.includes("/sessions")) {
        response.end(JSON.stringify({ calls: this.calls }));
        return;
      }
      const call = /calls\/([^/]+)\//.exec(path)?.[1] ?? "";
      const verdict = this.scores[call];
      const entries =
        verdict === undefined
          ? []
          : [
              {
                seq: 1,
                call,
                agent: "clinica-norte",
                type: "call.score",
                data: {
                  passed: verdict === "held",
                  judges: [{ name: "register", verdict, criteria: "", reason: "usted", evidence: { seqs: [4] } }],
                },
              },
            ];
      response.end(JSON.stringify({ entries, live: false, next: 2 }));
    });
    await new Promise<void>((bound) => this.#server.listen(0, "127.0.0.1", bound));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((closed) => this.#server.close(() => closed()));
  }
}

let gateway: FakeGateway;

beforeEach(async () => {
  gateway = new FakeGateway();
  await gateway.open();
});

afterEach(async () => {
  await gateway.close();
});

describe("drift as the page asks for it", () => {
  it("counts each judge in the two windows and answers the points between them", async () => {
    gateway.calls = [
      { call: "now_broke", live: false, ended_at: NOW - A_DAY, started_at: NOW - A_DAY },
      { call: "before_held", live: false, ended_at: NOW - 10 * A_DAY, started_at: NOW - 10 * A_DAY },
    ];
    gateway.scores = { now_broke: "broken", before_held: "held" };
    const door = driftingFrom({ url: gateway.url, apiKey: "pk", world: "sandbox" }, () => NOW);

    const drifted = await door.read({ agent: "clinica-norte" });

    expect(drifted).toMatchObject({ agent: "clinica-norte", window: 7 * A_DAY, baseline: 30 * A_DAY });
    expect(drifted.drift.judges).toEqual([
      {
        judge: "register",
        before: { held: 1, settled: 1, percent: 100 },
        now: { held: 0, settled: 1, percent: 0 },
        delta: -100,
      },
    ]);
    expect(drifted.drift.broke[0]).toMatchObject({ call: "now_broke", judge: "register" });
  });

  it("takes the two windows the page names, and refuses one it did not", async () => {
    const door = driftingFrom({ url: gateway.url, apiKey: "pk", world: "sandbox" }, () => NOW);

    expect(await door.read({ agent: "clinica-norte", window: A_DAY, baseline: 2 * A_DAY })).toMatchObject({
      window: A_DAY,
      baseline: 2 * A_DAY,
    });
    await expect(door.read({ agent: "clinica-norte", window: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(door.read({})).rejects.toMatchObject({ status: 422 });
  });
});
