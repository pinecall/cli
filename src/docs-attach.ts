/** `pinecall docs attach | detach | attached`: manage the knowledge bases an agent reads. */

import { type DocsConfig } from "@pinecall/agents/wire";
import { type TuningAnswer } from "@pinecall/agents/wire";
import { type KnowledgeUses } from "@pinecall/agents/wire";

import { readSettings, theCornerCalled, theCornerToWrite, theCornerWritten } from "./agent-lines.js";
import { asked, type Door } from "./testing/gateway.js";

/** Retrieval options for an attached base: mode, chunk count and minimum score. */
export interface Attaching {
  k?: number;
  mode?: DocsConfig["mode"];
  minScore?: number;
}

/** Output lines for `attach` and `detach`. */
const ATTACHED = (agent: string, base: string, answer: TuningAnswer, team: boolean): string =>
  `${agent} · ${base} attached · ${cornerLine(answer, team)}`;
const DETACHED = (agent: string, base: string, answer: TuningAnswer, team: boolean): string =>
  `${agent} · ${base} detached · ${cornerLine(answer, team)}`;
export const NOT_ATTACHED = (agent: string, base: string): string => `${base} is not attached to ${agent}`;

/** Attach a base in this corner as a new settings version; an existing entry for it is replaced. */
export async function attach(door: Door, agent: string, base: string, how: Attaching, team: boolean, out: NodeJS.WritableStream): Promise<number> {
  const docs: DocsConfig = { base };
  if (how.k !== undefined) docs.k = how.k;
  if (how.mode !== undefined) docs.mode = how.mode;
  if (how.minScore !== undefined) docs.min_score = how.minScore;
  const corner = await theCornerToWrite(door, agent, team);
  const answer = await corner.write(
    (config) => ({ ...config, bases: [...(config.bases ?? []).filter((one) => one.base !== base), docs] }),
    `attached ${base}`,
  );
  out.write(`${ATTACHED(agent, base, answer, team)}\n`);
  return 0;
}

/** Detach a base in this corner as a new settings version. */
export async function detach(door: Door, agent: string, base: string, team: boolean, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const corner = await theCornerToWrite(door, agent, team);
  if (!(corner.row?.config.bases ?? []).some((one) => one.base === base)) {
    err.write(`${NOT_ATTACHED(agent, base)}\n`);
    return 1;
  }
  // Keep an empty list rather than dropping the field, or the corner falls back to the team's bases.
  const answer = await corner.write(
    (config) => ({ ...config, bases: (config.bases ?? []).filter((one) => one.base !== base) }),
    `detached ${base}`,
  );
  out.write(`${DETACHED(agent, base, answer, team)}\n`);
  return 0;
}

/** Print every attached base in the key's world and the agents that read it. */
export async function attached(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const uses = await asked<KnowledgeUses>(door, "/v1/knowledge/attached");
  if (uses.bases.length === 0) {
    out.write("no agent reads a base here: `pinecall docs attach <base>` gives one its base\n");
    return 0;
  }
  for (const one of uses.bases) out.write(`${one.base} · read by ${one.agents.join(", ")}\n`);
  return 0;
}

/** Parse and validate `--k`, `--mode` and `--min-score`. */
export function attachingOf(values: { k?: string; mode?: string; "min-score"?: string }): Attaching {
  const how: Attaching = {};
  if (values.k !== undefined) {
    const k = Number(values.k);
    if (!Number.isInteger(k) || k < 1) throw new Error(`--k takes a whole number of chunks, not ${values.k}`);
    how.k = k;
  }
  if (values.mode !== undefined) {
    if (values.mode !== "retrieved" && values.mode !== "tool") throw new Error(`--mode is retrieved or tool, not ${values.mode}`);
    how.mode = values.mode;
  }
  if (values["min-score"] !== undefined) {
    const score = Number(values["min-score"]);
    if (!Number.isFinite(score) || score < 0) throw new Error(`--min-score takes a score of zero or more, not ${values["min-score"]}`);
    how.minScore = score;
  }
  return how;
}

// Name the corner the gateway actually wrote, which differs from the flag for a key with no corner.
function cornerLine(answer: TuningAnswer, team: boolean): string {
  const row = theCornerWritten(answer, team);
  const corner = theCornerCalled(answer, team);
  return row === null ? corner : `${corner} v${row.version}`;
}
