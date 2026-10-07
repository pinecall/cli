/** `pinecall agent pull | push`: a corner's settings as a file, for whoever keeps them in git and CI. */

import { readFile } from "node:fs/promises";

import { type TuningAnswer, type TuningBody } from "@pinecall/agents/wire";

import { readSettings, settingsPath, theCornerWritten } from "./agent-lines.js";
import type { Typed } from "./agent.js";
import { asked, type Door } from "./testing/gateway.js";

/** A pulled settings file: agent, corner, version and the full config. */
interface Pulled {
  agent: string;
  world: string;
  holder: string;
  version: number;
  config: TuningBody;
}

/** Run `pinecall agent pull` or `push`. */
export async function filesRun(
  door: Door,
  agent: string,
  verb: "pull" | "push",
  rest: string[],
  values: Typed,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  if (verb === "pull") return pull(door, agent, values.team === true, out, err);
  return push(door, agent, rest[0], values.team === true, out, err);
}

// A machine key has no corner of its own, so it pulls the org's: what CI keeps in the repo.
async function pull(door: Door, agent: string, team: boolean, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const answer = await readSettings(door, agent);
  const row = theCornerWritten(answer, team);
  if (row === null) {
    err.write(`nothing set for ${agent} in ${team ? "the team's" : "your"} corner of ${answer.world}\n`);
    return 1;
  }
  const pulled: Pulled = { agent, world: answer.world, holder: row.holder, version: row.version, config: row.config };
  out.write(`${JSON.stringify(pulled, null, 2)}\n`);
  return 0;
}

// No if_version: CI applies the file as the source of truth.
async function push(door: Door, agent: string, file: string | undefined, team: boolean, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  if (file === undefined) {
    err.write("push takes the file `pinecall agent pull` wrote\n");
    return 2;
  }
  const read = JSON.parse(await readFile(file, "utf8")) as Partial<Pulled>;
  const config = read.config ?? (read as TuningBody);
  const answer = await asked<TuningAnswer>(door, settingsPath(agent), {
    method: "PUT",
    body: { config, if_version: null, note: `pushed from ${file}`, team },
  });
  const row = theCornerWritten(answer, team);
  out.write(`${agent} · ${answer.world} · ${team ? "the team's corner" : "your corner"} v${row?.version ?? "?"} from ${file}\n`);
  return 0;
}
