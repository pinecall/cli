/** `pinecall start [agent.tsx]`: the agents served and the console answered; the process you deploy. */

import { parseArgs } from "node:util";

import type { CamelEvent } from "@pinecall/agents/client";
import { toCamel } from "@pinecall/agents/wire";

import { runOnce, spawnServing, type Child } from "./child.js";
import { companionFor, type Companion } from "./companion.js";
import { connectedLine, doorsOf } from "./connected.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { AGENT_FLAG, homesFor, type Home } from "./home.js";
import { inspectOf, languageOf, startedWith } from "./language.js";
import { describing, doorsOfTheOrg, theLine, type Door_ } from "./line.js";
import type { EventLine } from "./serving.js";
import { consoleLine, whyNoConsole } from "./start-console.js";
import { live, plain, type Held, type Listen, type Plain } from "./start-screens.js";
import { asked, type Door } from "./testing/gateway.js";
import { orgOf, type Who } from "./whoami.js";
import { cannotTell, standing } from "./world.js";

export const group: Group = {
  purpose: "the app and its doors: the process you deploy",
  usage: `usage: pinecall start [agent.tsx] [--agent <name>] [--prod] [--ui] [--events] [--show-prompt]
                      [--inspect[=host:port] | --inspect-brk]

  With nothing after it: the agent served by its language's serve entry, a process this one starts
  and watches, one line per log entry on stdout, no port bound and no page served. Beside it this
  process holds a socket of its own that answers the console's screens and takes no call. Without
  --prod it registers in the sandbox and answers the sandbox's console, at the gateway under
  /sandbox; with --prod, in production and its console.

  At the root of a project of several agents — agents/<name>/agent.tsx — every agent at once, in
  one process, each line prefixed by its slug; --agent <name> runs one of them. They are in one
  language, or --agent names one.

  Ctrl-C or SIGTERM: the agent's process drains its calls to the next holder and leaves; a second
  signal kills it.

  --prod         production: the agent your org's customers reach. A server's token was made
                 for it; a person's key opens it while their org lets them act there
  --show-prompt  the prompt a fresh instance would produce, then exit. No key, no gateway
  --events       the agent's process's lines as it prints them, one JSON entry each, for a pipe
  --ui           the full-screen terminal view; keys: p pause · c clear · e events · q quit
  --inspect      Node's own flag, given to the agent's process (a TypeScript agent's alone)

  Examples
    $ pinecall start
    clinica-norte · clinica · sandbox · connected to https://cloud.pinecall.io · key from .env · tools 4
    console  https://cloud.pinecall.io/sandbox/a/clinica-norte?login=lc_9f2   (opens within five minutes, once)
    doors    web · phone +34910000000
    line     rings in this terminal · also running: carla@clinica.test
    › Clínica Norte, good morning. How can I help you?
    ‹ I'd like to change an appointment
    → findPatient({"name":"Ana García","phone":"600000001"})
    ← findPatient {"id":"p-1041","appointment":"Thursday at ten"}`,
  run,
};

/**
 * Start the agents' serve entry, wait for each to register, connect the companion that answers the
 * console, and stay up until the entry leaves. Same process in sandbox and production.
 */
export async function run(argv: string[]): Promise<number> {
  const { inspect, rest } = inspectOf(argv);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      "show-prompt": { type: "boolean", default: false },
      events: { type: "boolean", default: false },
      ui: { type: "boolean", default: false },
      ...AGENT_FLAG,
    },
  });
  // A single file, or every agents/<name>/ at a project's root (or the one named).
  const homes = await homesFor(positionals[0], values.agent);
  const mixed = oneLanguage(homes);
  if (mixed !== undefined) return refused(mixed);
  // --show-prompt needs no gateway, key or network.
  if (values["show-prompt"] === true) return await prompts(homes);
  if (values.ui === true && homes.length > 1) {
    return refused(`the full-screen view watches one agent and this project has ${homes.length}: add ${named(homes)}`);
  }

  const door = await theDoor();
  if (door === undefined) return 2;
  // Resolve the org before registering anything, so a refusal happens first.
  let who: Who;
  try {
    who = await standing(door);
  } catch (failed) {
    return refused(cannotTell("start", failed));
  }
  const args = [...homes.flatMap((home) => ["--file", home.file, "--slug", home.name]), "--events"];
  const first = homes[0]!;
  const child = spawnServing(startedWith(door, first.file, "start", args, { root: first.root, inspect }), { signals: process });
  // Before the registrations are read, so agent.registered is the first line of a pipe.
  if (values.events === true) child.onEvent((line) => process.stdout.write(`${JSON.stringify(line)}\n`));
  for (const home of homes) await child.registered(home.name);
  const companion = companionFor(door, homes, child, process.stdout);
  try {
    await companion.pc.connect();
    const held: Held = { gone: Promise.race([child.exited, companionStopped(companion, child)]), leave: () => child.stop() };
    if (values.events === true) return await held.gone;
    if (values.ui === true) return await live(held, heardFrom(child, first.name), { slug: first.name, url: door.url });
    const tools = await Promise.all(homes.map(async (home) => await toolsOf(door, home.name)));
    const agents: Plain[] = homes.map((home, at) => ({
      slug: home.name,
      heard: heardFrom(child, home.name),
      connected: connectedLine({
        slug: home.name,
        url: door.url,
        ...(tools[at] === undefined ? {} : { tools: tools[at] }),
        org: orgOf(who),
        env: who.env,
        source: door.source,
      }),
      after: () => onceUp(door, home.name, process.stdout.isTTY === true),
    }));
    return await plain(held, agents, door.url);
  } finally {
    await companion.close();
    await child.stop();
  }
}

// One process serves them all, so it is one language's.
function oneLanguage(homes: Home[]): string | undefined {
  const languages = new Set(homes.map((home) => languageOf(home.file)));
  if (languages.size <= 1) return undefined;
  return `the agents of this project are in ${[...languages].join(" and ")}, and one process serves one language: add ${named(homes)}`;
}

function named(homes: Home[]): string {
  return homes.map((home) => `--agent ${home.name}`).join(" or ");
}

function refused(said: string): number {
  process.stderr.write(`${said}\n`);
  return 2;
}

// Each agent's prompt through its serve entry, under its slug when there are several.
async function prompts(homes: Home[]): Promise<number> {
  let worst = 0;
  for (const home of homes) {
    if (homes.length > 1) process.stdout.write(`── ${home.name} ──\n`);
    const args = ["--file", home.file, "--slug", home.name, "--show-machine"];
    const started = startedWith(undefined, home.file, "prompt", args, { root: home.root });
    worst = Math.max(worst, await runOnce(started, process.stdout, process.stderr));
  }
  return worst;
}

// An org member's Stop on the companion lets the console go; the agent's process is told to leave too.
async function companionStopped(companion: Companion, child: Child): Promise<number> {
  await new Promise<void>((done) =>
    companion.pc.onStopped((why) => {
      process.stderr.write(`${why}\n`);
      done();
    }),
  );
  return await child.stop();
}

/** One agent's entries off the process's lines, as the screens read them. */
function heardFrom(child: Child, slug: string): Listen {
  return (listener: (event: CamelEvent) => void) =>
    child.onEvent((line: EventLine) => {
      if (line.agent === slug) listener({ type: line.type, data: toCamel(line.data) } as CamelEvent);
    });
}

// The tool count on the connected line; a gateway that will not say leaves it off.
async function toolsOf(door: Door, slug: string): Promise<number | undefined> {
  try {
    const config = await asked<{ tools?: unknown[] }>(door, `/v1/agents/${encodeURIComponent(slug)}/config`);
    return config.tools?.length;
  } catch {
    return undefined;
  }
}

// Lines printed after connect: console URL, the agent's doors, and its phone line if any. Doors come
// from the org's table, not the class. Failures print a line; the agent keeps running.
async function onceUp(door: Door, slug: string, terminal: boolean): Promise<string[]> {
  const doors = await theDoors(door);
  const said = [await consoleLine(door, slug, terminal), doorsOf(slug, doors)];
  if (doors.some((one) => one.agent === slug && one.number !== null)) said.push(await lineLine(door, slug));
  return said;
}

// Best-effort: a failure only omits the `doors` line.
async function theDoors(door: Door): Promise<Door_[]> {
  try {
    return await doorsOfTheOrg(door);
  } catch {
    return [];
  }
}

// A number rings in one place per world; printed so a second developer sees they did not take it.
async function lineLine(door: Door, slug: string): Promise<string> {
  try {
    return `line     ${describing(await theLine(door, slug))}`;
  } catch (refused) {
    return `line     not available: ${whyNoConsole(refused)}`;
  }
}
