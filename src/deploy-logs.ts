/** `pinecall deploy logs`: an app's last lines, fresh from Pinecall, once or as they come. */

import type { AppLogs } from "@pinecall/agents/wire";

import { asked, type Door } from "./testing/gateway.js";

/** How often Pinecall is asked while waiting and following, and how long a first read waits. */
export interface Pacing {
  everyMs: number;
  withinMs: number;
  /** Ends a follow; the CLI's never does and Ctrl-C ends the process. */
  until: () => boolean;
}

const NOTHING_YET = (name: string): string =>
  `${name}: Pinecall sent no lines yet — is it running? \`pinecall deploy list\` says`;

const STALE = (name: string, seconds: number): string =>
  `${name}: Pinecall sent nothing new; these are its lines from ${seconds}s ago`;

/**
 * Asking is what makes Pinecall's runner send the lines, on its next beat: the first answer is
 * what it sent last. Wait for lines read after this ask, then print them; follow prints what came
 * after, until `until()`.
 */
export async function logsOf(door: Door, name: string, follow: boolean, pacing: Pacing, out: NodeJS.WritableStream): Promise<number> {
  const askedAt = Date.now() / 1000;
  let seen = await fresh(door, name, askedAt, pacing);
  if (seen.at === null && seen.lines === "") {
    out.write(`${NOTHING_YET(name)}\n`);
    return follow ? await followed(door, name, seen, pacing, out) : 1;
  }
  if (seen.at !== null && seen.at < askedAt) out.write(`${STALE(name, Math.round(askedAt - seen.at))}\n`);
  out.write(withNewline(seen.lines));
  return follow ? await followed(door, name, seen, pacing, out) : 0;
}

/** The lines after the part two reads share: what a follow prints of a newer read. */
export function newLines(before: string, after: string): string[] {
  const old = before.split("\n").filter((line) => line !== "");
  const now = after.split("\n").filter((line) => line !== "");
  for (let shared = Math.min(old.length, now.length); shared > 0; shared -= 1) {
    if (old.slice(old.length - shared).every((line, i) => line === now[i])) return now.slice(shared);
  }
  return now;
}

async function fresh(door: Door, name: string, since: number, pacing: Pacing): Promise<AppLogs> {
  const started = Date.now();
  let read = await ask(door, name);
  while ((read.at === null || read.at < since) && Date.now() - started < pacing.withinMs) {
    await pause(pacing.everyMs);
    read = await ask(door, name);
  }
  return read;
}

async function followed(door: Door, name: string, first: AppLogs, pacing: Pacing, out: NodeJS.WritableStream): Promise<number> {
  let last = first;
  while (!pacing.until()) {
    await pause(pacing.everyMs);
    const read = await ask(door, name);
    if (read.at === null || read.at === last.at) continue;
    const added = newLines(last.lines, read.lines);
    if (added.length > 0) out.write(`${added.join("\n")}\n`);
    last = read;
  }
  return 0;
}

async function ask(door: Door, name: string): Promise<AppLogs> {
  return await asked<AppLogs>(door, `/v1/hosted/${encodeURIComponent(name)}/logs`);
}

function withNewline(lines: string): string {
  return lines === "" || lines.endsWith("\n") ? lines : `${lines}\n`;
}

async function pause(ms: number): Promise<void> {
  await new Promise((waited) => setTimeout(waited, ms));
}
