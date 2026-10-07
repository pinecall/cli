// `pinecall numbers`: the org's doors, one per line, what its accounts own and which of it is free,
// and the verbs that route and forget a number.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { group, aLine, anOwnedLine, run } from "../src/numbers.js";
import { pointingAt } from "./home.js";
import { written } from "./said.js";

const A_NUMBER = "+34910000000";

function aDoor(over: Partial<Parameters<typeof aLine>[0]["route"]> = {}): Parameters<typeof aLine>[0] {
  return {
    route: { number: A_NUMBER, channel: "phone", agent: "clinica-norte", env: "production", managed: false, ...over },
  };
}

describe("one door as a line", () => {
  it("is the number, the channel, whose it is and which world", () => {
    expect(aLine(aDoor())).toBe(`${A_NUMBER} · phone · → clinica-norte · production`);
  });

  it("says when the box bought the number, because letting it go is not the same act", () => {
    expect(aLine(aDoor({ managed: true }))).toContain("bought here");
  });
});

describe("the verb's shape", () => {
  // A number belongs to one instance; the runtime has no door to move it, so the verb has none.
  it("names its sub-verbs, and none moves a number between the worlds", () => {
    expect(group.usage).toContain("pinecall numbers available [--account <id>]");
    expect(group.usage).toContain("pinecall numbers drop <+34…>");
    expect(group.usage).not.toContain("numbers move");
  });

  // No key exits 2 (cannot run), like every other verb. Unknown flags must propagate so the
  // dispatcher (cli/index.ts) turns them into exit 2.
  it("lets a flag it does not take reach the dispatcher, which names the verb", async () => {
    await expect(run(["list", "--bogus"], { env: pointingAt("http://127.0.0.1:1", "pc_test_a_key") })).rejects.toThrow(
      "Unknown option '--bogus'",
    );
  });

  it("says this folder is linked to no org rather than knocking at a default one", async () => {
    const err = written();

    expect(await run(["drop", A_NUMBER], { err: err.stream, env: {} })).toBe(2);
    expect(err.text()).toContain("`pinecall link`");
  });
});

describe("one owned number as a line", () => {
  it("says a number this world does not route is not routed here", () => {
    expect(anOwnedLine({ number: A_NUMBER, name: "Demos", imported: false, account: "AC1" })).toBe(
      `${A_NUMBER} · Demos · AC1 · not routed here`,
    );
  });

  it("says a number this world already routes is routed here", () => {
    expect(anOwnedLine({ number: A_NUMBER, name: "", imported: true })).toBe(`${A_NUMBER} · routed here`);
  });

  // Twilio names an unnamed number by the number itself; printing it twice says nothing.
  it("leaves out a name that is only the number again", () => {
    expect(anOwnedLine({ number: A_NUMBER, name: A_NUMBER, imported: false })).toBe(`${A_NUMBER} · not routed here`);
  });
});

describe("what the org's accounts own", () => {
  const A_KEY = "pc_test_the_orgs_own_key";
  let server: Server;
  let url = "";
  let asked: string[] = [];
  let owned: unknown = { kind: "twilio", numbers: [] };

  beforeEach(async () => {
    asked = [];
    server = createServer((request, response) => {
      asked.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(owned));
    });
    await new Promise<void>((bound) => server.listen(0, "127.0.0.1", bound));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  async function available(argv: string[] = []) {
    const out = written();
    const code = await run(["available", ...argv], { out: out.stream, env: pointingAt(url, A_KEY) });
    return { code, out: out.text() };
  }

  it("prints every number the accounts own, one per line, routed here or not", async () => {
    owned = {
      kind: "twilio",
      numbers: [
        { number: "+13610000001", name: "Demos", imported: false, account: "AC1" },
        { number: "+13610000002", name: "", imported: true, account: "AC1" },
      ],
    };

    const { code, out } = await available();

    expect(code).toBe(0);
    expect(asked).toEqual(["/v1/numbers/available"]);
    expect(out).toBe("+13610000001 · Demos · AC1 · not routed here\n+13610000002 · AC1 · routed here\n");
  });

  it("asks one account when --account names it", async () => {
    await available(["--account", "AC1"]);

    expect(asked).toEqual(["/v1/numbers/available?account=AC1"]);
  });

  it("says a SIP peer lists nothing, and that its number is imported as typed", async () => {
    owned = { kind: "sip", numbers: [] };

    expect((await available()).out).toContain("takes its number as typed");
  });

  it("lets a flag it does not take reach the dispatcher", async () => {
    await expect(available(["--bogus"])).rejects.toThrow("Unknown option '--bogus'");
  });
});
