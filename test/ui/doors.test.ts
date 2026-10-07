// The dev verb table: only registered verbs are answered.

import { describe, expect, it } from "vitest";

import { DevRefused } from "@pinecall/agents/client";
import { devHandler, ownVerbs } from "../../src/ui/doors.js";
import { Refusal, refusedAs } from "../../src/ui/refusal.js";
import { Refused } from "../../src/testing/gateway.js";

describe("what a refusal becomes", () => {
  // Gateway refusals reach the page unwrapped, not as `the gateway answered 503: {...}`.
  it("carries this process's own status, and the gateway's status and sentence unwrapped", () => {
    expect(refusedAs(new Refusal(409, "this console runs in clinica-norte's directory"))).toEqual({
      status: 409,
      detail: "this console runs in clinica-norte's directory",
    });
    expect(refusedAs(new Refused(503, JSON.stringify({ detail: "this gateway keeps no knowledge" })))).toEqual({
      status: 503,
      detail: "the gateway answered 503: this gateway keeps no knowledge",
    });
    expect(refusedAs(new Error("the socket closed"))).toEqual({ status: 500, detail: "the socket closed" });
  });
});

describe("the table by verb, as pinecall start answers the gateway", () => {
  const chatting = {
    roster: async () => ({ agent: "clinica-norte", states: [] }),
    start: async (asked: unknown) => {
      if ((asked as { agent: string }).agent !== "clinica-norte") throw new Refusal(409, "this process runs in clinica-norte's directory");
      return { call: "c" };
    },
    say: async () => ({ call: "c" }),
    end: async () => ({ call: "c" }),
    close: async () => undefined,
  };

  it("registers one verb per thing the terminal handed in, and nothing for what it did not", () => {
    expect(Object.keys(ownVerbs({ chatting })).sort()).toEqual(["chat.end", "chat.roster", "chat.say", "chat.start"]);
    expect(ownVerbs({})).toEqual({});
  });

  it("answers a verb with the module's result, and refuses with the module's status and sentence", async () => {
    const handler = devHandler(ownVerbs({ chatting }));
    expect(await handler("chat.roster", {})).toEqual({ agent: "clinica-norte", states: [] });
    await expect(handler("chat.start", { agent: "tienda-sur" })).rejects.toMatchObject({
      status: 409,
      detail: "this process runs in clinica-norte's directory",
    });
  });

  it("refuses a verb nothing in this directory answers, as a 404 that names it", async () => {
    const handler = devHandler(ownVerbs({ chatting }));
    const refused = await handler("goldens.run", {}).catch((failed: unknown) => failed);
    expect(refused).toBeInstanceOf(DevRefused);
    expect((refused as DevRefused).status).toBe(404);
    expect((refused as DevRefused).detail).toContain("goldens.run");
  });
});
