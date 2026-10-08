/** The `link` tool: the open project tied to one of the person's orgs, its key minted there and written into its .env. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { DOTENV } from "../../dotenv.js";
import { keyIn, keyWritten, slugOf, theirOrgs, type Theirs } from "../../org-key.js";
import { pinecallHome, signedIn } from "../../signed-in.js";
import type { Door } from "../../testing/gateway.js";
import { PRODUCTION } from "../../world.js";
import type { Session } from "../session.js";
import { Refused, tool } from "../tool.js";

export const NOT_SIGNED_IN = "this machine is not signed in: call `login` with action start, and the person opens the link it answers";

export const link = tool({
  name: "link",
  description: "List the person's orgs (`orgs`), or write the key of one of them into the open project's .env (`write`).",
  schema: {
    action: z.enum(["orgs", "write"]),
    org: z.string().optional().describe("the org's slug, for `write`; may be left out when the person has one org"),
  },
  manual:
    "`link` ties the open project to an org, once a machine is signed in (`login`): `orgs` lists them, `write` mints the person's key in the chosen one and writes it into the project's .env, which every other tool reads. The key itself never comes back to you.",
  handler: async (args, session) => {
    const door = machineDoor(session);
    const orgs = await theirOrgs(door);
    if (args.action === "orgs") return { orgs: orgs.map((org) => ({ slug: slugOf(org), this_machines: org.here })) };
    const chosen = theOrg(orgs, args.org);
    const root = await session.project();
    const { file, names } = keyWritten(root, door.url, await keyIn(door, chosen));
    return { org: slugOf(chosen), written: names, file, ...gitIgnores(root) };
  },
});

function machineDoor(session: Session): Door {
  const machine = signedIn(undefined, pinecallHome(session.env));
  if (machine === undefined) throw new Refused(NOT_SIGNED_IN);
  return { url: machine.url, apiKey: machine.key, world: PRODUCTION };
}

function theOrg(orgs: Theirs[], named: string | undefined): Theirs {
  const slugs = orgs.map(slugOf).join(", ");
  if (named === undefined) {
    if (orgs.length === 1 && orgs[0] !== undefined) return orgs[0];
    throw new Refused(`which org is this project? name one of: ${slugs}`);
  }
  const found = orgs.find((org) => org.slug === named || org.org === named);
  if (found === undefined) throw new Refused(`the person is no member of ${named}: one of ${slugs}`);
  return found;
}

// No git is asked (the server starts no process): the project's own .gitignore is read instead.
function gitIgnores(root: string): { warning?: string } {
  const ignore = join(root, ".gitignore");
  const named = existsSync(ignore) && readFileSync(ignore, "utf8").split("\n").some((line) => [DOTENV, ".env*", ".env.*"].includes(line.trim()));
  return named ? {} : { warning: `${DOTENV} holds the key and .gitignore does not name it: add it before a commit carries the key` };
}
