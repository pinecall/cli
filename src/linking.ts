/** `pinecall link`: tie the project folder to an org by writing its key to `.env`. */

import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { DOTENV } from "./dotenv.js";
import { CLOUD_URL } from "./env.js";
import { ignoredByGit } from "./git.js";
import type { Group } from "./groups.js";
import { signedInThrough, type Signing } from "./login.js";
import { keyIn, keyWritten, slugOf, theirOrgs, type Theirs } from "./org-key.js";
import { pinecallHome, signedIn } from "./signed-in.js";
import type { Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";
import { PRODUCTION } from "./world.js";

const USAGE = "usage: pinecall link [--org <slug>] [--gateway <url>]";

export const group: Group = {
  purpose: "this project's folder to one of your orgs: your key, in its .env",
  usage: `${USAGE}

  Run in the project's folder. Signs this machine in through a browser when it is not, asks
  which of your orgs this project is — --org names it — and writes your key for that org into
  ./.env as PINECALL_KEY (and PINECALL_URL when the gateway is not ${CLOUD_URL}). Every verb run
  in this folder, or under it, reads it from there: a project of another org is another folder
  with its own .env, and nothing is ever switched.

  The key is yours: your role decides what it may do, and --prod reaches production while your
  org lets you act there. A server does not link: a server's token from Tokens, in its secrets.

  --org <slug>     which org, when you belong to several and do not want to be asked
  --gateway <url>  another gateway than the one this machine last signed in to

  Examples
    ~/clinica $ pinecall link --org clinica
    ▸ clinica · PINECALL_KEY written to .env
    git would commit .env: add it to .gitignore before a commit carries your key`,
  run: link,
};

/** Test overrides: target folder and org chooser. */
export interface Linking extends Signing {
  from?: string;
  /** Pick an org when several match and none was named. */
  choose?: (slugs: string[]) => Promise<string | undefined>;
}

/** Sign in if needed, pick the org, mint the key there, and write it into the project's `.env`. */
export async function link(argv: string[], how: Linking = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values } = parseArgs({
    args: argv,
    options: { org: { type: "string" }, gateway: { type: "string" } },
  });
  const home = pinecallHome(how.env ?? process.env);
  const session = signedIn(values.gateway, home);
  const url = session?.url ?? values.gateway ?? CLOUD_URL;
  const key = session?.key ?? (await signedInThrough(url, how, out, err));
  if (key === null) return 1;
  const door: Door = { url, apiKey: key, world: PRODUCTION };

  let orgs: Theirs[];
  try {
    orgs = await theirOrgs(door);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  const chosen = await theOrg(orgs, values.org, how);
  if (chosen === undefined) {
    const slugs = orgs.map(slugOf);
    err.write(`${values.org === undefined ? "which org is this project?" : `you are no member of ${values.org}:`} --org ${slugs.join(" | ")}\n`);
    return 2;
  }
  let theirs: string;
  try {
    theirs = await keyIn(door, chosen);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }

  const { file, names } = keyWritten(how.from ?? process.cwd(), url, theirs);
  out.write(`▸ ${slugOf(chosen)} · ${names.join(" and ")} written to ${DOTENV}\n`);
  // Warn on every run until .env is git-ignored, so the key is never committed.
  if (!ignoredByGit(file)) err.write(`git would commit ${DOTENV}: add it to .gitignore before a commit carries your key\n`);
  return 0;
}

/** The named org, the only org, or the one the person picks; undefined when none fits. */
async function theOrg(orgs: Theirs[], named: string | undefined, how: Linking): Promise<Theirs | undefined> {
  if (named !== undefined) return orgs.find((org) => org.slug === named || org.org === named);
  if (orgs.length <= 1) return orgs[0];
  const picked = await (how.choose ?? askTheTerminal)(orgs.map(slugOf));
  return orgs.find((org) => slugOf(org) === picked);
}

/** Prompt with a numbered list; undefined when stdin is not a TTY. */
async function askTheTerminal(slugs: string[]): Promise<string | undefined> {
  if (process.stdin.isTTY !== true) return undefined;
  const asking = createInterface({ input: process.stdin, output: process.stdout });
  try {
    slugs.forEach((slug, at) => process.stdout.write(`  ${at + 1}. ${slug}\n`));
    const answer = (await asking.question("which org is this project? ")).trim();
    return slugs[Number(answer) - 1] ?? slugs.find((slug) => slug === answer);
  } finally {
    asking.close();
  }
}
