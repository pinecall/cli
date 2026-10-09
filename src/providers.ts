/** `pinecall providers`: the vendor catalog, and the org's own provider keys (write-only). */

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { aLineOfStdin, typedInSilence } from "./secret.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall providers [--does llm|stt|tts]  every vendor this build runs
       pinecall providers add <vendor>     the key on stdin, never on the command line
       pinecall providers rm <vendor>
       pinecall providers list             only the ones this org brought`;

export const group: Group = {
  purpose: "every vendor this build runs, and the provider keys this org brought of its own",
  usage: `${USAGE}

  With nothing after it: every vendor this build runs — what each does, every other word it
  answers to, and the one word for what it is still waiting for on this box. \`ready\` is the only
  one that runs a call; \`no plugin\` and \`no key\` are the operator's to fix, and \`its own\` is a
  vendor whose credentials are a chain or a pair and never one key anybody could bring.

  A key added here is this org's own account with that vendor, and every call of this org runs
  on it from the next one; every vendor nobody brought runs on Pinecall's own key. add reads the
  key from stdin — typed with nothing echoed on a terminal, one piped line off one — and never
  from a flag: argv is visible in \`ps\` to every user on the machine, and a key pasted as an argument
  is a key in the shell history. rm gives that vendor back to Pinecall's key.

  No door a person reads ever answers with a provider key: list prints the vendors and nothing
  else, not a value, not a prefix, not a fingerprint. The one door that does read a key back is
  the worker's — GET /v1/agents/<slug>/provider-keys, an org's own keys to an org's own process,
  on that org's key — and it is the whole reason the vault exists. A key that was lost is set
  again.

  Examples
    $ pinecall providers --does tts
    vendor        does         standing   variable              also known as
    livekit       llm,stt,tts  ready                            inference lk
    cartesia      stt,tts      no key     CARTESIA_API_KEY
    elevenlabs    stt,tts      ready      ELEVEN_API_KEY        11labs eleven elevenlab
    rime          tts          no key     RIME_API_KEY
    speechmatics  stt,tts      no plugin  SPEECHMATICS_API_KEY`,
  run,
};

/** Test overrides: streams, environment and key input. */
export interface Bringing {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Read the key. Defaults to silent TTY input or one line of stdin. */
  key?: () => Promise<string>;
}

/** Dispatch `providers` subcommands. */
export async function run(argv: string[], how: Bringing = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const [verb, vendor] = argv;
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === undefined || verb === "--does") return await catalogue(door, vendor, out, err);
    if (verb === "add" && vendor !== undefined) return await add(door, vendor, how.key, out, err);
    if (verb === "rm" && vendor !== undefined) return await remove(door, vendor, out);
    if (verb === "list") return await list(door, out);
  } catch (refused) {
    // The gateway's message names valid vendors and never echoes the key.
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

// The key is read from stdin (never argv, which `ps` exposes) and never printed.
async function add(
  door: Door,
  vendor: string,
  given: (() => Promise<string>) | undefined,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const key = (await (given ?? (() => aKeyFor(vendor, out)))()).trim();
  if (key === "") {
    err.write("no key was given: nothing was brought\n");
    return 2;
  }
  await asked(door, pathFor(vendor), { method: "PUT", body: { key } });
  out.write(`${vendor}\n`);
  return 0;
}

async function remove(door: Door, vendor: string, out: NodeJS.WritableStream): Promise<number> {
  await asked(door, pathFor(vendor), { method: "DELETE" });
  out.write(`${vendor}\n`);
  return 0;
}

async function list(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const brought = await asked<{ vendors: string[] }>(door, "/v1/provider-keys");
  if (brought.vendors.length === 0) {
    out.write("no provider key brought: every call runs on the keys of Pinecall\n");
    return 0;
  }
  for (const vendor of brought.vendors) out.write(`${vendor}\n`);
  return 0;
}

const MODALITIES = ["llm", "stt", "tts"];

/** One row of `GET /v1/providers`. */
interface Provider {
  name: string;
  does: string[];
  standing: string;
  env: string | null;
  aliases: string[];
}

// Print the catalog in its own order, optionally filtered by modality.
async function catalogue(
  door: Door,
  does: string | undefined,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  if (does !== undefined && !MODALITIES.includes(does)) {
    err.write(`no modality called ${does}: ${MODALITIES.join(" | ")}\n`);
    return 2;
  }
  const said = await asked<{ providers: Provider[]; defaults: Record<string, string> }>(door, "/v1/providers");
  const shown = does === undefined ? said.providers : said.providers.filter((one) => one.does.includes(does));
  const rows = shown.map((one) => [one.name, one.does.join(","), one.standing, one.env ?? "", one.aliases.join(" ")]);
  for (const line of asColumns([["vendor", "does", "standing", "variable", "also known as"], ...rows])) out.write(`${line}\n`);
  const ours = Object.entries(said.defaults).map(([job, vendor]) => `${job} ${vendor}`);
  out.write(`\n${rows.length} vendors · ours: ${ours.join(" · ")}\n`);
  return 0;
}

/** Pad each column to its widest value; nothing is truncated. */
export function asColumns(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows.map((row) => row.map((value, column) => (value ?? "").padEnd(widths[column]!)).join("  ").trimEnd());
}

/** Read a key: silent input on a TTY, else one line of stdin. */
async function aKeyFor(vendor: string, out: NodeJS.WritableStream): Promise<string> {
  return process.stdin.isTTY === true ? await typedInSilence(`${vendor} key: `, out) : await aLineOfStdin();
}

function pathFor(vendor: string): string {
  return `/v1/provider-keys/${encodeURIComponent(vendor)}`;
}
