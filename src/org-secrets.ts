/** `pinecall secrets`: the values the org's hosted apps are started with, set and dropped, never shown. */

import { parseArgs } from "node:util";

import type { SecretList } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { allOfStdin, nobodyIsTyping, typedInSilence } from "./secret.js";
import { asked } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall secrets [list] [--json] [--prod]",
  "       pinecall secrets set <NAME> [--prod]          the value typed without echo, or piped in",
  "       pinecall secrets rm <NAME> [--prod]",
].join("\n");

export const group: Group = {
  purpose: "the org's secrets: what its hosted apps are started with, as environment variables",
  usage: `${USAGE}

  A secret is the org's, per world: every app \`pinecall deploy\` put on Pinecall starts with all of
  them. They are kept sealed, and nothing reads a value back — set, replace or drop. A change is a
  new start of every app of the org in that world, the old process answering until the new one
  registers. The value never goes on the command line, where the shell would keep it: it is typed
  without echo, or piped (\`printf %s "$CRM_TOKEN" | pinecall secrets set CRM_TOKEN\`).

  list          the secrets' names, who set each and when
  set <NAME>    keep one; the same name again replaces it. Capitals, digits and underscores, never
                starting with PINECALL_: Pinecall sets those itself
  rm <NAME>     the secret dropped

  Examples
    $ printf %s "$CRM_TOKEN" | pinecall secrets set CRM_TOKEN --prod
    CRM_TOKEN kept · the org's hosted apps here start again with it
    $ pinecall secrets --prod
    CRM_TOKEN   2026-09-30 13:22  m_ana`,
  run,
};

/** Output streams, environment and the value's source, for tests. */
export interface Keeping {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  value?: () => Promise<string>;
}

const VERBS = ["list", "set", "rm"] as const;

const A_NAME = /^[A-Z][A-Z0-9_]*$/;

const NOT_A_NAME = (name: string): string =>
  `${name} is no name for a secret: capitals, digits and underscores, like CRM_TOKEN`;

const THE_BOXS = (name: string): string => `${name} is Pinecall's to set: a secret never starts with PINECALL_`;

const NO_VALUE = (name: string): string => `no value for ${name}: type it, or pipe it in`;

const NONE_YET = "the org has no secrets here yet: `pinecall secrets set <NAME>`";

export async function run(argv: string[], how: Keeping = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
  const [verb = "list", name] = positionals;
  if (!(VERBS as readonly string[]).includes(verb) || (verb !== "list" && name === undefined)) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const refused = verb === "list" ? undefined : whyNot(name!);
  if (refused !== undefined) {
    err.write(`${refused}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === "list") return listed(await asked<SecretList>(door, "/v1/secrets"), values.json, out);
    const path = `/v1/secrets/${encodeURIComponent(name!)}`;
    if (verb === "rm") {
      await asked<SecretList>(door, path, { method: "DELETE" });
      out.write(`${name!} dropped\n`);
      return 0;
    }
    const value = await (how.value ?? (() => aValue(name!, out)))();
    if (value === "") {
      err.write(`${NO_VALUE(name!)}\n`);
      return 2;
    }
    await asked<SecretList>(door, path, { method: "PUT", body: { value } });
    out.write(`${name!} kept · the org's hosted apps here start again with it\n`);
    return 0;
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return 1;
  }
}

function whyNot(name: string): string | undefined {
  if (!A_NAME.test(name)) return NOT_A_NAME(name);
  if (name.startsWith("PINECALL_")) return THE_BOXS(name);
  return undefined;
}

async function aValue(name: string, out: NodeJS.WritableStream): Promise<string> {
  return nobodyIsTyping() ? await allOfStdin() : await typedInSilence(`${name}: `, out);
}

function listed(answered: SecretList, asJson: boolean, out: NodeJS.WritableStream): number {
  if (asJson) out.write(`${JSON.stringify(answered)}\n`);
  else if (answered.secrets.length === 0) out.write(`${NONE_YET}\n`);
  else {
    const wide = Math.max(...answered.secrets.map((secret) => secret.name.length));
    for (const secret of answered.secrets) {
      const when = new Date(secret.set_at * 1000).toISOString().slice(0, 16).replace("T", " ");
      out.write(`${secret.name.padEnd(wide)}  ${when}  ${secret.set_by}\n`);
    }
  }
  return 0;
}
