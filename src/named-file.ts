/** Read a JSON file named by a CLI flag, with errors that name the flag and the file. */

import { readFileSync } from "node:fs";

import { cannotRun } from "./cannot-run.js";

/** Parse the JSON file a flag names; missing or invalid files fail with the flag and path in the message. */
export function readNamedJson<T>(flag: string, file: string): T {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (failed) {
    throw cannotRun(`${flag}: cannot read ${file} — ${(failed as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : saidBy(failed)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (failed) {
    throw cannotRun(`${flag}: ${file} is not JSON — ${saidBy(failed)}`);
  }
}

function saidBy(failed: unknown): string {
  return failed instanceof Error ? failed.message : String(failed);
}
