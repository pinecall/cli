/** The org's dataset on the gateway — real calls kept as cases — read, decided, pulled into the repository and forgotten, by name, for any front. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { World } from "@pinecall/agents/client";

import { asked, type Door } from "./gateway.js";
import type { Expect, Golden } from "./goldens.js";

/** Where a case stands: kept at hang-up `pending`, then approved into the nightly or dismissed. */
export type CaseStatus = "pending" | "approved" | "dismissed";

export const STATUSES: readonly CaseStatus[] = ["pending", "approved", "dismissed"];

/** A judge that broke on the call a case was kept from, and why. */
export interface BrokeOn {
  judge: string;
  reason: string;
}

/** One case: the golden a real call made, whose, from where, by whom, and what a person decided. */
export interface EvalCase {
  id: string;
  agent: string;
  name: string;
  golden: Golden;
  source_call: string;
  /** The world the call ran in; the case is played in the sandbox whichever it was. */
  source_env: World;
  /** Played only when a run names it. */
  held_out: boolean;
  /** Who kept it: a person, or `the hang-up panel`. */
  author: string;
  created_at: number;
  status: CaseStatus;
  /** Empty for a case a person kept from a call that held. */
  broke: BrokeOn[];
  /** The settings version the call ran on; null where its corner had set nothing. */
  source_version: number | null;
  /** Written into the repository as a golden: the nightly plays the file, not the case. */
  kept_in_repo: boolean;
  decided_by: string | null;
}

/** A case as the gateway sends it: a field left at its default may be absent. */
type Sent = Omit<EvalCase, "status" | "broke" | "source_version" | "kept_in_repo" | "decided_by"> & Partial<EvalCase>;

/** The inbox: the agent's cases, the pending first, and how many wait of how many may. */
export interface CaseList {
  cases: EvalCase[];
  pending: number;
  /** Past it a broken call is judged as ever and not kept, until a person decides some. */
  pending_at_most: number;
}

/** What a person decided of one case; each field set is written. */
export interface Decision {
  status?: CaseStatus;
  held_out?: boolean;
  kept_in_repo?: boolean;
  /** With `dismissed` only: the judge that broke and should have held, kept as a calibration label. */
  judge_was_wrong?: string;
  /** Kept on that label. */
  note?: string;
}

/** A finished call to keep as an approved case; an expect left out is the one its broken verdicts give. */
export interface Keeping {
  call: string;
  name: string;
  expect?: Expect;
  held_out?: boolean;
}

/** The agent's cases, every status or one. */
export async function casesOf(door: Door, agent: string, status?: CaseStatus): Promise<CaseList> {
  const query = new URLSearchParams({ agent });
  if (status !== undefined) query.set("status", status);
  const sent = await asked<{ cases: Sent[]; pending?: number; pending_at_most?: number }>(door, `/v1/evals/cases?${query.toString()}`);
  return { cases: sent.cases.map(whole), pending: sent.pending ?? 0, pending_at_most: sent.pending_at_most ?? 0 };
}

/** One of the agent's cases by its name; an unknown name is an error naming it. */
export async function caseNamed(door: Door, agent: string, name: string): Promise<EvalCase> {
  const found = (await casesOf(door, agent)).cases.find((one) => one.name === name);
  if (found === undefined) throw new Error(`${agent} has no case named ${name}: \`pinecall cases\` lists them`);
  return found;
}

/** Write what a person decided of the agent's case of that name. */
export async function decided(door: Door, agent: string, name: string, decision: Decision): Promise<EvalCase> {
  const found = await caseNamed(door, agent, name);
  return whole(await asked<Sent>(door, caseDoor(found.id), { method: "PATCH", body: decision }));
}

/** A finished call kept as an approved case of the agent that took it. */
export async function keptAsCase(door: Door, keeping: Keeping): Promise<EvalCase> {
  return whole(await asked<Sent>(door, "/v1/evals/cases", { method: "POST", body: keeping }));
}

/** Forget the agent's case of that name; the call it came from stays. */
export async function forgotten(door: Door, agent: string, name: string): Promise<EvalCase> {
  const found = await caseNamed(door, agent, name);
  await asked<null>(door, caseDoor(found.id), { method: "DELETE" });
  return found;
}

/** A case written into the repository: the file, and the case as it is marked now. */
export interface Pulled {
  path: string;
  case: EvalCase;
}

/**
 * Write the case's golden as `<name>.json` in `folder`, then mark it kept in the repository, so the
 * nightly plays the file and not the case. The file is written first: a mark with no file would
 * leave the case played by nothing.
 */
export async function pulled(door: Door, agent: string, name: string, folder: string): Promise<Pulled> {
  const found = await caseNamed(door, agent, name);
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${found.name}.json`);
  await writeFile(path, `${JSON.stringify(found.golden, null, 2)}\n`, "utf8");
  const marked = whole(await asked<Sent>(door, caseDoor(found.id), { method: "PATCH", body: { kept_in_repo: true } }));
  return { path, case: marked };
}

function caseDoor(id: string): string {
  return `/v1/evals/cases/${encodeURIComponent(id)}`;
}

// The defaults the gateway leaves out, written in: every front reads one shape.
function whole(sent: Sent): EvalCase {
  return {
    ...sent,
    status: sent.status ?? "approved",
    broke: sent.broke ?? [],
    source_version: sent.source_version ?? null,
    kept_in_repo: sent.kept_in_repo ?? false,
    decided_by: sent.decided_by ?? null,
  };
}
