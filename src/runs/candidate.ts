/** `pinecall runs promote`: the golden a real call makes, as the gateway derives it, written as a candidate in the project. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { goldenOfCall } from "../testing/cases.js";
import type { Door } from "../testing/gateway.js";
import type { Expect, Golden } from "../testing/goldens.js";

/** Default output directory for promoted candidates. */
export const CANDIDATES = "test/candidates";

/** Promote options: name, output directory, and the seq to cut the call at. */
export interface Promotion {
  name?: string;
  out: string;
  fromSeq: number;
}

/**
 * Note for a broken `consent`. The tool goes in `expect.not_tools` (checked against the log), not
 * `expect.not` (checked against words, which would pass on the same break).
 */
export const CONSENT_BANS_THE_TOOL =
  "consent broke, so the tool that ran unasked is in expect.not_tools: keep it only if this call must never call it at all — the order itself is the runtime's own policy over state and input";

/** Note for a broken `grounded`. */
export const GROUNDED_IS_ASKED =
  "grounded broke, so expect.grounded asks that every price, hour, date and name the agent states is in the call's evidence";

/** Note for the judges a golden asks again by name. */
export const JUDGES_ASKED_AGAIN = (judges: string[]): string =>
  `these judges broke and are asked again by name: ${judges.join(", ")}`;

/** Note for a call nothing broke on: a verdict says what went wrong, never what was right. */
export const NOTHING_BROKE = "nothing broke: write what this call must keep doing";

/**
 * Write a call as a golden candidate and print it. Candidates carry `promoted_from` and need review
 * before use as goldens.
 */
export async function promoted(
  door: Door,
  call: string,
  wanted: Promotion,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream = process.stderr,
  asJson = false,
): Promise<number> {
  let written: Written;
  try {
    written = await promotedTo(door, call, wanted);
  } catch (refused) {
    err.write(`${refused instanceof Error ? refused.message : String(refused)}\n`);
    return 1;
  }
  out.write(asJson ? `${JSON.stringify(written)}\n` : `${linesOf(written, wanted.fromSeq).join("\n")}\n`);
  return 0;
}

/** A promoted call: file path, candidate, and review notes. */
export interface Written {
  path: string;
  candidate: Golden;
  notes: string[];
}

/** Ask the gateway for the golden the call makes and write it; used by the CLI verb, the console and the MCP. */
export async function promotedTo(door: Door, call: string, wanted: Promotion): Promise<Written> {
  const candidate = await goldenOfCall(door, call, { ...(wanted.name === undefined ? {} : { name: wanted.name }), fromSeq: wanted.fromSeq });
  await mkdir(wanted.out, { recursive: true });
  const path = join(wanted.out, `${candidate.name}.json`);
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return { path, candidate, notes: notesOn(candidate.expect ?? {}) };
}

/** Output lines for a promotion. */
export function linesOf(written: Written, fromSeq: number): string[] {
  return [`${written.path}  ${written.candidate.input.length} caller turn(s) from seq ${fromSeq}`, ...written.notes];
}

// Review notes go to stdout so the file stays a valid golden; each says what one field of the derived expect means.
function notesOn(expect: Expect): string[] {
  const notes: string[] = [];
  if (expect.not_tools !== undefined && expect.not_tools.length > 0) notes.push(CONSENT_BANS_THE_TOOL);
  if (expect.grounded === true) notes.push(GROUNDED_IS_ASKED);
  if (expect.judges !== undefined && expect.judges.length > 0) notes.push(JUDGES_ASKED_AGAIN(expect.judges));
  if (notes.length === 0) notes.push(NOTHING_BROKE);
  return notes.map((note) => `  ${note}`);
}
