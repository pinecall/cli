/** `pinecall webhook`: where this org's alerts are posted — a URL of its own, signed with a secret, proven with a test. */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { aLineOfStdin, nobodyIsTyping, typedInSilence } from "./secret.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall webhook                          where this org's alerts are posted
       pinecall webhook set <url> [--secret]     a URL of yours; the secret, if any, on stdin
       pinecall webhook test                     one signed test post, waited for
       pinecall webhook clear`;

const PATH = "/v1/webhook";
const NOWHERE = "this org posts its alerts nowhere · `pinecall webhook set <url>` names a URL";

export const group: Group = {
  purpose: "where this org's alerts are posted: a webhook of its own, set with a secret, proven with a test, cleared",
  usage: `${USAGE}

  Every alert of the org — a monitor that fired (monitor.fired), today's spend three times the
  usual (spend.unusual), a quota that ran out (credits.exhausted) — is written on the agent's log
  and, with a webhook set, posted there too as JSON: {type, org, env, agent, at, data}, with
  x-pinecall-event naming the type. Tried twice within five seconds; a URL that fails is logged
  and the log keeps the alert.

  set takes the URL on the command line and, with --secret, the secret from stdin — typed with
  nothing echoed on a terminal, or piped — never from a flag. With a secret every post carries
  x-pinecall-signature: sha256=<HMAC-SHA256 of the body>, so your server can refuse a post that
  is not Pinecall's. The gateway keeps the secret sealed and never reads it back: the bare verb
  prints the URL and whether posts are signed. test posts one webhook.test event, signed the same
  way, and says whether the URL answered 2xx. clear stops the posting.

  Examples
    $ printf %s "$WEBHOOK_SECRET" | pinecall webhook set https://hooks.example.com/pinecall --secret
    alerts go to https://hooks.example.com/pinecall · signed
    $ pinecall webhook test
    the URL took it: a signed webhook.test post answered 2xx
    $ pinecall webhook
    alerts go to https://hooks.example.com/pinecall · signed`,
  run,
};

/** Test overrides: streams, environment and how the secret is read. */
export interface Posting {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Read the secret. Defaults to silent TTY input or one line of stdin. */
  secret?: () => Promise<string>;
}

interface Webhook {
  url: string;
  signed: boolean;
}

interface Tested {
  sent: boolean;
  error: string | null;
}

/** Dispatch `webhook` subcommands. */
export async function run(argv: string[], how: Posting = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const [verb, ...rest] = argv;
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === undefined) return await show(door, out);
    if (verb === "set") return await set(door, rest, how.secret ?? secretOf, out, err);
    if (verb === "test" && rest.length === 0) return await test(door, out, err);
    if (verb === "clear" && rest.length === 0) return await clear(door, out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

async function show(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const found = await asked<Webhook | null>(door, PATH);
  out.write(`${found === null ? NOWHERE : described(found)}\n`);
  return 0;
}

async function set(door: Door, argv: string[], secretOf: () => Promise<string>, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { secret: { type: "boolean", default: false } } });
  const [url] = positionals;
  if (url === undefined || positionals.length > 1) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  let secret: string | null = null;
  if (values.secret) {
    secret = await secretOf();
    if (secret === "") {
      err.write("--secret: an empty secret; pipe it, or type it when asked\n");
      return 2;
    }
  }
  await asked(door, PATH, { method: "PUT", body: { url, secret } });
  out.write(`${described({ url, signed: secret !== null })}\n`);
  return 0;
}

async function test(door: Door, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const answer = await asked<Tested>(door, `${PATH}/test`, { method: "POST", body: {} });
  if (answer.sent) {
    out.write("the URL took it: a signed webhook.test post answered 2xx\n");
    return 0;
  }
  err.write(`the URL did not take it: ${answer.error ?? "no answer"}\n`);
  return 1;
}

async function clear(door: Door, out: NodeJS.WritableStream): Promise<number> {
  await asked(door, PATH, { method: "DELETE" });
  out.write("alerts stay on the agents' logs · the webhook forgotten\n");
  return 0;
}

function described(found: Webhook): string {
  return `alerts go to ${found.url} · ${found.signed ? "signed" : "not signed: set it again with --secret to sign every post"}`;
}

async function secretOf(): Promise<string> {
  return nobodyIsTyping() ? await aLineOfStdin() : await typedInSilence("secret: ", process.stderr);
}
