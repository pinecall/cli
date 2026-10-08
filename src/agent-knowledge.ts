/** `pinecall agent knowledge [edit]`: what the agent knows by heart, printed, or edited and kept as the next version. */

import type { TuningBody } from "@pinecall/agents/wire";

import { readSettings, theCornerCalled, theCornerToWrite, theCornerWritten, theRowToStartFrom } from "./agent-lines.js";
import type { Editor } from "./editor.js";
import type { Door } from "./testing/gateway.js";

/** Flags read from `pinecall agent`. */
interface Flags {
  team?: boolean | undefined;
  note?: string | undefined;
}

export const NOTHING_KNOWN = (agent: string, corner: string): string =>
  `${agent} knows nothing by heart in ${corner}: \`pinecall agent knowledge edit\` writes it`;
export const UNCHANGED = "nothing changed: no version written";

/** Print the corner's knowledge, or edit it and write a new version. */
export async function knowledgeRun(
  door: Door,
  agent: string,
  verb: string | undefined,
  flags: Flags,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
  editor: Editor,
): Promise<number> {
  const team = flags.team === true;
  const standing = await readSettings(door, agent);
  const row = theRowToStartFrom(standing, team);
  const corner = theCornerCalled(standing, team, door);
  const text = row?.config.knowledge ?? undefined;
  if (verb === undefined) {
    if (text === undefined) {
      out.write(`${NOTHING_KNOWN(agent, corner)}\n`);
      return 0;
    }
    out.write(text.endsWith("\n") ? text : `${text}\n`);
    return 0;
  }
  if (verb !== "edit") {
    err.write("usage: pinecall agent knowledge [edit] [--team] [--note '…']\n");
    return 2;
  }
  const written = await editor(text ?? "");
  if (written === (text ?? "")) {
    out.write(`${UNCHANGED}\n`);
    return 0;
  }
  const version = await knowledgeWritten(door, agent, written, team, flags.note);
  out.write(`${agent} · knowledge ${written.trim() === "" ? "taken out" : `${written.length.toLocaleString("en-US")} chars`} · ${corner} v${version ?? "?"}\n`);
  return 0;
}

/** Keep the text as what the agent knows by heart, the next version of the corner; empty takes it out. Returns that version. */
export async function knowledgeWritten(door: Door, agent: string, text: string, team: boolean, note?: string): Promise<number | undefined> {
  const writing = await theCornerToWrite(door, agent, team);
  const answer = await writing.write((config) => kept(config, text), note ?? "knowledge");
  return theCornerWritten(answer, team, door)?.version;
}

// An empty file removes the field (the door refuses a blank value), so the default applies again.
function kept(config: TuningBody, written: string): TuningBody {
  const { knowledge: _was, ...rest } = config;
  return written.trim() === "" ? rest : { ...rest, knowledge: written };
}
