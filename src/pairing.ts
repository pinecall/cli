/** Device pairing with the gateway: a one-use sign-in link, the key collected once a person approves it, verified and kept. */

import { pinecallHome, signIn } from "./signed-in.js";
import { asked, type Door } from "./testing/gateway.js";
import { thisMachine } from "./this-machine.js";
import { whoIs, type Who } from "./whoami.js";
import { PRODUCTION } from "./world.js";

// The pairing code expires after ten minutes; stop polling shortly after.
const EVERY_MS = 2_000;
const GIVE_UP_MS = 11 * 60 * 1_000;

export const TOOK_TOO_LONG = "nobody approved this terminal: `pinecall login` again when you are ready";

/** How often to ask for the key, and for how long, in ms. */
export interface Patience {
  every?: number | undefined;
  until?: number | undefined;
}

/** A pairing the gateway opened: the link a person opens, and the key once they approve it. */
export interface Pairing {
  link: string;
  /** The key, once approved; throws when the code is gone or nobody approved it in time. */
  collected(patience?: Patience): Promise<string>;
}

/** Open a pairing on this gateway; it carries only a one-time code that expires in ten minutes. */
export async function paired(url: string): Promise<Pairing> {
  // Accounts exist only in production; the sandbox has none.
  const door: Door = { url, apiKey: "", world: PRODUCTION };
  const { code } = await asked<{ code: string }>(door, "/v1/login/pairings", { method: "POST", body: { device: thisMachine() } });
  return { link: signingIn(url, code), collected: (patience = {}) => collected(door, code, patience) };
}

/** The gateway's sign-in page URL for a pairing code. */
export function signingIn(gateway: string, code: string): string {
  return `${gateway.replace(/\/$/, "")}/cli?c=${encodeURIComponent(code)}`;
}

/** Verify the key, then keep it as this machine's sign-in, so a broken key is never saved. */
export async function keptAs(url: string, key: string, env: NodeJS.ProcessEnv): Promise<Who> {
  const who = await whoIs({ url, apiKey: key, world: PRODUCTION });
  signIn(url, key, pinecallHome(env));
  return who;
}

// 202 with no key means not approved yet; a refusal means the code was collected or expired.
async function collected(door: Door, code: string, patience: Patience): Promise<string> {
  const every = patience.every ?? EVERY_MS;
  const until = Date.now() + (patience.until ?? GIVE_UP_MS);
  while (Date.now() < until) {
    const answered = await asked<{ key?: string }>(door, `/v1/login/pairings/${code}/key`);
    if (answered?.key !== undefined) return answered.key;
    await new Promise((rung) => setTimeout(rung, every));
  }
  throw new Error(TOOK_TOO_LONG);
}
