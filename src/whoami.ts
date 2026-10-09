/** `pinecall whoami`: the gateway this project uses, who the key is, and which worlds it opens. */

import { parseArgs } from "node:util";

import { doorIn, doorLine, keyFrom, NO_KEY, type Open } from "./env.js";
import type { Group } from "./groups.js";
import { asked, type Door } from "./testing/gateway.js";
import { PRODUCTION, SANDBOX, theChosenWorld } from "./world.js";

// Also used by `login`, through whoIs().
const WHOAMI = "/v1/whoami";

/** The gateway's description of a key (never the key or its hash). */
export interface Who {
  org: string;
  /** The org's human-readable slug, e.g. `clinica`; absent on older gateways. */
  slug?: string | null;
  key_id: string;
  label: string | null;
  /** The world this request acted in. */
  env: string;
  /** The person the key was minted for; absent for a server token. */
  name?: string | null;
  /** Whether this key may act in production (the person's switch, any admin, or a production token). */
  production: boolean;
}

export const group: Group = {
  purpose: "which org and which key this terminal is holding, and which worlds it opens",
  usage: `usage: pinecall whoami [--prod]

  Prints the one door every verb knocks at — PINECALL_URL, with the key from the environment or
  the project's .env — and what the gateway says the key is in the world asked: the org, the
  key's id, the world, the label it was issued under, and whether you may act in production.
  Then which worlds the key opens there: a person's key opens the sandbox without --prod and
  production with it, while their production switch is on; a server's token opens the one world
  its prefix names. The key itself is neither printed nor sent anywhere else.

  Examples
    $ pinecall whoami
    gateway https://cloud.pinecall.io · key from .env · sandbox
      org clinica · key k_4f2a1d9c66b30e17 · sandbox · ana-macbook · production: yes
      a person's key: the sandbox without --prod, production with it`,
  run,
};

/** Print the project's door, who the key is there, and the worlds it opens. */
export async function run(
  argv: string[],
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  // Takes no flags of its own; parsing with none rejects unknown ones such as --json.
  parseArgs({ args: argv, options: {} });
  const { apiKey, ...held } = keyFrom(env);
  if (apiKey === undefined) {
    err.write(`${NO_KEY}\n`);
    return 2;
  }
  const world = theChosenWorld();
  try {
    const door = doorIn(world, { ...held, apiKey, world });
    const who = await whoIs(door);
    out.write(`${doorLine(door)}\n  ${describing(who)}\n  ${opening(who)}\n`);
    return 0;
  } catch (refused) {
    err.write(`${world}: ${refusal(refused)}\n`);
    return 1;
  }
}

/** Ask the gateway who this key belongs to. */
export async function whoIs(door: Door): Promise<Who> {
  return await asked<Who>(door, WHOAMI);
}

/** The org's slug for display, falling back to its id when there is none. */
export function orgOf(who: Who): string {
  return who.slug ?? who.org;
}

/** Format a key description as one line: org, key id, world, label, production access. */
export function describing(who: Who): string {
  const said = [`org ${orgOf(who)}`, `key ${who.key_id}`, who.env];
  if (who.label !== null) said.push(who.label);
  said.push(`production: ${who.production ? "yes" : "no"}`);
  return said.join(" · ");
}

/** Which worlds the key opens at this gateway: a server's token its own, a person's by their switch. */
export function opening(who: Who): string {
  if (who.name === undefined || who.name === null) {
    const token = who.env === PRODUCTION ? PRODUCTION : SANDBOX;
    return `a ${token} server's token: that world alone${token === PRODUCTION ? ", with --prod" : ""}`;
  }
  if (who.production) return "a person's key: the sandbox without --prod, production with it";
  return "a person's key: the sandbox; production is refused until an admin turns your switch on in Team";
}

/** The message of a refusal, without its JSON envelope. */
export function refusal(failed: unknown): string {
  return failed instanceof Error ? failed.message : String(failed);
}
