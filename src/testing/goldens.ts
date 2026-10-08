/** Golden files on the tenant's disk and the schema the runner accepts. */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { DOCS_GOLDEN, MEMORY_GOLDEN } from "../home.js";

/** A backend event injected mid-conversation, as the app would send it. */
export interface EventStep {
  /** Number of caller turns answered before it arrives; 0 is before the first. */
  after_turn?: number;
  name: string;
  data?: Record<string, unknown>;
}

/** Expectations a golden is judged against; each field is one check. */
export interface Expect {
  tools?: string[];
  /** Tools that must not run. (`not` checks words, not tools.) */
  not_tools?: string[];
  not?: string[];
  says?: string[];
  grounded?: boolean;
  register?: "tu" | "usted";
  replies?: boolean;
}

/** One scripted conversation: initial state, caller input and expectations. */
export interface Golden {
  name: string;
  state?: Record<string, unknown>;
  input: string[];
  /** Facts memory holds about the caller at call start. Served to `recall` for this call only;
   * the memory table is never written. */
  memory?: string[];
  events?: EventStep[];
  /** `YYYY-MM-DD` date the call opens on, so weekday references stay stable; defaults to today. */
  today?: string;
  expect?: Expect;
  /** Source call id when created by `pinecall runs promote`; not read by judges. */
  promoted_from?: string;
}

/** Where memory's extraction cases live, one written call each, and what is said when there are none. */
export const CASES = "test/<name>/memory";

export const NO_CASES = `no extraction goldens at ${CASES}: write one, or name the file or directory to run`;

/** Default goldens directory. */
export const GOLDENS = "test/goldens";

/** Message shown when the default directory is missing. */
export const NO_GOLDENS =
  `no goldens at ${GOLDENS}: write one, or name the file or directory to run`;

/** Every golden under the paths, sorted by file name. */
export async function goldensIn(paths: string[]): Promise<Golden[]> {
  return await casesIn<Golden>(paths, GOLDENS);
}

/**
 * Every case under the paths. A file holds one case or a list; unnamed cases take the file's
 * basename, numbered when there are several.
 */
export async function casesIn<T extends { name?: string }>(paths: string[], fallback: string): Promise<T[]> {
  const found: T[] = [];
  // No paths and no default folder: return empty rather than throwing ENOENT.
  if (paths.length === 0 && !(await stat(resolve(fallback)).catch(() => null))?.isDirectory()) return found;
  for (const path of paths.length > 0 ? paths : [fallback]) {
    for (const file of await filesUnder(resolve(path))) found.push(...(await casesOf<T>(file)));
  }
  return found;
}

/** Cases whose name contains `grep` (case-insensitive), or all when undefined. */
export function matching<T extends { name: string }>(cases: T[], grep: string | undefined): T[] {
  if (grep === undefined) return cases;
  const wanted = grep.toLowerCase();
  return cases.filter((one) => one.name.toLowerCase().includes(wanted));
}

async function casesOf<T extends { name?: string }>(file: string): Promise<T[]> {
  const read = JSON.parse(await readFile(file, "utf8")) as unknown;
  const written = Array.isArray(read) ? (read as T[]) : [read as T];
  const stem = basename(file, extname(file));
  return written.map((one, index) => ({
    ...one,
    name: one.name ?? (written.length > 1 ? `${stem} #${index + 1}` : stem),
  }));
}

// One level deep, sorted. Skips the retrieval and recall goldens, which `docs eval` and
// `memory eval` read.
async function filesUnder(path: string): Promise<string[]> {
  if (!(await stat(path).catch(() => null))?.isDirectory()) return [path];
  const names = await readdir(path);
  return names
    .filter((name) => extname(name) === ".json" && name !== DOCS_GOLDEN && name !== MEMORY_GOLDEN)
    .sort()
    .map((name) => join(path, name));
}

/** The goldens in an agent's folder, or none when it does not exist. */
export async function goldensOf(folder: string): Promise<Golden[]> {
  return (await stat(folder).catch(() => null))?.isDirectory() === true ? await casesIn<Golden>([folder], GOLDENS) : [];
}
