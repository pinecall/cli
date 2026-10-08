/** The `project` tool: which project the tools act on, opening another, and writing a new one. */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { keyFrom } from "../../env.js";
import { agentFilesOfTheProject, homeOf } from "../../home.js";
import { languageOf } from "../../language.js";
import { scaffold, type Template } from "../../new.js";
import type { Session } from "../session.js";
import { Refused, tool } from "../tool.js";

export const project = tool({
  name: "project",
  description: "The project the tools act on (`show`), another folder opened (`open`), or a new project of one agent written (`new`).",
  schema: {
    action: z.enum(["show", "open", "new"]),
    path: z.string().optional().describe("`open`: the project's folder; `new`: the folder to write it in, beside the open project when left out"),
    name: z.string().optional().describe("`new`: the agent's name, its slug on Pinecall: lowercase letters, digits and dashes"),
    language: z.enum(["typescript", "ruby"]).optional().describe("`new`: the agent's language; TypeScript when left out"),
  },
  manual:
    "`project show` says which folder every tool acts on: its agents, their language, and whether it has a key. The host's declared root, or the server's folder, is used when it holds `agents/`; `open` points at another, with nothing held. `new` writes a project of one agent (a receptionist that takes a message, its test and one golden) and opens it; the person then installs its dependencies (`npm install`, or `bundle install` for Ruby) before the agent can run.",
  handler: async (args, session) => {
    if (args.action === "open") return shown(session, session.open(needed(args.path, "path")));
    if (args.action === "new") return written(session, needed(args.name, "name"), args.path, args.language ?? "typescript");
    return shown(session, await session.project());
  },
});

function needed(value: string | undefined, name: string): string {
  if (value === undefined || value === "") throw new Refused(`${name} is needed for this action`);
  return value;
}

function written(session: Session, name: string, path: string | undefined, language: Template): unknown {
  const parent = path === undefined ? (session.root === undefined ? process.cwd() : dirname(session.root)) : resolve(path);
  const root = scaffold(join(parent, name), name, language);
  session.open(root);
  const install = language === "ruby" ? "bundle install" : "npm install";
  return { ...shown(session, root), next: `${install} in ${root}, then \`link\` writes its key` };
}

// The agents as every verb finds them: `agents/<name>/agent.(tsx|ts|rb|py)`, the folder's name their slug.
function shown(session: Session, root: string): Record<string, unknown> {
  const held = keyFrom(session.env, root);
  return {
    root,
    agents: agentFilesOfTheProject(root).map((file) => ({ name: homeOf(file).name, language: languageOf(file) })),
    key: held.apiKey === undefined ? "none: call link" : `from ${held.source}`,
    gateway: held.url,
    installed: existsSync(join(root, "node_modules", "@pinecall", "agents")) || existsSync(join(root, "Gemfile.lock")),
  };
}
