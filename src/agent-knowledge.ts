/** `pinecall agent knowledge [edit]`: what the agent knows by heart, printed, or opened in $EDITOR and kept as the next version. */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type TuningAnswer, type TuningBody, type TuningRow } from "@pinecall/agents/wire";

import { readSettings, theCornerCalled, theCornerToWrite, theCornerWritten } from "./agent-lines.js";
import { asked, type Door } from "./testing/gateway.js";

/** Opens the text for editing and returns the result: $EDITOR, or a stub in tests. */
export type Editor = (text: string) => Promise<string>;

/** Flags read from `pinecall agent`. */
interface Flags {
  team?: boolean | undefined;
  note?: string | undefined;
}

export const NOTHING_KNOWN = (agent: string, corner: string): string =>
  `${agent} knows nothing by heart in ${corner}: \`pinecall agent knowledge edit\` writes it`;
export const NO_EDITOR = "no editor: set $EDITOR (or $VISUAL) to the one that opens Markdown for you";
export const UNCHANGED = "nothing changed: no version written";

/** Print the corner's knowledge, or edit it and write a new version. */
export async function knowledgeRun(
  door: Door,
  agent: string,
  verb: string | undefined,
  flags: Flags,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
  editor: Editor = inTheEditor,
): Promise<number> {
  const team = flags.team === true;
  const standing = await readSettings(door, agent);
  const row = theCornerWritten(standing, team);
  const corner = theCornerCalled(standing, team);
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
  const writing = await theCornerToWrite(door, agent, team);
  const answer = await writing.write((config) => kept(config, written), flags.note ?? "knowledge");
  const now = theCornerWritten(answer, team);
  out.write(`${agent} · knowledge ${written.trim() === "" ? "taken out" : `${written.length.toLocaleString("en-US")} chars`} · ${corner} v${now?.version ?? "?"}\n`);
  return 0;
}

// An empty file removes the field (the door refuses a blank value), so the default applies again.
function kept(config: TuningBody, written: string): TuningBody {
  const { knowledge: _was, ...rest } = config;
  return written.trim() === "" ? rest : { ...rest, knowledge: written };
}

/** Whether a corner's row sets `knowledge`. */
export function knows(row: TuningRow | null): boolean {
  return row !== null && typeof row.config.knowledge === "string";
}

// Edit in a temp file, like `git commit`; the directory is removed before returning.
async function inTheEditor(text: string): Promise<string> {
  const editor = process.env["VISUAL"] ?? process.env["EDITOR"];
  if (editor === undefined || editor === "") throw new Error(NO_EDITOR);
  const folder = mkdtempSync(join(tmpdir(), "pinecall-knowledge-"));
  const file = join(folder, "knowledge.md");
  try {
    writeFileSync(file, text);
    // Through a shell: $EDITOR may carry arguments (`code -w`). The path is quoted for spaces.
    const opened = spawnSync(`${editor} '${file.replaceAll("'", "'\\''")}'`, { stdio: "inherit", shell: true });
    if (opened.status !== 0) throw new Error(`${editor} exited with ${opened.status}: nothing written`);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
