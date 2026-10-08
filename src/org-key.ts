/** A project's key as data: the person's orgs, the key minted in the one chosen, and the `.env` it is written to. */

import { join } from "node:path";

import { DOTENV, writeDotenv } from "./dotenv.js";
import { CLOUD_URL, KEY_VARIABLE, URL_VARIABLE } from "./env.js";
import { asked, type Door } from "./testing/gateway.js";

/** One org from `GET /v1/login/orgs`. */
export interface Theirs {
  org: string;
  slug?: string | null;
  here: boolean;
  /** False for orgs an operator can enter without membership; those cannot be linked. */
  member?: boolean;
}

/** The orgs the signed-in person is a member of. */
export async function theirOrgs(door: Door): Promise<Theirs[]> {
  return (await asked<{ orgs: Theirs[] }>(door, "/v1/login/orgs")).orgs.filter((org) => org.member !== false);
}

/** The person's key in the chosen org: the machine's own when it is already that org's, else one minted there. */
export async function keyIn(door: Door, chosen: Theirs): Promise<string> {
  if (chosen.here) return door.apiKey;
  return (await asked<{ key: string }>(door, "/v1/login/org", { method: "POST", body: { org: chosen.org } })).key;
}

/** Write the key, and the gateway when it is not Pinecall Cloud, into the project's `.env`; returns the file and the names written. */
export function keyWritten(root: string, url: string, key: string): { file: string; names: string[] } {
  const file = join(root, DOTENV);
  const written: Record<string, string> = { [KEY_VARIABLE]: key };
  if (url !== CLOUD_URL) written[URL_VARIABLE] = url;
  writeDotenv(file, written);
  return { file, names: Object.keys(written) };
}

/** The org as a person names it. */
export function slugOf(org: Theirs): string {
  return org.slug ?? org.org;
}
