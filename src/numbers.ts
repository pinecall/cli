/** `pinecall numbers list | available | import | drop`: manage which number reaches which agent. */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall numbers list
       pinecall numbers available [--account <id>]
       pinecall numbers import <+34…> --agent <slug> [--channel phone|whatsapp] [--dry-run]
       pinecall numbers drop <+34…>`;

const NUMBERS = "/v1/numbers";

/** `GET /v1/numbers/available`: what the org's Twilio accounts own; a SIP peer lists none. */
interface Owned {
  kind: string;
  numbers: OwnedNumber[];
}

/** One number an account owns, and whether this world imported it. */
export interface OwnedNumber {
  number: string;
  name: string;
  imported: boolean;
  account?: string | undefined;
}

/** One row of `GET /v1/numbers`. */
interface Door_ {
  route: { number: string | null; channel: string; agent: string; env: string; managed: boolean };
}

export const group: Group = {
  purpose: "list | available | import | drop the numbers the org answers at",
  usage: `${USAGE}

  A number is one world's and reaches one agent: it is imported where it answers, and
  \`list\` shows that world's — the sandbox's, or production's with --prod. Nothing moves a
  number between the two.

  \`available\` is every number the org's Twilio accounts own, and whether this world routes it. A
  number \`not routed here\` may still sit on another org's trunk: \`import --dry-run\` says.

  \`import\` takes a number the org's carrier account already owns and points it here: the
  carrier's trunk, the SFU's trunk, the route — \`--dry-run\` prints those steps and writes
  nothing. \`drop\` forgets the route and takes the number off the SFU trunk; the carrier account
  keeps it, so nobody is un-bought by a typo.`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Numbering {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

export async function run(argv: string[], how: Numbering = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const verb = argv[0] ?? "list";
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  // Flags are parsed outside the try, so the dispatcher reports an unknown one as exit 2.
  if (verb === "list") parseArgs({ args: argv.slice(1), options: {} });
  const account = verb === "available" ? theAccount(argv.slice(1)) : undefined;
  try {
    if (verb === "list") return await list(door, out);
    if (verb === "available") return await owned(door, out, account);
    if (verb === "import") return await brought(argv.slice(1), door, out, err);
    if (verb === "drop") return await dropped(argv[1], door, out, err);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

/** Print every number in this key's world, one per line. */
async function list(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const doors = await asked<Door_[]>(door, NUMBERS);
  if (doors.length === 0) {
    out.write("no number answers in this world: `pinecall numbers import <+34…> --agent <slug>`\n");
    return 0;
  }
  for (const one of doors) out.write(`${aLine(one)}\n`);
  return 0;
}

/** Format a number row: number, channel, agent, env, and whether it was bought here. */
export function aLine(one: Door_): string {
  const said = [one.route.number ?? "—", one.route.channel, `→ ${one.route.agent}`, one.route.env];
  if (one.route.managed) said.push("bought here");
  return said.join(" · ");
}

/** `--account <id>`: one account of several; unsaid, every account the org holds. */
function theAccount(args: string[]): string | undefined {
  return parseArgs({ args, options: { account: { type: "string" } } }).values.account;
}

/** Print every number the org's accounts own, and whether this world routes it. */
async function owned(door: Door, out: NodeJS.WritableStream, account: string | undefined): Promise<number> {
  const path = account === undefined ? `${NUMBERS}/available` : `${NUMBERS}/available?account=${encodeURIComponent(account)}`;
  const found = await asked<Owned>(door, path);
  if (found.numbers.length === 0) {
    out.write(
      found.kind === "sip"
        ? "a SIP peer lists nothing here: `pinecall numbers import <+34…> --agent <slug>` takes its number as typed\n"
        : "the org's accounts own no number: buy one at the carrier, then `pinecall numbers available` again\n",
    );
    return 0;
  }
  for (const one of found.numbers) out.write(`${anOwnedLine(one)}\n`);
  return 0;
}

/** Format an owned number: the number, its name at the carrier, the account, and whether this world routes it. */
export function anOwnedLine(one: OwnedNumber): string {
  const said = [one.number];
  if (one.name !== "" && one.name !== one.number) said.push(one.name);
  if (one.account !== undefined) said.push(one.account);
  said.push(one.imported ? "routed here" : "not routed here");
  return said.join(" · ");
}

/** Import a carrier-owned number and route it to an agent. */
async function brought(
  argv: string[],
  door: Door,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { agent: { type: "string" }, channel: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  });
  const number = positionals[0];
  if (number === undefined || values.agent === undefined) {
    err.write(`${USAGE}\n  a number and the --agent that answers it\n`);
    return 2;
  }
  const body: Record<string, unknown> = { number, agent: values.agent };
  if (values.channel !== undefined) body["channel"] = values.channel;
  const path = values["dry-run"] === true ? `${NUMBERS}?dry_run=true` : NUMBERS;
  const done = await asked<{ steps: string[]; dry_run: boolean }>(door, path, { method: "POST", body });
  for (const step of done.steps) out.write(`  ${step}\n`);
  if (done.dry_run) out.write("  nothing written: drop --dry-run to do it\n");
  return 0;
}

/** Remove the route and SFU trunk entry; the carrier account keeps the number. */
async function dropped(
  number: string | undefined,
  door: Door,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  if (number === undefined) {
    err.write(`${USAGE}\n  which number to forget\n`);
    return 2;
  }
  await asked(door, `${NUMBERS}/${encodeURIComponent(number)}`, { method: "DELETE" });
  out.write(`${number} answers nothing here now. Your carrier still owns it.\n`);
  return 0;
}
