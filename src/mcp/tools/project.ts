/** The `project` tool: which project the tools act on, opening another, and writing a new one. */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { keyFrom } from "../../env.js";
import { aGoldenGenerated, anAgentGenerated } from "../../generate.js";
import { agentFilesOfTheProject, homeOf } from "../../home.js";
import { languageOf } from "../../language.js";
import { scaffold, type Template } from "../../new.js";
import type { Session } from "../session.js";
import { Refused, tool } from "../tool.js";

export const project = tool({
  name: "project",
  description: "The project the tools act on (`show`), another folder opened (`open`), a new project of one agent written (`new`), or one more agent or golden in it (`generate`).",
  schema: {
    action: z.enum(["show", "open", "new", "generate"]).describe("show the project the tools act on; open another folder; new writes a project of one agent; generate adds an agent or a golden to it"),
    path: z.string().optional().describe("`open`: the project's folder; `new`: the folder to write it in, beside the open project when left out"),
    name: z.string().optional().describe("`new` and `generate`: the agent's or the golden's name: lowercase letters, digits and dashes"),
    language: z.enum(["typescript", "ruby", "python"]).optional().describe("`new` and `generate agent`: the agent's language; TypeScript for `new`, the project's for `generate`"),
    kind: z.enum(["agent", "golden"]).optional().describe("`generate`: one more agent, or one more golden of an agent"),
    input: z.array(z.string()).optional().describe("`generate golden`: what the caller says, one line each, in order"),
    tools: z.array(z.string()).optional().describe("`generate golden`: the tools that must be called"),
    agent: z.string().optional().describe("`generate golden`: whose golden; the project's only agent when left out"),
  },
  manual:
    "`project show` says which folder every tool acts on: its agents, their language, and whether it has a key. The host's declared root, or the server's folder, is used when it holds `agents/`; `open` points at another, with nothing held. `new` writes a project of one agent (a receptionist that takes a message, its test and one golden) and opens it; a TypeScript one runs at once on the framework this server lends it until `npm install` pins its own, a Ruby one after `bundle install`, a Python one after `uv sync`. `generate` adds to the open project, never over a file: `agent` a second agent from the same templates (its class, its test, one golden), `golden` a conversation in `test/<agent>/goldens/` from the caller's lines and the tools that must be called — then `test run` holds the agent to it.",
  handler: async (args, session) => {
    if (args.action === "open") return shown(session, session.open(needed(args.path, "path")));
    if (args.action === "new") return written(session, needed(args.name, "name"), args.path, args.language ?? "typescript");
    if (args.action === "generate") {
      const root = await session.project();
      const name = needed(args.name, "name");
      if (args.kind === "agent") return { written: anAgentGenerated(root, name, args.language), ...shown(session, root) };
      if (args.kind !== "golden") throw new Refused("generate takes a kind: agent or golden");
      return { written: [aGoldenGenerated(await session.home(args.agent), name, args.input ?? [], args.tools ?? [])] };
    }
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
  const next =
    language === "typescript"
      ? `\`link\` writes its key, and \`start\` runs it on the framework this server lends it; npm install in ${root} pins the project's own`
      : `${language === "ruby" ? "bundle install" : "uv sync"} in ${root}, then \`link\` writes its key`;
  return { ...shown(session, root), next };
}

// The agents as every verb finds them: `agents/<name>/agent.(tsx|ts|rb|py)`, the folder's name their slug.
function shown(session: Session, root: string): Record<string, unknown> {
  const held = keyFrom(session.env, root);
  return {
    root,
    agents: agentFilesOfTheProject(root).map((file) => ({ name: homeOf(file).name, language: languageOf(file) })),
    key: held.apiKey === undefined ? "none: call link" : `from ${held.source}`,
    gateway: held.url,
    installed: [join("node_modules", "@pinecall", "agents"), "Gemfile.lock", ".venv"].some((made) => existsSync(join(root, made))),
  };
}
