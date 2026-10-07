/** The `console` line `pinecall start` prints: a signed-in console URL, or why there is none. */

import type { World } from "@pinecall/agents/client";
import { asked, Refused, type Door } from "./testing/gateway.js";
import { PRODUCTION } from "./world.js";

const NO_SUCH_DOOR = 404;

// One gateway serves both consoles: production's at `/`, the sandbox's under `/sandbox`.
function consoleRoot(where: string, world: World): string {
  const gateway = where.replace(/\/$/, "");
  return world === PRODUCTION ? gateway : `${gateway}/sandbox`;
}

/**
 * Console URL carrying a one-use login code (valid five minutes), so the browser gets its own key
 * and this process's key never appears in a URL.
 */
export function consoleUrl(where: string, world: World, slug: string | undefined, code: string): string {
  const at = slug === undefined ? "/" : `/a/${encodeURIComponent(slug)}`;
  return `${consoleRoot(where, world)}${at}?login=${encodeURIComponent(code)}`;
}

// A 404 on the login-code door means the gateway predates this CLI.
const OLDER_GATEWAY =
  "this gateway has no login-code door, so it is older than this CLI. Restart it: it serves the console too, and that will be stale as well.";

/** Explain why no console URL could be made. */
export function whyNoConsole(refused: unknown): string {
  if (refused instanceof Refused) {
    // The message carries the gateway's explanation, not just the status.
    return refused.status === NO_SUCH_DOOR ? OLDER_GATEWAY : refused.message;
  }
  return refused instanceof Error ? refused.message : String(refused);
}

/** Mint a one-use login code for this terminal's key. */
export async function aLoginCode(door: Door): Promise<string> {
  return (await asked<{ code: string }>(door, "/v1/login/codes", { method: "POST", body: {} })).code;
}

/** The console's own address for an agent, with no code: what a page asks a person to sign in to. */
export function consoleAddress(where: string, world: World, slug: string): string {
  return `${consoleRoot(where, world)}/a/${encodeURIComponent(slug)}`;
}

/**
 * The `console` line: a signed-in URL of the door's world, or why there is none. Signed in only
 * for a terminal: a process under pm2, systemd or a hosted app writes stdout to a log others read
 * later, and a code there is a way into the console for whoever reads it.
 */
export async function consoleLine(door: Door, slug: string, terminal: boolean): Promise<string> {
  if (!terminal) return `console  ${consoleAddress(door.url, door.world, slug)}`;
  try {
    return `console  ${consoleUrl(door.url, door.world, slug, await aLoginCode(door))}   (opens within five minutes, once)`;
  } catch (refused) {
    return `console  not available: ${whyNoConsole(refused)}`;
  }
}
