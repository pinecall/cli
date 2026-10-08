/** `pinecall data`: the org's data — erasures and their trail, its policy, consent, the do-not-call list, export. */

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebStream } from "node:stream/web";
import { parseArgs } from "node:util";

import type { Erasure, ErasureTrail, OrgPolicy, OrgPolicyRow, Reads } from "@pinecall/agents/wire";

import { doorLine, theDoor, type Open } from "./env.js";
import type { Group } from "./groups.js";
import { consent, dnc, whyNotLists, type ListFlags } from "./data-lists.js";
import { asked, knocked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall data erase call <call-id> --yes",
  "       pinecall data erase contact <number|id> --yes",
  "       pinecall data erasures [--json]",
  "       pinecall data reads [<call-id|number>] [--json]",
  "       pinecall data policy [--retention-days <n> | --keep-all] [--calling-hours <from>-<until> | --any-hours]",
  "                            [--per-number-day <n> | --no-per-number] [--consent-everywhere | --consent-by-law]",
  "                            [--disclosure '…' | --platform-disclosure | --no-disclosure]",
  "                            [--recording-notice | --no-recording-notice] [--json]",
  "       pinecall data consent <number> [--give express|written --source '…' [--text '…'] [--evidence '…'] | --opt-out]",
  "       pinecall data dnc [list [--after <cursor>] | add <number>… --source '…' | import <file> --source '…']",
  "       pinecall data export [--out <file.jsonl>]",
].join("\n");

export const group: Group = {
  purpose: "the org's data: erasures, the policy, consent, the do-not-call list, export",
  usage: `${USAGE}

  What the org keeps in the world this key acts in (--prod for production), and taking it out.

  erase call <id>        one ended call gone: its log, its facts, the memories it taught and its
                         recording, in one transaction. The dial ledger keeps its numbers and time.
  erase contact <who>    a person's "delete my data": every call they were on in this world, and
                         every fact kept of them. <who> is the number or the id the call carried.
  erasures               the trail: what was erased, when, and who asked; it outlives the org
  reads [<call|number>]  who read the org's calls: a person reading a log or a recording, the
                         operator outside the gateway or in a traceback; once an hour per reader
  policy                 the org's compliance settings, one row: how many days a sealed call is
                         kept before the nightly run erases it (--retention-days, --keep-all), the
                         hours of the called number's own day a call may ring (--calling-hours
                         9-20, --any-hours), how many times one number is rung in a day
                         (--per-number-day, --no-per-number), whether every country needs a
                         consent on file or only +1 numbers (--consent-everywhere, --consent-by-law),
                         the sentence an outbound call opens with (--disclosure 'your words',
                         --platform-disclosure, --no-disclosure) and whether a recorded call says
                         it is (--recording-notice, --no-recording-notice). A flag changes one
                         field; the rest stay. A +1 number keeps the US floor (8-21, three a day).
  consent <number>       what stands for the number and every fact about it; --give records a
                         consent (express or written, its --source, the --text agreed to, an
                         --evidence), --opt-out puts it on the do-not-call list
  dnc                    the do-not-call list: list, add numbers, or import a file of them, one a
                         line — the org's own list or its National Registry scrub
  export                 the org's world whole as JSON Lines: calls and their logs, memories,
                         settings, words, documents. --out writes a file; without it, stdout.

  An erasure cannot be undone, so it asks for --yes.`,
  run,
};

/** Output streams and environment overrides, for tests. */
export interface Asking {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

const VERBS = ["erase", "erasures", "reads", "policy", "consent", "dnc", "export"] as const;

const WHATS = ["call", "contact"] as const;

const SAY_YES = (what: string, who: string): string =>
  `erasing ${what} ${who} cannot be undone: run it again with --yes`;

const ONE_OR_THE_OTHER = (a: string, b: string): string => `${a} and ${b} say two things about one field`;

const ONE_DISCLOSURE = "one of --disclosure '<your words>', --platform-disclosure or --no-disclosure";

const NOT_A_COUNT = (flag: string, said: string): string => `${flag} ${said}: a whole number, 1 or more`;

const NOT_HOURS = (said: string): string => `--calling-hours ${said}: two hours of the day, from-until, like 9-20`;

const A_COUNT = /^[1-9]\d*$/;

const HOURS = /^(\d{1,2})-(\d{1,2})$/;

const NOTHING_ERASED = "nothing erased yet";

const NOBODY_READ = "nobody read a call of this org yet";

export async function run(argv: string[], how: Asking = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "retention-days": { type: "string" },
      "keep-all": { type: "boolean", default: false },
      "calling-hours": { type: "string" },
      "any-hours": { type: "boolean", default: false },
      "per-number-day": { type: "string" },
      "no-per-number": { type: "boolean", default: false },
      "consent-everywhere": { type: "boolean", default: false },
      "consent-by-law": { type: "boolean", default: false },
      disclosure: { type: "string" },
      "platform-disclosure": { type: "boolean", default: false },
      "no-disclosure": { type: "boolean", default: false },
      "recording-notice": { type: "boolean", default: false },
      "no-recording-notice": { type: "boolean", default: false },
      out: { type: "string" },
      give: { type: "string" },
      source: { type: "string" },
      text: { type: "string" },
      evidence: { type: "string" },
      "opt-out": { type: "boolean", default: false },
      after: { type: "string" },
    },
  });
  const [verb, what, who] = positionals;
  const listed = positionals.slice(1);
  if (verb === undefined || !(VERBS as readonly string[]).includes(verb)) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const refused = verb === "consent" || verb === "dnc" ? whyNotLists(verb, listed, values as ListFlags) : whyNot(verb, what, who, values);
  if (refused !== undefined) {
    err.write(`${refused}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    if (verb === "erase") return erased(await asked<Erasure>(door, erasing(what!, who!), { method: "DELETE" }), values.json, out);
    if (verb === "erasures") return trail(await asked<ErasureTrail>(door, "/v1/org/erasures"), values.json, out);
    if (verb === "reads") return whoRead(await asked<Reads>(door, `/v1/org/reads${what === undefined ? "" : `?subject=${encodeURIComponent(what)}`}`), values.json, out);
    if (verb === "policy") return policy(door, changesOf(values), values.json, out);
    if (verb === "consent") return consent(door, what!, values as ListFlags, out);
    if (verb === "dnc") return dnc(door, listed, values as ListFlags, out);
    return await exported(door, values.out, out, err);
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return 1;
  }
}

/** The flags of `policy`, as parseArgs hands them back. */
interface PolicyFlags {
  "retention-days"?: string;
  "keep-all"?: boolean;
  "calling-hours"?: string;
  "any-hours"?: boolean;
  "per-number-day"?: string;
  "no-per-number"?: boolean;
  "consent-everywhere"?: boolean;
  "consent-by-law"?: boolean;
  disclosure?: string;
  "platform-disclosure"?: boolean;
  "no-disclosure"?: boolean;
  "recording-notice"?: boolean;
  "no-recording-notice"?: boolean;
}

/** What refuses a verb before anything is asked of the gateway, or undefined. */
function whyNot(verb: string, what: string | undefined, who: string | undefined, values: PolicyFlags & { yes?: boolean }): string | undefined {
  if (verb === "erase") {
    if (what === undefined || !(WHATS as readonly string[]).includes(what) || who === undefined) return USAGE;
    if (values.yes !== true) return SAY_YES(what, who);
  }
  if (verb === "policy") return whyNotPolicy(values);
  return undefined;
}

function whyNotPolicy(values: PolicyFlags): string | undefined {
  const days = values["retention-days"];
  const hours = values["calling-hours"];
  const count = values["per-number-day"];
  if (days !== undefined && values["keep-all"] === true) return ONE_OR_THE_OTHER("--retention-days", "--keep-all");
  if (hours !== undefined && values["any-hours"] === true) return ONE_OR_THE_OTHER("--calling-hours", "--any-hours");
  if (count !== undefined && values["no-per-number"] === true) return ONE_OR_THE_OTHER("--per-number-day", "--no-per-number");
  if (values["consent-everywhere"] === true && values["consent-by-law"] === true) return ONE_OR_THE_OTHER("--consent-everywhere", "--consent-by-law");
  if (values["recording-notice"] === true && values["no-recording-notice"] === true) return ONE_OR_THE_OTHER("--recording-notice", "--no-recording-notice");
  const disclosures = [values.disclosure !== undefined, values["platform-disclosure"] === true, values["no-disclosure"] === true];
  if (disclosures.filter(Boolean).length > 1) return ONE_DISCLOSURE;
  if (values.disclosure !== undefined && values.disclosure.trim() === "") return ONE_DISCLOSURE;
  if (days !== undefined && !A_COUNT.test(days)) return NOT_A_COUNT("--retention-days", days);
  if (count !== undefined && !A_COUNT.test(count)) return NOT_A_COUNT("--per-number-day", count);
  if (hours !== undefined && hoursOf(hours) === undefined) return NOT_HOURS(hours);
  return undefined;
}

/** "9-20" as from and until, or undefined when it is no window of the day. */
function hoursOf(said: string): { from: number; until: number } | undefined {
  const found = HOURS.exec(said);
  if (found === null) return undefined;
  const from = Number(found[1]);
  const until = Number(found[2]);
  return from >= 0 && from <= 23 && until >= 1 && until <= 24 && from < until ? { from, until } : undefined;
}

/** The fields the flags change; an empty object reads the policy. */
function changesOf(values: PolicyFlags): Partial<OrgPolicy> {
  const changes: Partial<OrgPolicy> = {};
  if (values["keep-all"] === true) changes.retention_days = null;
  if (values["retention-days"] !== undefined) changes.retention_days = Number(values["retention-days"]);
  if (values["any-hours"] === true) changes.calling_hours = null;
  if (values["calling-hours"] !== undefined) changes.calling_hours = hoursOf(values["calling-hours"]);
  if (values["no-per-number"] === true) changes.per_number_day = null;
  if (values["per-number-day"] !== undefined) changes.per_number_day = Number(values["per-number-day"]);
  if (values["consent-everywhere"] === true) changes.consent_everywhere = true;
  if (values["consent-by-law"] === true) changes.consent_everywhere = false;
  if (values.disclosure !== undefined) changes.disclosure = values.disclosure.trim();
  if (values["platform-disclosure"] === true) changes.disclosure = null;
  if (values["no-disclosure"] === true) changes.disclosure = "";
  if (values["recording-notice"] === true) changes.recording_notice = true;
  if (values["no-recording-notice"] === true) changes.recording_notice = false;
  return changes;
}

function erasing(what: string, who: string): string {
  return what === "call" ? `/v1/calls/${encodeURIComponent(who)}` : `/v1/contacts/${encodeURIComponent(who)}`;
}

function erased(answered: Erasure, asJson: boolean | undefined, out: NodeJS.WritableStream): number {
  out.write(asJson === true ? `${JSON.stringify(answered)}\n` : `${lineOf(answered)}\n`);
  return 0;
}

function trail(answered: ErasureTrail, asJson: boolean | undefined, out: NodeJS.WritableStream): number {
  if (asJson === true) out.write(`${JSON.stringify(answered)}\n`);
  else out.write(`${answered.erasures.length === 0 ? NOTHING_ERASED : answered.erasures.map(lineOf).join("\n")}\n`);
  return 0;
}

function whoRead(answered: Reads, asJson: boolean | undefined, out: NodeJS.WritableStream): number {
  if (asJson === true) out.write(`${JSON.stringify(answered)}\n`);
  else out.write(`${answered.reads.length === 0 ? NOBODY_READ : answered.reads.map(readLine).join("\n")}\n`);
  return 0;
}

// The row is replaced whole at the gateway, so one field changed is the row read and written back.
async function policy(door: Door, changes: Partial<OrgPolicy>, asJson: boolean | undefined, out: NodeJS.WritableStream): Promise<number> {
  const kept = await asked<OrgPolicyRow>(door, "/v1/org/policy");
  const answered = Object.keys(changes).length === 0
    ? kept
    : await asked<OrgPolicyRow>(door, "/v1/org/policy", { method: "PUT", body: { ...kept.policy, ...changes } });
  out.write(asJson === true ? `${JSON.stringify(answered)}\n` : `${policyLines(answered).join("\n")}\n`);
  return 0;
}

async function exported(door: Open, file: string | undefined, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const answered = await knocked(door, "/v1/org/export");
  if (answered.body === null) return 0;
  const body = Readable.fromWeb(answered.body as WebStream<Uint8Array>);
  if (file === undefined) {
    await pipeline(body, out, { end: false });
    return 0;
  }
  await pipeline(body, createWriteStream(file));
  err.write(`${doorLine(door)}\nthe org's ${door.world} world written to ${file}\n`);
  return 0;
}

/** One read as a line: when, what of which call or number, and who. */
function readLine(read: Reads["reads"][number]): string {
  const when = new Date(read.at * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `${when}  ${read.what.padEnd(9)}  ${read.subject}  by ${read.reader}${read.env === null ? "" : `  (${read.env})`}`;
}

/** One erasure as a line: when, what, which, how much went, and who asked. */
function lineOf(one: Erasure): string {
  const when = new Date(one.at * 1000).toISOString().slice(0, 16).replace("T", " ");
  const took = `${one.calls} call(s), ${one.entries} entries, ${one.memories} memories, ${one.recordings} recording(s)`;
  return `${when}  ${one.what} ${one.subject}  ${took}  by ${one.asked_by}`;
}

/** The policy as one sentence a setting, and who set it. */
function policyLines(row: OrgPolicyRow): string[] {
  const { retention_days: days, calling_hours: hours, per_number_day: count, disclosure } = row.policy;
  const kept = days === null || days === undefined ? "every sealed call is kept until it is erased" : `a sealed call is erased ${days} day(s) after it started`;
  const rung = hours === null || hours === undefined ? "a number is rung at any hour of its day (a +1 number: 8-21)" : `a number is rung from ${hours.from}:00 to ${hours.until}:00 of its own day`;
  const often = count === null || count === undefined ? "no limit of calls to one number a day (a +1 number: 3)" : `one number is rung at most ${count} time(s) a day`;
  const consent = row.policy.consent_everywhere === true ? "every number needs a consent on file" : "a +1 number needs a consent on file";
  const opens = disclosure === null || disclosure === undefined ? "the platform's sentence (\"This is an automated assistant calling on behalf of …\")" : disclosure === "" ? "nothing: the agent's own greeting must disclose it" : `"${disclosure}"`;
  const notice = row.policy.recording_notice === false ? "a recorded call says nothing of it" : "a recorded call says \"This call may be recorded.\"";
  const by = row.set_by === null ? "nobody set it" : `set by ${row.set_by}`;
  return [`retention:      ${kept}`, `calling hours:  ${rung}`, `per number:     ${often}`, `consent:        ${consent}`, `outbound opens: ${opens}`, `recording:      ${notice}`, by];
}
