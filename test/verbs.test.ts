// `pinecall start`: what it registers, where the console is, and that it binds no local port.

import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtNames, groupFor, groupNames, main, usage } from "../src/index.js";
import { PLANNED } from "../src/groups.js";
import { Refused } from "../src/testing/gateway.js";
import { connectedLine, doorsOf } from "../src/connected.js";
import { run } from "../src/start.js";
import { run as openTheConsole } from "../src/console.js";
import { consoleLine, consoleUrl, whyNoConsole } from "../src/start-console.js";
import { inTheWorld } from "../src/world.js";
import { OneGateway, PERSONS_KEY } from "./one-gateway.js";

const GATEWAY = "https://cloud.pinecall.io";

/** A stream that keeps what was written, so a test can read output as a string. */
function collected(): { stream: NodeJS.WritableStream; text(): string } {
  const written: string[] = [];
  const stream = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => written.join("") };
}

describe("the line `pinecall start` prints when the socket is up", () => {
  // No page URL here: the console link carries a one-use code minted after the socket is up.
  it("names the agent, the gateway and the tools, and no page", () => {
    const line = connectedLine({ slug: "clinica-norte", url: GATEWAY, tools: 4 });

    expect(line).toBe("clinica-norte · connected to https://cloud.pinecall.io · tools 4");
    expect(line).not.toContain("console");
  });

  // A shell-exported key wins over the one `pinecall login` saved, so the line names the org and
  // world the key belongs to.
  it("says whose org took it, which world, and where the key came from", () => {
    const line = connectedLine({
      slug: "clinica-norte",
      url: GATEWAY,
      tools: 4,
      org: "acme",
      env: "sandbox",
      source: "credentials",
    });

    expect(line).toBe(
      "clinica-norte · acme · sandbox · connected to https://cloud.pinecall.io"
        + " · key from credentials · tools 4",
    );
  });

  it("says none of it rather than guessing when the gateway would not answer", () => {
    const line = connectedLine({ slug: "clinica-norte", url: GATEWAY, tools: 1, source: "env" });

    expect(line).toBe("clinica-norte · connected to https://cloud.pinecall.io · key from env · tools 1");
  });

  // Doors are the org's rows, fetched after connecting; the class declares none. Web is always one.
  it("reads the doors off the org's own table, for this agent alone", () => {
    const doors = [
      { agent: "clinica-norte", channel: "phone", number: "+34910000000" },
      { agent: "tienda-sur", channel: "phone", number: "+34910000001" },
    ];

    expect(doorsOf("clinica-norte", doors)).toBe("doors    web · phone +34910000000");
  });

  it("says the web for an agent no number reaches, because every agent is on the web", () => {
    expect(doorsOf("tienda-sur", [])).toBe("doors    web");
  });
});

describe("the console's URL `pinecall start` and `pinecall console` print", () => {
  // The browser signs in with a one-use code in the URL; the key never appears in it.
  it("is the console's page for this agent, with the code, and never a key", () => {
    expect(consoleUrl("https://cloud.pinecall.io/", "production", "clinica-norte", "lc_abc")).toBe(
      "https://cloud.pinecall.io/a/clinica-norte?login=lc_abc",
    );
    expect(consoleUrl(GATEWAY, "production", "tienda sur", "lc_a/b")).toBe("https://cloud.pinecall.io/a/tienda%20sur?login=lc_a%2Fb");
  });

  it("is the org's floor when no agent was named", () => {
    expect(consoleUrl("https://box.test", "production", undefined, "lc_abc")).toBe("https://box.test/?login=lc_abc");
  });

  // One gateway serves both consoles: the sandbox's under /sandbox, at the same origin.
  it("is the same gateway under /sandbox for the sandbox's", () => {
    expect(consoleUrl("https://box.test/", "sandbox", undefined, "lc_abc")).toBe("https://box.test/sandbox/?login=lc_abc");
    expect(consoleUrl(GATEWAY, "sandbox", "clinica-norte", "lc_abc")).toBe("https://cloud.pinecall.io/sandbox/a/clinica-norte?login=lc_abc");
  });

  it("says a gateway with no login-code door is an old one, and what to do about it", () => {
    // 404: no such door, so the gateway is older than this CLI.
    const older = whyNoConsole(new Refused(404, "Not Found"));
    expect(older).toContain("older than this CLI");
    expect(older).toContain("Restart it");
    // Any other status: show the gateway's own message.
    expect(whyNoConsole(new Refused(403, '{"detail":"a server\'s token names nobody"}'))).toBe(
      "the gateway answered 403: a server's token names nobody",
    );
    expect(whyNoConsole(new Error("connect ECONNREFUSED"))).toBe("connect ECONNREFUSED");
  });
});

// One gateway serves both consoles and mints the browser code for this terminal's key in the
// world the verb acts in.
describe("the console of each world", () => {
  let gateway = new OneGateway();
  let env: NodeJS.ProcessEnv = {};

  beforeEach(async () => {
    gateway = new OneGateway();
    await gateway.open();
    env = { PINECALL_KEY: PERSONS_KEY, PINECALL_URL: gateway.url, PINECALL_HOME: mkdtempSync(join(tmpdir(), "pinecall-home-")) };
  });

  afterEach(async () => {
    await gateway.close();
  });

  it("is the sandbox's, under /sandbox, signed in with a code minted in the sandbox", async () => {
    const out = collected();

    expect(await openTheConsole(["clinica-norte", "--no-open"], { out: out.stream, env })).toBe(0);

    expect(out.text()).toBe(`console  ${gateway.url}/sandbox/a/clinica-norte?login=lc_1   (opens within five minutes, once)\n`);
    expect(gateway.heard).toEqual([expect.objectContaining({ path: "/v1/login/codes", bearer: PERSONS_KEY, world: "sandbox" })]);
  });

  it("is production's, at the gateway's root, with --prod, signed in with a code minted in production", async () => {
    const out = collected();

    expect(await inTheWorld("production", () => openTheConsole(["--no-open"], { out: out.stream, env }))).toBe(0);

    expect(out.text()).toBe(`console  ${gateway.url}/?login=lc_1   (opens within five minutes, once)\n`);
    expect(gateway.heard).toEqual([expect.objectContaining({ path: "/v1/login/codes", bearer: PERSONS_KEY, world: "production" })]);
  });

  it("is refused before a browser opens when production is not the person's to act in", async () => {
    gateway.opensProduction = false;
    const err = collected();

    expect(await inTheWorld("production", () => openTheConsole(["--no-open"], { out: collected().stream, err: err.stream, env }))).toBe(1);

    expect(err.text()).toBe("the gateway answered 403: Berna has no production access: an admin gives it in Team\n");
  });

  it("is the line `pinecall start` prints under connected, in the world it registered in", async () => {
    const door = { url: gateway.url, apiKey: PERSONS_KEY, world: "sandbox" as const };

    expect(await consoleLine(door, "clinica-norte", true)).toBe(
      `console  ${gateway.url}/sandbox/a/clinica-norte?login=lc_1   (opens within five minutes, once)`,
    );
  });

  // pm2, systemd and a hosted app write stdout to a log somebody reads later.
  it("carries no code when stdout is not a terminal, and mints none", async () => {
    const door = { url: gateway.url, apiKey: PERSONS_KEY, world: "sandbox" as const };

    expect(await consoleLine(door, "clinica-norte", false)).toBe(`console  ${gateway.url}/sandbox/a/clinica-norte`);
    expect(gateway.heard).toEqual([]);
  });
});

describe("the CLI opens no port at all", () => {
  // The CLI must not listen on any socket. A suite cannot prove a socket is absent, so grep the
  // source for code that would open one.
  it("has nothing under src/ that binds one", () => {
    const cli = fileURLToPath(new URL("../src/", import.meta.url));

    for (const file of sources(cli)) {
      const source = readFileSync(file, "utf8");
      expect(`${file}: ${source.includes("createServer")}`).toBe(`${file}: false`);
      expect(`${file}: ${/\.listen\(/.test(source)}`).toBe(`${file}: false`);
    }
  });

  it("takes no --console, no --console-port and no --open", async () => {
    await expect(run(["--console"])).rejects.toThrow(/console/);
    await expect(run(["--open"])).rejects.toThrow(/open/);
  });
});

// `serve` is not a verb: the agent binds no port, and the box serves the console itself.
describe("`console` opens the page and `start` is the app", () => {
  it("declares both, each saying which it is", () => {
    expect(groupNames()).toContain("console");
    expect(usage()).toContain("start     the app and its doors: the process you deploy");
    expect(usage()).toContain("console   the box's console in a browser");
  });

  it("declares no `serve`: that console is the box's, at its second name", () => {
    expect(groupNames()).not.toContain("serve");
  });
});

// The top-level usage table is hand-written; pin it to the verbs that actually exist.
describe("`pinecall --help` names every verb there is, and nothing else", () => {
  it("has one row per built group, and no row for a group that is gone", async () => {
    const out = collected();

    await main(["--help"], out.stream, collected().stream);

    const rows = [...out.text().matchAll(/^ {2}([a-z]+) {1,}\S/gm)].map((row) => row[1]!);
    const named = rows.filter((name) => !Object.keys(PLANNED).includes(name));
    expect(named.sort()).toEqual([...builtNames()].sort());
  });

  it("names the planned ones too, each said to be unbuilt", async () => {
    const out = collected();

    await main(["--help"], out.stream, collected().stream);

    for (const name of Object.keys(PLANNED)) {
      expect(out.text()).toContain(`${name.padEnd(10)}`);
    }
    expect(out.text()).toContain("not built yet");
  });
});

// The dispatcher prints `usage` under the purpose, so every verb needs one for --help.
describe("every built verb has a help page", () => {
  it("prints its usage under its purpose, and the usage names the verb", async () => {
    const quiet = { write: () => true } as unknown as NodeJS.WritableStream;
    const silent: string[] = [];
    for (const name of builtNames()) {
      const code = await main([name, "--help"], quiet, quiet);
      if (code !== 0) continue;
      const group = await groupFor(name);
      if (group === undefined) continue;
      if (group.usage === undefined || !group.usage.includes(`pinecall ${name}`)) silent.push(name);
    }

    expect(silent, "give the group a `usage` naming its flags").toEqual([]);
  });
});

// `ui` and `serve` are removed, not deprecated: the box serves both consoles.
describe("`ui` and `serve` are not verbs of this CLI", () => {
  it("are refused, and the usage names `console`, which opens the page", async () => {
    for (const gone of ["ui", "serve"]) {
      const out = collected();
      const err = collected();

      const code = await main([gone], out.stream, err.stream);

      expect(code).toBe(2);
      expect(err.text()).toContain(`no such group: ${gone}`);
      expect(groupNames()).not.toContain(gone);
    }
    expect(usage()).toContain("console   the box's console in a browser");
  });
});

// Removing a verb must also remove every sentence that tells people to type it.
describe("no line of this CLI tells anybody to type a verb that is gone", () => {
  it("never says `pinecall ui` or `pinecall serve`, except where it says they are gone", () => {
    const cli = fileURLToPath(new URL("../src/", import.meta.url));
    const guilty: string[] = [];

    for (const file of sources(cli)) {
      for (const [n, line] of readFileSync(file, "utf8").split("\n").entries()) {
        if (!/pinecall (ui|serve)\b/.test(line)) continue;
        // The sentence that says the verb no longer exists.
        if (/not a verb|no such group|is gone|are gone/.test(line)) continue;
        guilty.push(`${file}:${n + 1}`);
      }
    }

    expect(guilty).toEqual([]);
  });
});

/** Every .ts under a directory, its subdirectories included. */
function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}
