/** ~/.pinecall/session.json: this machine's sign-in per gateway, and the phone it calls from. */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Owner-only: other accounts on the machine can neither list the directory nor read the file.
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SESSION = "session.json";

/** The session directory: `PINECALL_HOME`, else ~/.pinecall. */
export function pinecallHome(env: NodeJS.ProcessEnv = process.env): string {
  return env["PINECALL_HOME"] ?? join(homedir(), ".pinecall");
}

/** What this machine keeps for one gateway. */
export interface Signed {
  /** The key from `pinecall login` on this gateway; `link` mints project keys from it. */
  key?: string;
  /**
   * The person's own phone number (`pinecall line from`), so a sandbox ring from it reaches their
   * agent. Re-sent by every `pinecall start`; the gateway does not persist it.
   */
  calling?: string;
}

/**
 * The machine's sign-in, one entry per gateway plus the last one used. A project's key lives in its
 * `.env`, never here; this lets `link` mint keys without the browser.
 */
export interface Session {
  gateways: Record<string, Signed>;
  last?: string;
}

/** Read the session, or an empty one when there is no file. */
export function readSession(home: string = pinecallHome()): Session {
  try {
    const parsed = JSON.parse(readFileSync(join(home, SESSION), "utf8")) as Partial<Session>;
    return { gateways: parsed.gateways ?? {}, ...(parsed.last === undefined ? {} : { last: parsed.last }) };
  } catch {
    return { gateways: {} };
  }
}

/** Store the key for a gateway and make it the last one used. */
export function signIn(url: string, key: string, home: string = pinecallHome()): void {
  const session = readSession(home);
  const kept = session.gateways[url];
  session.gateways[url] = { ...kept, key };
  session.last = url;
  writeSession(session, home);
}

/** The signed-in gateway and key: the one named, else the last one used. */
export function signedIn(url: string | undefined, home: string = pinecallHome()): { url: string; key: string } | undefined {
  const session = readSession(home);
  const at = url ?? session.last;
  const key = at === undefined ? undefined : session.gateways[at]?.key;
  return at === undefined || key === undefined ? undefined : { url: at, key };
}

/** The phone number set by `pinecall line from` for this gateway. */
export function callingFrom(url: string, home: string = pinecallHome()): string | undefined {
  return readSession(home).gateways[url]?.calling;
}

/** Set or clear the caller phone number; a no-op for a gateway never signed in to. */
export function keepCalling(url: string, number: string | undefined, home: string = pinecallHome()): void {
  const session = readSession(home);
  const signed = session.gateways[url];
  if (signed === undefined) return;
  const { calling: _was, ...rest } = signed;
  session.gateways[url] = number === undefined ? rest : { ...rest, calling: number };
  writeSession(session, home);
}

function writeSession(session: Session, home: string): void {
  mkdirSync(home, { recursive: true, mode: DIRECTORY_MODE });
  const file = join(home, SESSION);
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { mode: FILE_MODE });
  // writeFileSync's mode applies only on create.
  chmodSync(file, FILE_MODE);
}
