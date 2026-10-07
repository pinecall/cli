/** The world a command runs in: sandbox by default, production with `--prod`. */

import { AsyncLocalStorage } from "node:async_hooks";

import type { World } from "@pinecall/agents/client";
import type { Open } from "./env.js";
import { refusal, whoIs, type Who } from "./whoami.js";

/** The per-person development world. */
export const SANDBOX: World = "sandbox";

/** The world the org's customers reach. */
export const PRODUCTION: World = "production";

// Async context rather than a module flag, so concurrent commands (e.g. in tests) stay isolated.
const chosen = new AsyncLocalStorage<World>();

/** argv without `--prod`, and the world it selected. */
export interface Named {
  argv: string[];
  /** `production` when `--prod` was given, else undefined (sandbox). */
  world: World | undefined;
}

/** Strip the global `--prod` flag from argv so groups see only their own flags. */
export function withoutTheWorldFlag(argv: readonly string[]): Named {
  return { argv: argv.filter((word) => word !== "--prod"), world: argv.includes("--prod") ? PRODUCTION : undefined };
}

/** Run `body` with `theChosenWorld()` returning `world`. */
export function inTheWorld<T>(world: World | undefined, body: () => Promise<T>): Promise<T> {
  return world === undefined ? body() : chosen.run(world, body);
}

/** Production when `--prod` was given, else the sandbox. */
export function theChosenWorld(): World {
  return chosen.getStore() ?? SANDBOX;
}

/** Ask the chosen world's gateway who this key is. */
export async function standing(door: Open): Promise<Who> {
  return await whoIs(door);
}

/** Message for when the gateway cannot identify the key; commands never guess. */
export function cannotTell(verb: string, failed: unknown): string {
  return `\`pinecall ${verb}\` will not guess who this key is: ${refusal(failed)}`;
}
