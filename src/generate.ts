/** `pinecall generate agent | golden` (`g` for short): one more agent in the project, or one more conversation it must hold. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

import { cannotRun } from "./cannot-run.js";
import type { Group } from "./groups.js";
import { agentFilesOfTheProject, homeOf, PROJECT_AGENTS, type Home } from "./home.js";
import { languageOf } from "./language.js";
import { anAgentWritten, LANGUAGE_FLAGS, SLUG, templateOf, type Template } from "./new.js";
import type { Golden } from "./testing/goldens.js";

const USAGE = `usage: pinecall generate agent <name> [--typescript | --ruby | --python]
       pinecall generate golden <name> --input '…' [--input '…']… [--tool <name>]… [--agent <name>]
       (g for short: pinecall g agent sales)`;

export const group: Group = {
  purpose: "one more agent in this project, or one more golden for one of its agents",
  offline: true,
  usage: `${USAGE}

  Run at the project's root, the folder that holds agents/. It writes files and nothing else: no
  key, no gateway, and never over a file that is there.

  agent <name>    a second agent beside the first, from the templates \`pinecall new\` writes:
                  agents/<name>/ (the class), its ring-0 test and one golden. In the project's
                  language, which --typescript, --ruby or --python overrides; at the root,
                  \`pinecall start\` then holds every agent, and a verb about one takes --agent.
  golden <name>   test/<agent>/goldens/<name>.json: the caller's lines (--input, in order) and
                  the tools that must be called (--tool). Every golden is judged by consent and
                  heard; add says, not, grounded or register to its expect by hand
                  (docs.pinecall.io/concepts/golden-expectations). --agent names the agent when
                  the project has several.

  Examples
    $ pinecall g golden asks-for-a-refund --input "Hi, I want a refund." --input "It's Ana Ruiz." --tool takeMessage
      wrote test/front-desk/goldens/asks-for-a-refund.json`,
  run,
};

/** Write one agent, or one golden, into the project at `cwd`; print what was written. */
export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout, cwd = process.cwd()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...LANGUAGE_FLAGS,
      input: { type: "string", multiple: true },
      tool: { type: "string", multiple: true },
      agent: { type: "string" },
    },
  });
  const [kind, name, ...extra] = positionals;
  if (name === undefined || extra.length > 0 || (kind !== "agent" && kind !== "golden")) throw cannotRun(USAGE);
  const written =
    kind === "agent"
      ? anAgentGenerated(cwd, name, templateOf(values))
      : [aGoldenGenerated(theHome(cwd, values.agent), name, values.input ?? [], values.tool ?? [])].map((file) => relative(cwd, file));
  out.write(`${written.map((file) => `  wrote ${file}`).join("\n")}\n`);
  return 0;
}

export const NO_PROJECT_HERE = (cwd: string): string =>
  `no project at ${cwd}: generate writes into the folder that holds ${PROJECT_AGENTS}/ — \`pinecall new <name>\` writes one`;

/** One more agent in the project at `root`, in the language asked or else the project's; the files written, relative to the root. */
export function anAgentGenerated(root: string, slug: string, language?: Template): string[] {
  if (!existsSync(join(root, PROJECT_AGENTS))) throw cannotRun(NO_PROJECT_HERE(root));
  return anAgentWritten(root, slug, language ?? theProjectsLanguage(root));
}

/** One golden of an agent: the caller's lines and the tools that must be called. Returns its path. */
export function aGoldenGenerated(home: Home, name: string, input: readonly string[], tools: readonly string[]): string {
  if (!SLUG.test(name)) throw cannotRun(`${name} cannot be a golden's name: lowercase letters, digits and dashes, as its file is named`);
  const lines = input.map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length === 0) throw cannotRun("a golden needs what the caller says: --input '…', once per line, in order");
  const file = join(home.goldens, `${name}.json`);
  if (existsSync(file)) throw cannotRun(`${file} is there already: a golden is never written over`);
  const golden: Omit<Golden, "name"> = { input: lines, expect: tools.length === 0 ? {} : { tools: [...tools] } };
  mkdirSync(home.goldens, { recursive: true });
  writeFileSync(file, `${JSON.stringify(golden, null, 2)}\n`);
  return file;
}

// The project's agents are in one language as a rule (one `pinecall start` serves one); a project of none is TypeScript's.
function theProjectsLanguage(root: string): Template {
  const languages = new Set(agentFilesOfTheProject(root).map(languageOf));
  if (languages.size > 1) throw cannotRun(`this project's agents are in ${[...languages].join(" and ")}: say which with --typescript, --ruby or --python`);
  return [...languages][0] ?? "typescript";
}

// The agent named, or the project's only one.
function theHome(root: string, agent: string | undefined): Home {
  const homes = agentFilesOfTheProject(root).map(homeOf);
  if (homes.length === 0) throw cannotRun(existsSync(join(root, PROJECT_AGENTS)) ? "this project has no agent yet: `pinecall generate agent <name>`" : NO_PROJECT_HERE(root));
  if (agent !== undefined) {
    const named = homes.find((one) => one.name === agent);
    if (named === undefined) throw cannotRun(`no agent ${agent} in this project: it has ${homes.map((one) => one.name).join(", ")}`);
    return named;
  }
  if (homes.length > 1) throw cannotRun(`this project has ${homes.length} agents: name one with ${homes.map((one) => `--agent ${one.name}`).join(" or ")}`);
  return homes[0]!;
}
