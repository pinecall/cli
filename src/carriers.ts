/** `pinecall carriers list | show | add | drop`: the org's carrier accounts, each secret read on stdin. */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { allOfStdin, nobodyIsTyping, typedInSilence } from "./secret.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall carriers list
       pinecall carriers show [<account>]
       pinecall carriers add twilio --account-sid <AC…> --user <SK…> [--label <name>]
       pinecall carriers add sip --username <user> --address <ip or network>… [--outbound-host <host>]
                             [--outbound-transport auto|udp|tcp|tls] [--outbound-username <user>] [--label <name>]
       pinecall carriers add whatsapp --phone-number-id <id> [--label <name>]
       pinecall carriers drop [<account>]`;

const CARRIER = "/v1/carrier";

/** A network a SIP peer calls from, and whether Pinecall's operator admitted it. */
interface Network {
  network: string;
  state: string;
}

/** One account as `GET /v1/carrier` answers it: named, never its secret. */
export interface CarrierRow {
  kind: string;
  account: string;
  label: string;
  networks: Network[];
}

export const group: Group = {
  purpose: "list | show | add | drop the org's carrier accounts: Twilio, a SIP peer, WhatsApp",
  usage: `${USAGE}

  An account is where the org's numbers live: a Twilio account, a SIP peer (its own PBX or a
  carrier with no API here), a WhatsApp number at Meta. It is the org's, one for both worlds, and
  \`pinecall numbers import\` then routes a number it owns to an agent.

  Every secret is read on stdin and never from the command line: typed with nothing echoed on a
  terminal, or piped one per line — a SIP peer's password, then its outbound password when
  --outbound-username is given. \`add\` with an account the org already holds replaces its secret.
  A peer's networks wait for Pinecall's operator before 5060 opens to them; \`show\` says where each
  one stands. An account's id is its own: Twilio's account SID, the peer's username, Meta's phone
  number id. \`drop\` forgets an account and leaves its numbers routed until each is dropped.`,
  run,
};

/** Output streams, environment and secret input, for tests. */
export interface Carrying {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Read one secret per name, in order. Defaults to silent prompts on a terminal, else stdin's lines. */
  secrets?: (names: string[]) => Promise<string[]>;
}

export async function run(argv: string[], how: Carrying = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const verb = argv[0] ?? "list";
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  // Reject unknown flags on `list`; parsed outside the try so the dispatcher reports exit 2.
  if (verb === "list") parseArgs({ args: argv.slice(1), options: {} });
  try {
    if (verb === "list") return await list(door, out);
    if (verb === "show") return await show(door, argv[1], out);
    if (verb === "add") return await add(argv.slice(1), door, how.secrets ?? ((names) => secretsFor(names, out)), out, err);
    if (verb === "drop") return await drop(door, argv[1], out);
  } catch (refused) {
    // The gateway's refusal names what is wrong and never echoes a secret.
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

/** Print every account of the org, one per line, oldest first. */
async function list(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const { carriers } = await asked<{ carriers: CarrierRow[] }>(door, "/v1/carriers");
  if (carriers.length === 0) {
    out.write("the org holds no carrier account: `pinecall carriers add twilio --account-sid AC… --user SK…`\n");
    return 0;
  }
  for (const row of carriers) out.write(`${aLine(row)}\n`);
  return 0;
}

/** Format an account: its id, its kind, its label, and a peer's networks with where each stands. */
export function aLine(row: CarrierRow): string {
  const said = [row.account, row.kind];
  if (row.label !== "") said.push(row.label);
  if (row.networks.length > 0) said.push(row.networks.map((one) => `${one.network} ${one.state}`).join(", "));
  return said.join(" · ");
}

/** Print one account: the org's only one, or the one named. */
async function show(door: Door, account: string | undefined, out: NodeJS.WritableStream): Promise<number> {
  out.write(`${aLine(await asked<CarrierRow>(door, withAccount(CARRIER, account)))}\n`);
  return 0;
}

/** Keep an account: its fields from the flags, its secrets from stdin. */
async function add(
  argv: string[],
  door: Door,
  secrets: (names: string[]) => Promise<string[]>,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "account-sid": { type: "string" },
      user: { type: "string" },
      username: { type: "string" },
      address: { type: "string", multiple: true },
      "outbound-host": { type: "string" },
      "outbound-transport": { type: "string" },
      "outbound-username": { type: "string" },
      "phone-number-id": { type: "string" },
      label: { type: "string" },
    },
  });
  const wanted = accountOf(positionals[0], values);
  if (typeof wanted === "string") {
    err.write(`${USAGE}\n  ${wanted}\n`);
    return 2;
  }
  const given = await secrets(wanted.secrets.map(([name]) => name));
  const body: Record<string, unknown> = { ...wanted.body };
  for (const [at, [name, field]] of wanted.secrets.entries()) {
    const secret = (given[at] ?? "").trim();
    if (secret === "") {
      err.write(`no ${name} was given: nothing was kept\n`);
      return 2;
    }
    body[field] = secret;
  }
  const kept = await asked<CarrierRow>(door, CARRIER, { method: "PUT", body });
  out.write(`kept: ${aLine(kept)}\n`);
  if (kept.networks.some((one) => one.state === "waiting"))
    out.write("  each waiting network opens once Pinecall's operator approves it: `pinecall carriers show` says when\n");
  out.write("  route one of its numbers: `pinecall numbers import <+34…> --agent <slug>`\n");
  return 0;
}

/** What `add` sends for each kind, and the secrets it reads: [what the prompt names, the field]. */
type Wanted = { body: Record<string, unknown>; secrets: [string, string][] };

/** The account the flags describe, or why they describe none. */
export function accountOf(kind: string | undefined, values: Record<string, string | string[] | undefined>): Wanted | string {
  const label = values["label"] === undefined ? {} : { label: values["label"] };
  if (kind === "twilio") {
    if (values["account-sid"] === undefined || values["user"] === undefined)
      return "a Twilio account takes --account-sid and --user (an API key SID, or the account SID again)";
    return {
      body: { kind, account_sid: values["account-sid"], user: values["user"], ...label },
      secrets: [["Twilio secret (the API key's, or the auth token)", "secret"]],
    };
  }
  if (kind === "sip") {
    const addresses = values["address"];
    if (values["username"] === undefined || !Array.isArray(addresses) || addresses.length === 0)
      return "a SIP peer takes --username and at least one --address it calls from";
    const outbound: Record<string, unknown> = {};
    if (values["outbound-host"] !== undefined) outbound["outbound_host"] = values["outbound-host"];
    if (values["outbound-transport"] !== undefined) outbound["outbound_transport"] = values["outbound-transport"];
    if (values["outbound-username"] !== undefined) outbound["outbound_username"] = values["outbound-username"];
    const secrets: [string, string][] = [["SIP password", "password"]];
    if (values["outbound-username"] !== undefined) secrets.push(["outbound password", "outbound_password"]);
    return { body: { kind, username: values["username"], addresses, ...outbound, ...label }, secrets };
  }
  if (kind === "whatsapp") {
    if (values["phone-number-id"] === undefined) return "a WhatsApp number takes --phone-number-id";
    return {
      body: { kind, phone_number_id: values["phone-number-id"], ...label },
      secrets: [["WhatsApp access token", "access_token"]],
    };
  }
  return "which kind of account: twilio, sip or whatsapp";
}

/** Forget an account; its numbers stay routed until each is dropped. */
async function drop(door: Door, account: string | undefined, out: NodeJS.WritableStream): Promise<number> {
  await asked(door, withAccount(CARRIER, account), { method: "DELETE" });
  out.write(
    `${account ?? "the org's account"} forgotten. Its numbers stay routed until each is dropped: \`pinecall numbers drop <+34…>\`\n`,
  );
  return 0;
}

function withAccount(path: string, account: string | undefined): string {
  return account === undefined ? path : `${path}?account=${encodeURIComponent(account)}`;
}

/** Read the secrets: one silent prompt each on a terminal, else one line of stdin each, in order. */
async function secretsFor(names: string[], out: NodeJS.WritableStream): Promise<string[]> {
  if (nobodyIsTyping()) {
    const lines = (await allOfStdin()).split(/\r?\n/);
    return names.map((_, at) => lines[at] ?? "");
  }
  const typed: string[] = [];
  for (const name of names) typed.push(await typedInSilence(`${name}: `, out));
  return typed;
}
