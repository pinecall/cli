/** `pinecall agent history | diff | rollback`: a corner's settings versions. */

import { type TuningAnswer, type TuningBody, type TuningDiff, type TuningHistory } from "@pinecall/agents/wire";

import { FIELDS, linesOf, settingsPath, shown, versionLine } from "./agent-lines.js";
import type { Typed } from "./agent-setting.js";
import { asked, type Door } from "./testing/gateway.js";

/** Run `pinecall agent history`, `diff` or `rollback`. */
export async function versionsRun(
  door: Door,
  agent: string,
  verb: "history" | "diff" | "rollback",
  rest: string[],
  values: Typed,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  if (verb === "history") return history(door, agent, values.team === true, out);
  if (verb === "diff") return diff(door, agent, values.against, out, err);
  return rollback(door, agent, rest[0], values.team === true, out, err);
}

async function history(door: Door, agent: string, team: boolean, out: NodeJS.WritableStream): Promise<number> {
  const kept = await asked<TuningHistory>(door, `${settingsPath(agent)}/history?team=${team}`);
  out.write(`${agent} · ${kept.world} · ${kept.holder === "" ? "the org's own corner" : `corner ${kept.holder}`}\n`);
  if (kept.rows.length === 0) {
    out.write("  nothing set yet\n");
    return 0;
  }
  // Each version is diffed against the previous one; the oldest against an empty config.
  kept.rows.forEach((row, at) => {
    const older = kept.rows[at + 1] ?? null;
    out.write(`  ${versionLine(row)}${changes(older?.config ?? {}, row.config, "   ")}\n`);
  });
  return 0;
}

async function diff(door: Door, agent: string, against: string | undefined, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const world = against ?? "production";
  if (world !== "team" && world !== "production") {
    err.write("--against takes team or production\n");
    return 2;
  }
  const said = await asked<TuningDiff>(door, `${settingsPath(agent)}/diff?against=${world}`);
  const ours = said.ours === null ? "nothing set" : `${said.ours.holder === "" ? "team" : "yours"} v${said.ours.version}`;
  const theirs = said.theirs === null ? "nothing set" : `v${said.theirs.version}`;
  out.write(`${agent} · ${ours} vs ${world} ${theirs}\n`);
  if (said.changed.length === 0) {
    out.write("  the same\n");
    return 0;
  }
  out.write(`${changes(said.theirs?.config ?? {}, said.ours?.config ?? {}, "  ", "\n")}\n`);
  return 0;
}

async function rollback(door: Door, agent: string, version: string | undefined, team: boolean, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const wanted = Number(version);
  if (version === undefined || !Number.isInteger(wanted) || wanted < 1) {
    err.write("rollback takes the version to bring back: `pinecall agent history` lists them\n");
    return 2;
  }
  const answer = await asked<TuningAnswer>(door, `${settingsPath(agent)}/rollback`, { method: "POST", body: { version: wanted, team } });
  out.write(`${linesOf(agent, answer).join("\n")}\n`);
  return 0;
}

/** The fields that differ between two configs, each as `field before → after`. */
export function changes(before: TuningBody, after: TuningBody, lead: string, joined = " · "): string {
  const said: string[] = [];
  for (const field of FIELDS) {
    const was = shown(before, field);
    const is = shown(after, field);
    if (was === is) continue;
    said.push(`${field.replace("-", " ")} ${was ?? "—"} → ${is ?? "—"}`);
  }
  return said.length === 0 ? "" : `${lead}${said.join(joined === "\n" ? `\n${lead}` : joined)}`;
}
