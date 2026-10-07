/** Legacy persona files under `test/<agent>/personas/`, read only by `pinecall personas push`, which sends them as that agent's. */

import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** A persona file: `test/<agent>/personas/<name>.ts`, default-exporting this object. */
export interface Persona {
  name: string;
  /** The caller's goal, in one line. */
  goal: string;
  /** How they talk, e.g. hurried or hard of hearing. */
  style: string;
  /** Facts the simulated caller must not invent (name, phone, appointment). */
  facts?: Record<string, unknown>;
  /** Initial call state, for a caller the business already knows. */
  state?: Record<string, unknown>;
}

/** Every persona in the directory, sorted by file name. */
export async function personasIn(folder: string): Promise<Persona[]> {
  const names = await readdir(resolve(folder)).catch(() => []);
  const files = names.filter((name) => extname(name) === ".ts").sort();
  if (files.length === 0) return [];
  // The files are TypeScript a project never builds; loaded lazily, as `pinecall prompt` pays nothing for it.
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  try {
    return await Promise.all(files.map((name) => personaOf(join(resolve(folder), name))));
  } finally {
    await unregister();
  }
}

/** One file's persona, named after the file. */
async function personaOf(file: string): Promise<Persona> {
  // Cache-bust by mtime so an edited file is re-imported.
  const module_ = (await import(`${pathToFileURL(file).href}?v=${(await stat(file)).mtimeMs}`)) as { default?: unknown };
  const written = module_.default;
  if (typeof written !== "object" || written === null) {
    throw new Error(`${file} has no default-exported persona`);
  }
  return { ...(written as Persona), name: basename(file, extname(file)) };
}
