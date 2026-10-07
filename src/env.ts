/** Resolve the gateway URL, key and world every CLI verb uses. */

import { relative } from "node:path";

import type { World } from "@pinecall/agents/client";
import { nearestDotenv, readDotenv } from "./dotenv.js";
import { refusal } from "./whoami.js";
import { PRODUCTION, SANDBOX, theChosenWorld } from "./world.js";

/** Pinecall's cloud: the default gateway, serving both worlds. */
export const CLOUD_URL = "https://cloud.pinecall.io";

/** Environment variables for the key and the gateway URL. */
export const KEY_VARIABLE = "PINECALL_KEY";
export const URL_VARIABLE = "PINECALL_URL";

/** The project's gateway, key (if any) and where the key was read. */
export interface Held {
  url: string;
  apiKey: string | undefined;
  /** `the environment`, or the `.env` path relative to the cwd. */
  source: string;
}

/** A resolved gateway: URL, key, key source and world. */
export interface Open {
  url: string;
  apiKey: string;
  source: string;
  world: World;
}

/**
 * Read `PINECALL_KEY` and `PINECALL_URL` from the environment, else from the nearest `.env`.
 * v1's `PINECALL_API_KEY` is deliberately ignored: another CLI may export it for a different org.
 */
export function keyFrom(env: NodeJS.ProcessEnv = process.env, from: string = process.cwd()): Held {
  const exported = env[KEY_VARIABLE];
  if (exported !== undefined && exported !== "") {
    return { url: env[URL_VARIABLE] ?? CLOUD_URL, apiKey: exported, source: "the environment" };
  }
  const file = nearestDotenv(from);
  if (file === undefined) return { url: env[URL_VARIABLE] ?? CLOUD_URL, apiKey: undefined, source: "nowhere" };
  const values = readDotenv(file);
  const key = values[KEY_VARIABLE];
  return {
    url: env[URL_VARIABLE] ?? values[URL_VARIABLE] ?? CLOUD_URL,
    apiKey: key === "" ? undefined : key,
    source: relative(from, file) || file,
  };
}

// Constants are read inside the function, not at module load: world.ts imports this file via whoami.ts.
/** The sandbox for a sandbox server's token (`pc_test_`); undefined for any other key, which the gateway places. */
export function aServersWorld(key: string): World | undefined {
  // A person's key is minted `pc_live_` too (it opens both worlds), so only the sandbox's prefix
  // says a server's world before the request: a `pc_live_` key goes, and the gateway refuses a
  // production server's token asked for the sandbox in its own sentence.
  if (key.startsWith("pc_test_")) return SANDBOX;
  return undefined;
}

/** Error message for a server token used against the other world. */
export function anotherWorldsToken(token: World, url: string): string {
  const fix = token === PRODUCTION ? "run the verb with --prod" : "run the verb without --prod";
  return `this PINECALL_KEY is a ${token} server's token, made at ${url}: ${fix}`;
}

/**
 * Resolve the gateway for the chosen world, or print why not and return undefined. One gateway
 * serves both worlds: the URL and the key are the project's, and the world rides the request.
 */
export async function theDoor(
  env: NodeJS.ProcessEnv = process.env,
  err: NodeJS.WritableStream = process.stderr,
  from: string = process.cwd(),
  world: World = theChosenWorld(),
): Promise<Open | undefined> {
  const { apiKey, ...held } = keyFrom(env, from);
  if (apiKey === undefined) {
    err.write(`${NO_KEY}\n`);
    return undefined;
  }
  try {
    return doorIn(world, { ...held, apiKey, world });
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return undefined;
  }
}

/**
 * The project's door in a world. A person's key opens both, and the `pinecall-env` header says
 * which; a server's token has the world its prefix names, and `--prod` must agree.
 */
export function doorIn(world: World, project: Open): Open {
  const token = aServersWorld(project.apiKey);
  if (token !== undefined && token !== world) throw new Error(anotherWorldsToken(token, project.url));
  return { ...project, world };
}

/** Error message when no key is found. */
export const NO_KEY =
  "no PINECALL_KEY here: `pinecall link` in the project's folder writes it to .env (a server keeps it in its secrets)";

/** The first line a connecting verb prints: gateway, key source and world. */
export function doorLine(door: Open): string {
  return `gateway ${door.url} · key from ${door.source} · ${door.world}`;
}
