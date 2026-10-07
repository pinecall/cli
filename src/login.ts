/** `pinecall login [gateway]`: sign this machine in through a browser. */

import { parseArgs } from "node:util";

import { openInABrowser } from "./browser.js";
import { CLOUD_URL } from "./env.js";
import type { Group } from "./groups.js";
import { pinecallHome, signIn } from "./signed-in.js";
import { asked, type Door } from "./testing/gateway.js";
import { thisMachine } from "./this-machine.js";
import { refusal, whoIs, type Who } from "./whoami.js";
import { PRODUCTION } from "./world.js";

const USAGE = "usage: pinecall login [gateway-url]";

// The pairing code expires after ten minutes; stop polling shortly after.
const EVERY_MS = 2_000;
const GIVE_UP_MS = 11 * 60 * 1_000;

const TOOK_TOO_LONG = "nobody approved this terminal: `pinecall login` again when you are ready";

export const group: Group = {
  purpose: "sign this machine in through a browser; `link` asks for it when it is needed",
  usage: `${USAGE}

  Prints a link and opens it. You sign in there — in a browser, where a password belongs — and
  the page hands this terminal a key of its OWN, minted for you and labelled as this machine, so
  it is revoked on its own from Tokens. Nothing types a password into a shell, and the day your
  org signs in with Google this verb does not change.

  With no URL it is ${CLOUD_URL}, and it says so before anything is kept.

  The key is the machine's sign-in, kept in ~/.pinecall/session.json (0600; PINECALL_HOME moves
  it), and no verb runs on it: a project runs on the key \`pinecall link\` writes into its own
  .env. \`link\` signs the machine in itself when it is not, so this is rarely typed. A server has
  no login at all: a server's token from Tokens, in its secrets as PINECALL_KEY.`,
  run: login,
};

/** Test overrides: streams, environment, browser opener and polling timing. */
export interface Signing {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Open the sign-in URL. Defaults to the system browser. */
  open?: (url: string) => void;
  /** Poll interval and timeout, in ms. */
  every?: number;
  until?: number;
}

/** Sign this machine in through a browser; the key is verified before it is stored. */
export async function login(argv: string[], how: Signing = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const url = positionals[0] ?? CLOUD_URL;
  if (positionals[0] === undefined) out.write(`gateway  ${CLOUD_URL}   (the default — \`pinecall login <url>\` for your own)\n`);
  return (await signedInThrough(url, how, out, err)) === null ? 1 : 0;
}

/**
 * Browser sign-in, key verification and storage; shared by `login` and `link`.
 * @returns the key, or null after printing the error.
 */
export async function signedInThrough(
  url: string,
  how: Signing,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<string | null> {
  const key = await throughABrowser(url, how, out, err);
  if (key === null) return null;
  // Verify before storing, so a broken key is never saved.
  let who: Who;
  try {
    who = await whoIs({ url, apiKey: key, world: PRODUCTION });
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return null;
  }
  signIn(url, key, pinecallHome(how.env ?? process.env));
  out.write(`signed in to ${url} as ${who.name ?? who.label ?? "this key's person"}\n`);
  return key;
}

/**
 * Device pairing: request a code, open the sign-in link, poll for the key. The URL carries only
 * a one-time code that expires in ten minutes. Null after printing an error.
 */
async function throughABrowser(
  url: string,
  how: Signing,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<string | null> {
  // Accounts exist only in production; the sandbox has none.
  const door: Door = { url, apiKey: "", world: PRODUCTION };
  let opened: { code: string };
  try {
    opened = await asked<{ code: string }>(door, "/v1/login/pairings", {
      method: "POST",
      body: { device: thisMachine() },
    });
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return null;
  }
  const link = signingIn(url, opened.code);
  out.write(`\nopen this to sign in:\n${link}\n\nwaiting…\n`);
  (how.open ?? openInABrowser)(link);
  return await collected(door, opened.code, how, err);
}

/** The gateway's sign-in page URL for a pairing code. */
export function signingIn(gateway: string, code: string): string {
  return `${gateway.replace(/\/$/, "")}/cli?c=${encodeURIComponent(code)}`;
}

/** Poll for the key until approved, the code is gone, or the timeout passes. */
async function collected(
  door: Door,
  code: string,
  how: Signing,
  err: NodeJS.WritableStream,
): Promise<string | null> {
  const every = how.every ?? EVERY_MS;
  const until = Date.now() + (how.until ?? GIVE_UP_MS);
  while (Date.now() < until) {
    try {
      // 202 with no key means not approved yet; an error means the code was collected or expired.
      const answered = await asked<{ key?: string }>(door, `/v1/login/pairings/${code}/key`);
      if (answered?.key !== undefined) return answered.key;
    } catch (refused) {
      err.write(`${refusal(refused)}\n`);
      return null;
    }
    await after(every);
  }
  err.write(`${TOOK_TOO_LONG}\n`);
  return null;
}

function after(ms: number): Promise<void> {
  return new Promise((rung) => setTimeout(rung, ms));
}
