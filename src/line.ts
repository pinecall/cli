/** `pinecall line`: which terminal an agent's number rings in, and claiming it. */

import { type TheLine } from "@pinecall/agents/wire";

import { keepCalling } from "./signed-in.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { oneHome } from "./home.js";
import { asked, type Door } from "./testing/gateway.js";

const USAGE = "usage: pinecall line [from <+number> | forget | claim | release] [agent.tsx] [--agent <name>]";

// In the sandbox several developers may run the same agent on one shared number, so the terminal
// it rings in is claimed; the first `pinecall start` takes it by default.
export const group: Group = {
  purpose: "which phone is yours, and whose terminal anybody else's call rings in",
  usage: `${USAGE}

  With nothing after it: who is answering this agent's number right now, and who else is running
  it and could take it.

  \`from <+number>\` is the one you want. Say which phone is YOURS, once, and every call you make
  reaches your own agent — on the number your customers call, in production, as much as on a
  sandbox one: while you are running the agent your phone reaches your copy, and everybody else
  reaches production. No claim, no coordination, three of you testing at the same time. It is
  said in the sandbox, kept in ~/.pinecall/session.json under the gateway's URL, and re-sent by
  every \`pinecall start\`, each time it connects.
  \`forget\` undoes it.

  \`claim\` and \`release\` are the fallback, for a call from a number nobody said was theirs — a
  customer, a colleague's phone. The first terminal to hold the agent has it; alone, you never
  need either word.

  The agent is the one in this directory; at the root of a project of several, \`claim\`,
  \`release\` and the bare \`line\` take --agent <name>. \`from\` and \`forget\` are about your phone.

  Examples
    $ pinecall line from +59899111111
    calls from +59899111111 reach this terminal

    $ pinecall line
    rings in berna@clinica.test · \`pinecall line from <+your-number>\` routes yours, or \`claim\` takes it

    $ pinecall line claim
    rings in this terminal · also running: berna@clinica.test`,
  run,
};

const VERBS = new Set(["from", "forget", "claim", "release"]);

export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const [verb, ...rest] = VERBS.has(argv[0] ?? "") ? argv : ["show", ...argv];
  const door = await theDoor();
  if (door === undefined) return 2;

  // `from` and `forget` apply to the person, not an agent, so no class is loaded.
  if (verb === "from") {
    const number = rest[0];
    if (number === undefined) {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    const said = await callsFrom(door, number);
    keepCalling(door.url, number);
    out.write(`${calling(said.calling)}\n`);
    return 0;
  }
  if (verb === "forget") {
    const said = await forgetCallsFrom(door);
    keepCalling(door.url, undefined);
    out.write(`${forgotten(said.forgot)}\n`);
    return 0;
  }

  const flag = rest.indexOf("--agent");
  const named = flag === -1 ? undefined : rest[flag + 1];
  const file = (flag === -1 ? rest : [...rest.slice(0, flag), ...rest.slice(flag + 2)])[0];
  const slug = (await oneHome("line", file, named)).name;
  const said =
    verb === "claim"
      ? await claimed(door, slug)
      : verb === "release"
        ? await released(door, slug)
        : await theLine(door, slug);
  out.write(`${verb === "release" && !said.held ? letGo(said.agent) : describing(said)}\n`);
  return 0;
}

/** What a release says when nobody else was there to pick the line up. */
export function letGo(agent: string): string {
  return `let go, and nobody else is running ${agent}: a call from a number nobody said was theirs rings nowhere until a terminal claims it`;
}

/** Register your phone number so its calls reach your own running agents. */
export async function callsFrom(door: Door, number: string): Promise<{ calling: string[] }> {
  return await asked<{ calling: string[] }>(door, FROM, { method: "PUT", body: { number } });
}

/** Unregister your phone number; its calls fall back to whoever holds the line. */
export async function forgetCallsFrom(door: Door): Promise<{ forgot: string[] }> {
  return await asked<{ forgot: string[] }>(door, FROM, { method: "DELETE" });
}

/** Confirmation line after `from`. */
export function calling(numbers: string[]): string {
  return numbers.length === 1
    ? `calls from ${numbers[0]} reach this terminal`
    : `calls from ${numbers.join(", ")} reach this terminal`;
}

/** Confirmation line after `forget`, explicit when nothing was registered. */
export function forgotten(numbers: string[]): string {
  return numbers.length === 0
    ? "no number was reaching this terminal"
    : `calls from ${numbers.join(", ")} no longer reach this terminal`;
}

/** One of the org's routes: agent, channel, and number when it has one. */
export interface Door_ {
  agent: string;
  channel: string;
  number: string | null;
}

/**
 * Every route of every agent in this corner. Read from the gateway because numbers are org data,
 * not class fields; the `app` scope lets a server token read it too.
 */
export async function doorsOfTheOrg(door: Door): Promise<Door_[]> {
  return await asked<Door_[]>(door, "/v1/routes");
}

/** Who is answering this agent's number right now. */
export async function theLine(door: Door, slug: string): Promise<TheLine> {
  return await asked<TheLine>(door, path(slug));
}

/** Claim the line for this terminal. */
export async function claimed(door: Door, slug: string): Promise<TheLine> {
  return await asked<TheLine>(door, path(slug), { method: "POST" });
}

/** Release the line to another terminal running the agent. */
export async function released(door: Door, slug: string): Promise<TheLine> {
  return await asked<TheLine>(door, path(slug), { method: "DELETE" });
}

function path(slug: string): string {
  return `/v1/agents/${encodeURIComponent(slug)}/line`;
}

// Per person, not per agent: one registration covers every agent you run.
const FROM = "/v1/line/from";

/** Describe where the line rings and how to change it. Names people by email, never member id. */
export function describing(said: TheLine): string {
  if (!said.held) return `nobody is answering ${said.agent}: run \`pinecall start\``;
  // Routing by number takes precedence over holding the line.
  const mine = said.calling.length > 0 ? `your calls from ${said.calling.join(", ")}` : undefined;
  if (said.yours) {
    const also = [mine, whoElse(said)].filter((part) => part !== undefined);
    return ["rings in this terminal", ...also].join(" · ");
  }
  const theirs = `rings in ${whose(said)}`;
  if (mine !== undefined) return `${theirs}, but not ${mine}`;
  return `${theirs} · \`pinecall line from <+your-number>\` routes yours, or \`claim\` takes it`;
}

/** Name of whoever holds the line. */
function whose(said: TheLine): string {
  const name = said.holding?.name;
  return name === null || name === undefined ? "the terminal running the org's own key" : name;
}

/** Others running this agent, or undefined when none. */
function whoElse(said: TheLine): string | undefined {
  const names = said.waiting.map((one) => one.name ?? "the org's own key");
  return names.length === 0 ? undefined : `also running: ${names.join(", ")}`;
}
