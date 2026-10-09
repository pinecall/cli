/** `pinecall telemetry`: where this org sends its calls' traces — its own OTLP collector. */

import { parseArgs } from "node:util";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { aLineOfStdin, nobodyIsTyping, typedInSilence } from "./secret.js";
import { asked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall telemetry                                  where this org's traces go
       pinecall telemetry set <url> [--header <name> …] [--pii]  an OTLP collector; each header's value on stdin
       pinecall telemetry clear`;

const PATH = "/v1/telemetry";
const NOWHERE = "this org sends its traces nowhere · `pinecall telemetry set <url>` names a collector";

export const group: Group = {
  purpose: "where this org's calls' traces go: its own OpenTelemetry collector, set, read and taken back",
  usage: `${USAGE}

  Every call's spans — the model's requests, speech in and out, every tool the agent ran — are
  exported over OTLP to the collector named here, beside Pinecall's own: Datadog, Grafana,
  Langfuse, Honeycomb, Cekura, or an OpenTelemetry Collector of yours. Every span carries
  pinecall.org, pinecall.env, pinecall.agent and pinecall.call, so one call is one trace there.

  set takes the collector's URL on the command line and each header's VALUE from stdin, one per
  --header, in the order named — typed with nothing echoed on a terminal, or piped one line per
  header — never from a flag: a key in argv is a key in \`ps\` and in the shell history. --pii
  lets a span carry what was said and what a tool got; without it the words are stripped before
  export and the timings, tokens and names stay. The gateway keeps the headers sealed and never
  reads them back: the bare verb prints the URL and the headers' names. clear stops the export.

  Examples
    $ printf %s "$DD_API_KEY" | pinecall telemetry set https://otlp.datadoghq.eu/v1/traces --header dd-api-key
    traces go to https://otlp.datadoghq.eu/v1/traces · headers dd-api-key
    $ pinecall telemetry
    traces go to https://otlp.datadoghq.eu/v1/traces · headers dd-api-key · words stripped`,
  run,
};

/** Test overrides: streams, environment and how a header's value is read. */
export interface Sending {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Read one header's value, by name. Defaults to silent TTY input or one line of stdin. */
  value?: (name: string) => Promise<string>;
}

interface Collector {
  endpoint: string;
  header_names: string[];
  pii: boolean;
}

/** Dispatch `telemetry` subcommands. */
export async function run(argv: string[], how: Sending = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const [verb, ...rest] = argv;
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === undefined) return await show(door, out);
    if (verb === "set") return await set(door, rest, how.value ?? valueOf, out, err);
    if (verb === "clear" && rest.length === 0) return await clear(door, out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

async function show(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const found = await asked<Collector | null>(door, PATH);
  out.write(`${found === null ? NOWHERE : described(found)}\n`);
  return 0;
}

// Header values come one at a time, by name, so a terminal asks for each without echo.
async function set(
  door: Door,
  argv: string[],
  value: (name: string) => Promise<string>,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { header: { type: "string", multiple: true }, pii: { type: "boolean", default: false } },
  });
  const [endpoint] = positionals;
  if (endpoint === undefined || positionals.length > 1) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const headers: Record<string, string> = {};
  for (const name of values.header ?? []) {
    const read = await value(name);
    if (read === "") {
      err.write(`header ${name}: an empty value; pipe it, or type it when asked\n`);
      return 2;
    }
    headers[name] = read;
  }
  await asked(door, PATH, { method: "PUT", body: { endpoint, headers, pii: values.pii } });
  const named = Object.keys(headers);
  out.write(`traces go to ${endpoint}${named.length > 0 ? ` · headers ${named.join(", ")}` : ""}${values.pii ? " · with what was said" : ""}\n`);
  return 0;
}

async function clear(door: Door, out: NodeJS.WritableStream): Promise<number> {
  await asked(door, PATH, { method: "DELETE" });
  out.write("traces stay on Pinecall · the collector forgotten\n");
  return 0;
}

function described(found: Collector): string {
  const headers = found.header_names.length > 0 ? ` · headers ${found.header_names.join(", ")}` : "";
  return `traces go to ${found.endpoint}${headers}${found.pii ? " · with what was said" : " · words stripped"}`;
}

async function valueOf(name: string): Promise<string> {
  return nobodyIsTyping() ? await aLineOfStdin() : await typedInSilence(`${name}: `, process.stderr);
}
