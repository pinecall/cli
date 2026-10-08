// The console promote door: writing candidates and refusals.

import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { promotingFrom } from "../../src/ui/promoting.js";
import { written } from "../said.js";

const CALL = "call_that_was_judged";

/** Fake gateway answering a call's golden door, or refusing it as a call still going. */
class FakeGateway {
  golden: Record<string, unknown> | null = null;
  #server!: Server;
  url = "";

  async open(): Promise<void> {
    this.#server = createServer((_request, response) => {
      response.writeHead(this.golden === null ? 409 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(this.golden ?? { detail: `call ${CALL} is still going: a case is made of a call that ended` }));
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
  process.chdir(was);
});

const was = process.cwd();

// The golden the gateway derives from a call that held: its caller's line, and nothing expected.
const HELD = { name: CALL, state: { stage: "identify" }, input: ["quiero cambiar la cita"], expect: {}, promoted_from: CALL };

describe("promoting a call", () => {
  it("writes the candidate beside this directory's goldens and answers where it landed", async () => {
    gateway.golden = HELD;
    process.chdir(mkdtempSync(join(tmpdir(), "pinecall-candidates-")));
    const door = promotingFrom({ url: gateway.url, apiKey: "pk", world: "sandbox" }, "clinica-norte", written().stream);

    const promoted = await door.promote({ call: CALL });

    expect(promoted.path).toContain("test/candidates");
    expect(promoted.candidate.input).toEqual(["quiero cambiar la cita"]);
    expect(JSON.parse(readFileSync(promoted.path, "utf8"))).toMatchObject({ promoted_from: CALL });
  });

  it("keeps the gateway's status and sentence when it refuses the call", async () => {
    const door = promotingFrom({ url: gateway.url, apiKey: "pk", world: "sandbox" }, "clinica-norte", written().stream);

    await expect(door.promote({ call: CALL })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("is still going") as string,
    });
  });

  it("refuses when no class stands in this directory: a candidate has no goldens to join", async () => {
    const door = promotingFrom({ url: gateway.url, apiKey: "pk", world: "sandbox" }, null, written().stream);

    await expect(door.promote({ call: CALL })).rejects.toMatchObject({ status: 409 });
  });
});
