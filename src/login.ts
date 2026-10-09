/** `pinecall login [gateway]`: sign this machine in through a browser. */

import { parseArgs } from "node:util";

import { openInABrowser } from "./browser.js";
import { CLOUD_URL } from "./env.js";
import type { Group } from "./groups.js";
import { keptAs, paired } from "./pairing.js";
import { refusal } from "./whoami.js";

const USAGE = "usage: pinecall login [gateway-url]";

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
  no login at all: a server's token from Tokens, in its secrets as PINECALL_KEY.

  Examples
    $ pinecall login
    gateway  https://cloud.pinecall.io   (the default — \`pinecall login <url>\` for your own)

    open this to sign in:
    https://cloud.pinecall.io/cli?c=cli_…

    waiting…
    signed in to https://cloud.pinecall.io as Ana García`,
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
  try {
    const pairing = await paired(url);
    out.write(`\nopen this to sign in:\n${pairing.link}\n\nwaiting…\n`);
    (how.open ?? openInABrowser)(pairing.link);
    const key = await pairing.collected({ every: how.every, until: how.until });
    const who = await keptAs(url, key, how.env ?? process.env);
    out.write(`signed in to ${url} as ${who.name ?? who.label ?? "this key's person"}\n`);
    return key;
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return null;
  }
}
