/** `pinecall data consent` and `pinecall data dnc`: what stands for a number, and the org's do-not-call list. */

import { readFileSync } from "node:fs";

import type { ConsentHistory, DoNotCall, DoNotCallImported } from "@pinecall/agents/wire";

import { asked, type Door } from "./testing/gateway.js";

/** The flags the two verbs read, as parseArgs hands them back. */
export interface ListFlags {
  give?: string;
  source?: string;
  text?: string;
  evidence?: string;
  "opt-out"?: boolean;
  after?: string;
  json?: boolean;
}

const KINDS = ["express", "written"] as const;

const WHICH = "--give and --opt-out say two things about one number";

const NOT_A_KIND = (said: string): string => `--give ${said}: express or written`;

const NEEDS_A_SOURCE = "--give needs --source: where the consent came from, a form, a call, a signed paper";

const GOES_WITH_GIVE = "--source, --text and --evidence go with --give express|written";

const NOTHING_IN = (file: string): string => `nothing in ${file}: one number a line`;

const DNC_USAGE = "pinecall data dnc [list] [--after <cursor>] · dnc add <number>… --source '…' · dnc import <file> --source '…'";

const EMPTY = "nobody is on the do-not-call list";

/** What refuses `consent` or `dnc` before the gateway is asked, or undefined. */
export function whyNotLists(verb: string, args: string[], flags: ListFlags): string | undefined {
  if (verb === "consent") {
    if (args[0] === undefined) return "pinecall data consent <number> [--give express|written --source '…'] [--opt-out]";
    if (flags.give !== undefined && flags["opt-out"] === true) return WHICH;
    if (flags.give !== undefined && !(KINDS as readonly string[]).includes(flags.give)) return NOT_A_KIND(flags.give);
    if (flags.give !== undefined && (flags.source ?? "").trim() === "") return NEEDS_A_SOURCE;
    if (flags.give === undefined && (flags.source !== undefined || flags.text !== undefined || flags.evidence !== undefined)) return GOES_WITH_GIVE;
    return undefined;
  }
  const [how = "list", ...rest] = args;
  if (!["list", "add", "import"].includes(how)) return DNC_USAGE;
  if (how !== "list" && (rest.length === 0 || (flags.source ?? "").trim() === "")) return DNC_USAGE;
  if (how === "import") return whyNotImported(rest[0]!);
  return undefined;
}

// Read before the gateway is asked: a file that is not there or holds no line is the caller's mistake, exit 2.
function whyNotImported(file: string): string | undefined {
  try {
    return numbersIn(file).length === 0 ? NOTHING_IN(file) : undefined;
  } catch (failed) {
    return failed instanceof Error ? failed.message : String(failed);
  }
}

function numbersIn(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}

/** `consent <number>`: read it, give a consent, or put it on the list. */
export async function consent(door: Door, number: string, flags: ListFlags, out: NodeJS.WritableStream): Promise<number> {
  const at = `/v1/org/consents/${encodeURIComponent(number)}`;
  let history: ConsentHistory;
  if (flags["opt-out"] === true) history = await asked<ConsentHistory>(door, at, { method: "DELETE" });
  else if (flags.give !== undefined) {
    const body = { number, kind: flags.give, source: flags.source!.trim(), text: flags.text ?? null, evidence: flags.evidence ?? null };
    history = await asked<ConsentHistory>(door, "/v1/org/consents", { method: "POST", body });
  } else history = await asked<ConsentHistory>(door, at);
  out.write(flags.json === true ? `${JSON.stringify(history)}\n` : `${historyLines(history).join("\n")}\n`);
  return 0;
}

/** `dnc`: list a page, add numbers, or import a file of them, one a line. */
export async function dnc(door: Door, args: string[], flags: ListFlags, out: NodeJS.WritableStream): Promise<number> {
  const [how = "list", ...rest] = args;
  if (how === "list") {
    const suffix = flags.after === undefined ? "" : `?after=${encodeURIComponent(flags.after)}`;
    const page = await asked<DoNotCall>(door, `/v1/org/dnc${suffix}`);
    if (flags.json === true) out.write(`${JSON.stringify(page)}\n`);
    else out.write(`${page.numbers.length === 0 ? EMPTY : page.numbers.map(listedLine).join("\n")}\n${page.next === null ? "" : `more: --after ${page.next}\n`}`);
    return 0;
  }
  const numbers = how === "add" ? rest : numbersIn(rest[0]!);
  const done = await asked<DoNotCallImported>(door, "/v1/org/dnc", { method: "POST", body: { numbers, source: flags.source!.trim() } });
  out.write(flags.json === true ? `${JSON.stringify(done)}\n` : `${done.added} number(s) on the list${done.refused.length === 0 ? "" : ` · not numbers: ${done.refused.join(", ")}`}\n`);
  return 0;
}

function historyLines(history: ConsentHistory): string[] {
  const said = { consented: "consented", opted_out: "on the do-not-call list", unknown: "nothing on file" }[history.standing];
  return [`${history.number}  ${said}`, ...history.rows.map((row) => {
    const when = new Date(row.given_at * 1000).toISOString().slice(0, 16).replace("T", " ");
    const on = row.call === null ? "" : `  on ${row.call}`;
    return `  ${when}  ${row.kind.padEnd(8)}  ${row.source}  by ${row.given_by}${on}`;
  })];
}

function listedLine(opted: DoNotCall["numbers"][number]): string {
  const since = new Date(opted.since * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `${opted.number}  since ${since}  ${opted.source}  by ${opted.given_by}`;
}
