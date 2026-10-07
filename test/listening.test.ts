// `--listen`: which player is used, the message when there is none, and the retries that make
// the ear join in time for the greeting.

import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aSeatIn, anEarIn, EAR, NO_PLAYER } from "../src/listening.js";
import { written } from "./said.js";

const A_KEY = "pc_test_the_orgs_key";
const CALL = "call_abc";
const SEAT = { server_url: "ws://127.0.0.1:7880", participant_token: "a.room.token", identity: "sup_1" };

/** A gateway whose listen door refuses until the room is open, then answers a seat. */
class FakeGateway {
  refusals = 0;
  asked = 0;
  #server!: Server;
  url = "";

  async open(): Promise<void> {
    this.#server = createServer((request, response) => {
      this.asked += 1;
      if (this.refusals > 0) {
        this.refusals -= 1;
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: `no call ${CALL}` }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(SEAT));
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

describe("the seat", () => {
  it("is knocked for until the room opens, and is the listen door's own answer", async () => {
    gateway.refusals = 2;

    const seat = await aSeatIn({ url: gateway.url, apiKey: A_KEY, world: "sandbox" }, CALL);

    expect(seat).toEqual(SEAT);
    expect(gateway.asked).toBe(3);
  });
});

describe("what plays it", () => {
  // Name the four players so the person knows what to install.
  it("names every player it can write to, and what installs one", () => {
    expect(NO_PLAYER).toContain("ffplay");
    expect(NO_PLAYER).toContain("play");
    expect(NO_PLAYER).toContain("aplay");
    expect(NO_PLAYER).toContain("pw-play");
    expect(NO_PLAYER).toContain("install");
  });

  it("says so before it asks the gateway for anything, when this machine has none", async () => {
    const path = process.env["PATH"];
    process.env["PATH"] = "";
    try {
      await expect(anEarIn({ url: gateway.url, apiKey: A_KEY, world: "sandbox" }, CALL, written().stream)).rejects.toThrow(NO_PLAYER);
      expect(gateway.asked).toBe(0);
    } finally {
      process.env["PATH"] = path;
    }
  });
});

describe("the ear", () => {
  // The room is joined by a sibling program resolved from this module's extension; a rename or a
  // build that skips it breaks `--listen` silently.
  it("is a program that sits beside listening, under the same extension", () => {
    expect(EAR.endsWith("/ear.ts") || EAR.endsWith("/ear.js")).toBe(true);
    expect(existsSync(EAR)).toBe(true);
  });
});
