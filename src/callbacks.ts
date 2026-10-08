/** `pinecall callbacks`: list callback requests left when every seat was taken. */

import { doorLine, theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { notASlug } from "./home.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const CALLBACKS = "/v1/callbacks";

/** One callback request as the gateway lists it. */
export interface Callback {
  position: number;
  agent: string;
  ts: number;
  channel: string;
  number: string;
  via: "overflow" | "widget" | "agent";
  call: string | null;
}

interface Page {
  requests: Callback[];
  next: number | null;
}

export const group: Group = {
  purpose: "the numbers people left when every seat was taken: who to call back",
  usage: `usage: pinecall callbacks [--agent <slug>] [--after <cursor>]

  Every callback.requested this org's agents wrote — a phone caller the overflow agent answered,
  one the agent's own tool promised a call back, or a web visitor who left a number at the widget — oldest first, with the cursor the next page
  starts at. The runtime records them; dialing back is your app's.`,
  run,
};

/** Print one page of callback requests, one line each. */
export async function run(
  argv: string[],
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const door = await theDoor(env, err);
  if (door === undefined) return 2;
  const query = new URLSearchParams();
  const agent = flag(argv, "--agent");
  const aFile = notASlug(agent);
  if (aFile !== undefined) {
    err.write(`${aFile}\n`);
    return 2;
  }
  const after = flag(argv, "--after");
  if (agent !== undefined) query.set("agent", agent);
  if (after !== undefined) query.set("after", after);
  let page: Page;
  try {
    page = await callbacks(door, query);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  out.write(`${doorLine(door)}\n`);
  if (page.requests.length === 0) {
    out.write("nobody is waiting for a call back\n");
    return 0;
  }
  for (const one of page.requests) out.write(`${lineOf(one)}\n`);
  if (page.next !== null) out.write(`more: --after ${page.next}\n`);
  return 0;
}

/** Fetch one page of callback requests. */
export async function callbacks(door: Door, query: URLSearchParams): Promise<Page> {
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return await asked<Page>(door, `${CALLBACKS}${suffix}`);
}

/** One request as a line: time, agent, number, channel and source. */
export function lineOf(one: Callback): string {
  const when = new Date(one.ts * 1000).toISOString().slice(0, 16).replace("T", " ");
  const took = one.via === "overflow" ? `overflow on ${one.call ?? "?"}` : one.via === "agent" ? `the agent on ${one.call ?? "?"}` : "the widget";
  return `${when}  ${one.agent}  ${one.number}  ${one.channel}  via ${took}`;
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}
