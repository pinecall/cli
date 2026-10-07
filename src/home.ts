/** Paths of an agent's files in the project layout, each folder named after the agent. */

import { cannotRun } from "./cannot-run.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { AGENT_FILES } from "./language.js";

/** Project folder holding one subfolder per agent. */
export const PROJECT_AGENTS = "agents";

/**
 * Paths a verb reads beside the class. Verbs never build these paths themselves.
 *
 *     agents/<name>/agent.ts      the class and its private helpers
 *     lib/                        code shared by two or more agents
 *     docs/<name>/                a local folder `docs push` sends when none is named; not tracked
 *     test/<name>/agent.test.ts   ring 0
 *     test/<name>/goldens/        ring 1, plus the `docs.json` and `memory.json` goldens
 *     test/<name>/memory/         extraction cases, one written call each
 *
 * Personas live on the gateway; `personas` is only where `pinecall personas push` reads legacy files.
 */
export interface Home {
  /** Absolute path of the class's file. */
  file: string;
  /** The agent's folder name under agents/. */
  name: string;
  /** Project root, where verbs run. */
  root: string;
  goldens: string;
  personas: string;
  docs: string;
  docsGolden: string;
  memoryGolden: string;
  memoryCases: string;
}

/** File names of the retrieval and recall goldens inside the goldens folder. */
export const DOCS_GOLDEN = "docs.json";
export const MEMORY_GOLDEN = "memory.json";

/** Resolve the home of the class at `agents/<name>/agent.ts`. */
export function homeOf(file: string): Home {
  const path = resolve(file);
  const folder = dirname(path);
  const name = basename(folder);
  const root = dirname(dirname(folder));
  const tests = join(root, "test", name);
  return {
    file: path,
    name,
    root,
    goldens: join(tests, "goldens"),
    personas: join(tests, "personas"),
    docs: join(root, "docs", name),
    docsGolden: join(tests, "goldens", DOCS_GOLDEN),
    memoryGolden: join(tests, "goldens", MEMORY_GOLDEN),
    memoryCases: join(tests, "memory"),
  };
}

/** Whether the path exists and is a directory. */
export function hasDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * The agents a verb acts on: `file` if given, else every agent in the project, or the one
 * `agent` names by its folder's name, which is its slug.
 */
export async function homesFor(file?: string, agent?: string): Promise<Home[]> {
  if (file !== undefined) return [homeOf(file)];
  const project = agentFilesOfTheProject();
  if (project.length === 0) return [homeOf(theAgentHere())];
  const homes = project.map(homeOf);
  if (agent === undefined) return homes;
  const named = homes.find((home) => home.name === agent);
  if (named !== undefined) return [named];
  throw cannotRun(`no agent ${agent} in this project: it has ${homes.map((home) => home.name).join(", ")}`);
}

/** The single agent a conversational verb acts on; a multi-agent project must name it. */
export async function oneHome(verb: string, file?: string, agent?: string): Promise<Home> {
  const homes = await homesFor(file, agent);
  if (homes.length > 1) {
    const names = homes.map((home) => `--agent ${home.name}`).join(" or ");
    throw cannotRun(`${verb} talks to one agent and this project has ${homes.length}: add ${names}`);
  }
  return homes[0]!;
}

/** The `--agent` option: an agent's folder's name in the project, which is its slug. */
export const AGENT_FLAG = { agent: { type: "string" } } as const;

/** Agent files of the project at `root`, sorted; folders without an agent file are skipped. */
export function agentFilesOfTheProject(root: string = process.cwd()): string[] {
  const folder = resolve(root, PROJECT_AGENTS);
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => AGENT_FILES.map((name) => resolve(folder, entry.name, name)).find((path) => existsSync(path)))
    .filter((path): path is string => path !== undefined)
    .sort();
}

/** The project's only agent; several must be named, none is an error naming where it looked. */
export function theAgentHere(): string {
  const project = agentFilesOfTheProject();
  if (project.length === 1) return project[0]!;
  if (project.length > 1) {
    const names = project.map((file) => `--agent ${basename(dirname(file))}`).join(" or ");
    throw cannotRun(`this project has ${project.length} agents: name one with ${names}`);
  }
  throw cannotRun(`no agent here: looked for ${PROJECT_AGENTS}/<name>/${AGENT_FILES.join(" or ")} in ${process.cwd()}`);
}

// `--agent` takes a slug and `--file` a path; a path passed to `--agent` gets a pointer to `--file`.
const A_PATH = /\.(tsx?|rb|py)$|[/\\]/;

/** Error message when a path was given where a slug is expected, else undefined. */
export function notASlug(said: string | undefined): string | undefined {
  if (said === undefined || !A_PATH.test(said)) return undefined;
  return `an agent is named by its slug, not a file: \`--file ${said}\` names the class to load.`;
}

/** The agent's slug: the name of the folder its file is in. */
export function slugOfAgentFile(file: string): string {
  return basename(dirname(resolve(file)));
}

/** Slug of this directory's agent, or null when there is none or several. */
export function agentOfThisDirectory(): string | null {
  try {
    return slugOfAgentFile(theAgentHere());
  } catch {
    return null;
  }
}
