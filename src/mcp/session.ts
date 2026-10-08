/** One MCP server's state: the project it works in, the door it knocks at, and whether production was allowed. */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { World } from "@pinecall/agents/client";

import { doorIn, KEY_VARIABLE, keyFrom, type Open } from "../env.js";
import { agentFilesOfTheProject, homeOf, type Home } from "../home.js";
import { pinecallHome, signedIn } from "../signed-in.js";
import { PRODUCTION, SANDBOX } from "../world.js";
import { Held, type MakesBeside } from "./holding/held.js";
import type { Talk } from "./holding/talking.js";
import type { SitePage } from "./site.js";
import { Refused } from "./tool.js";

export const NO_PROJECT =
  "no project open: call `project` with action `open` and the folder's path, or `new` to write one";
export const NO_KEY_HERE = (root: string): string =>
  `no PINECALL_KEY for ${root}: call \`link\` to write one into its .env (it asks you to \`login\` first when this machine is not signed in)`;
export const NO_PRODUCTION =
  "this server acts in the sandbox only: production needs `pinecall mcp install --prod`, typed by a person in a terminal";
export const STOP_FIRST = (held: string[]): string => `stop the agents held first (${held.join(", ")}): a project is opened with nothing running`;

/** A sign-in in flight: the link a person opens, and how it ended once it did. */
export interface Signing {
  url: string;
  link: string;
  settled?: { name: string } | { failed: string };
}

/** What a tool reads and changes across calls, for the life of one server. */
export class Session {
  /** The project folder the tools act on, once known. */
  root: string | undefined;
  signing: Signing | undefined;
  /** The agents this server holds, by slug. */
  readonly held = new Map<string, Held>();
  /** The written calls open, by call id. */
  readonly talks = new Map<string, Talk>();
  /** docs.pinecall.io's pages, read once. */
  site: Promise<SitePage[]> | undefined;
  /** A golden run in flight, by agent: it outlives one tool call. */
  readonly runs = new Map<string, Promise<unknown>>();
  /** A simulated call in flight, by agent: its answer when done, its transcript so far meanwhile. */
  readonly simulations = new Map<string, { pending: Promise<unknown>; lines(): string[] }>();

  constructor(
    readonly env: NodeJS.ProcessEnv,
    /** The server was started with --prod: a tool may then act in production. */
    readonly production: boolean,
    /** The roots the host declared, asked once and only when the host supports them. */
    private readonly declared: () => Promise<string[]>,
    /** What answers the console beside an agent held in a thread; the server's companion unless a test says otherwise. */
    readonly beside?: MakesBeside,
  ) {}

  /** The project's folder: one a tool opened, else the first the host declared, else the cwd when it holds agents/. */
  async project(): Promise<string> {
    if (this.root !== undefined) return this.root;
    const declared = (await this.declared()).find(isAProject);
    const found = declared ?? (isAProject(process.cwd()) ? process.cwd() : undefined);
    if (found === undefined) throw new Refused(NO_PROJECT);
    this.root = found;
    return found;
  }

  /**
   * Open a folder as the project: it must exist. The server's cwd moves there, once, on the main
   * thread: a thread cannot, and a tenant's relative path must mean what it means under `pinecall start`.
   */
  open(path: string): string {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Refused(`${root} is not a folder`);
    // The cwd is the held thread's too: it moves with nothing running.
    if (this.held.size > 0) throw new Refused(STOP_FIRST([...this.held.keys()]));
    this.root = root;
    process.chdir(root);
    return root;
  }

  /** One agent of the project: the one named, or the only one. */
  async home(agent?: string): Promise<Home> {
    const homes = agentFilesOfTheProject(await this.project()).map(homeOf);
    const names = homes.map((one) => one.name).join(", ");
    if (agent !== undefined) {
      const named = homes.find((one) => one.name === agent);
      if (named === undefined) throw new Refused(`no agent ${agent} in this project: ${names || "it has none under agents/"}`);
      return named;
    }
    if (homes.length === 1) return homes[0]!;
    throw new Refused(homes.length === 0 ? "this project has no agent under agents/" : `name the agent: one of ${names}`);
  }

  /** The agent held, the one named or the only one; refused when none is. */
  holding(agent?: string): Held {
    if (agent !== undefined) {
      const named = this.held.get(agent);
      if (named === undefined) throw new Refused(`${agent} is not held: call start`);
      return named;
    }
    const all = [...this.held.values()];
    if (all.length === 1) return all[0]!;
    throw new Refused(all.length === 0 ? "no agent is held: call start" : `name the agent: one of ${[...this.held.keys()].join(", ")}`);
  }

  /** Hang up every call and drain every thread: the server is closing. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.talks.values()].map((talk) => talk.end()));
    await Promise.allSettled([...this.held.values()].map((held) => held.stop()));
  }

  /** The project's door: its key, in the sandbox unless production was asked and allowed. */
  async door(prod = false): Promise<Open> {
    if (prod && !this.production) throw new Refused(NO_PRODUCTION);
    const root = await this.project();
    const { apiKey, ...held } = keyFrom(this.env, root);
    if (apiKey === undefined) throw new Refused(NO_KEY_HERE(root));
    const world: World = prod ? PRODUCTION : SANDBOX;
    try {
      return doorIn(world, { ...held, apiKey, world });
    } catch (failed) {
      throw new Refused(failed instanceof Error ? failed.message : String(failed));
    }
  }

  /** Every secret this session could print: the environment's key, the project's, and the machine's sign-in, to be scrubbed from any answer. */
  secrets(): string[] {
    const exported = this.env[KEY_VARIABLE];
    const project = this.root === undefined ? undefined : keyFrom(this.env, this.root).apiKey;
    const machine = signedIn(undefined, pinecallHome(this.env))?.key;
    return [exported, project, machine].filter((one): one is string => one !== undefined && one !== "");
  }
}

/** A folder an agent lives in: it has `agents/`. */
export function isAProject(folder: string): boolean {
  return existsSync(join(folder, "agents"));
}
