/** One MCP server's state: the project it works in, the door it knocks at, and whether production was allowed. */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { World } from "@pinecall/agents/client";

import { doorIn, keyFrom, type Open } from "../env.js";
import { pinecallHome, signedIn } from "../signed-in.js";
import { PRODUCTION, SANDBOX } from "../world.js";
import { Refused } from "./tool.js";

export const NO_PROJECT =
  "no project open: call `project` with action `open` and the folder's path, or `new` to write one";
export const NO_KEY_HERE = (root: string): string =>
  `no PINECALL_KEY for ${root}: call \`link\` to write one into its .env (it asks you to \`login\` first when this machine is not signed in)`;
export const NO_PRODUCTION =
  "this server acts in the sandbox only: production needs `pinecall mcp install --prod`, typed by a person in a terminal";

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

  constructor(
    readonly env: NodeJS.ProcessEnv,
    /** The server was started with --prod: a tool may then act in production. */
    readonly production: boolean,
    /** The roots the host declared, asked once and only when the host supports them. */
    private readonly declared: () => Promise<string[]>,
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

  /** Open a folder as the project: it must exist. */
  open(path: string): string {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Refused(`${root} is not a folder`);
    this.root = root;
    return root;
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

  /** Every secret this session could print: the project's key and the machine's sign-in, to be scrubbed from any answer. */
  secrets(): string[] {
    const project = this.root === undefined ? undefined : keyFrom(this.env, this.root).apiKey;
    const machine = signedIn(undefined, pinecallHome(this.env))?.key;
    return [project, machine].filter((one): one is string => one !== undefined);
  }
}

/** A folder an agent lives in: it has `agents/`. */
export function isAProject(folder: string): boolean {
  return existsSync(join(folder, "agents"));
}
