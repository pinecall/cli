/** `pinecall new <name> [--ruby | --python]`: a project of one agent, ready for `link`, `chat`, `test` and `start`. */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { cannotRun } from "./cannot-run.js";
import type { Group } from "./groups.js";

const USAGE = "usage: pinecall new <name> [--typescript | --ruby | --python]";

export const group: Group = {
  purpose: "a new project of one agent, in TypeScript, Ruby or Python",
  offline: true,
  usage: `${USAGE}

  Writes ./<name>/: the agent under agents/<name>/ — a class that takes a message, its prompt, one
  tool — its ring-0 test, one golden, and the toolchain (package.json, Gemfile or pyproject.toml). The
  name is the agent's slug on the gateway: lowercase letters, digits and dashes, starting with a letter.

  --typescript  the class in TypeScript (agent.tsx, vitest); the default
  --ruby        the class in Ruby (agent.rb, a view in ERB, minitest)
  --python      the class in Python (agent.py, a view in Jinja, pytest, uv)

  Examples
    $ pinecall new front-desk --ruby
    ▸ front-desk · a Ruby agent

      cd front-desk
      bundle install
      pinecall link        sign in, pick the org: its key goes to .env
      pinecall chat        talk to it here
      pinecall test        its goldens, against a real model
      pinecall start       answer calls`,
  run,
};

/** The languages `new` writes a project in, each a folder under templates/. */
export type Template = "typescript" | "ruby" | "python";

/** The flags that name a language, as `new` and `generate` take them. */
export const LANGUAGE_FLAGS = { typescript: { type: "boolean" }, ruby: { type: "boolean" }, python: { type: "boolean" } } as const;

/** The language the flags name, or undefined when they name none; refused when they name more than one. */
export function templateOf(values: Partial<Record<Template, boolean | undefined>>): Template | undefined {
  const named = (["typescript", "ruby", "python"] as const).filter((one) => values[one] === true);
  if (named.length > 1) throw cannotRun(`${named.map((one) => `--${one}`).join(" or ")}, not both: one language`);
  return named[0];
}

/** A slug the gateway accepts: what the folder, the agent's name and its URL path all are. */
export const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const TEMPLATES = fileURLToPath(new URL("../templates/", import.meta.url));

// npm drops a published `.gitignore`, so the template carries it under another name.
const RENAMED: Record<string, string> = { _gitignore: ".gitignore" };

/** What the project's first commands are, per language. */
const NEXT: Record<Template, { install: string; ring0: string; language: string }> = {
  typescript: { install: "npm install", ring0: "npm test", language: "TypeScript" },
  ruby: { install: "bundle install", ring0: "bundle exec rake", language: "Ruby" },
  python: { install: "uv sync", ring0: "uv run pytest", language: "Python" },
};

export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout, cwd = process.cwd()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: LANGUAGE_FLAGS,
  });
  const [name, ...extra] = positionals;
  if (name === undefined || extra.length > 0) throw cannotRun(USAGE);
  const template: Template = templateOf(values) ?? "typescript";
  const root = scaffold(resolve(cwd, name), name, template);
  out.write(nextSteps(relative(cwd, root) || ".", template));
  return 0;
}

/** Write the project at `root` and answer it. Refuses a slug the gateway would not take, or a folder already in use. */
export function scaffold(root: string, slug: string, template: Template): string {
  aSlug(slug);
  if (existsSync(root) && readdirSync(root).length > 0) throw cannotRun(`${root} already holds files: new writes into an empty folder`);
  const words = wordsFor(slug, template);
  for (const tree of ["common", template]) copied(join(TEMPLATES, tree), root, words);
  return root;
}

/**
 * One more agent in a project, from the same templates as the first: its class under `agents/<slug>/`,
 * its ring-0 test and one golden under `test/<slug>/`. Returns the files written, relative to the root.
 */
export function anAgentWritten(root: string, slug: string, template: Template): string[] {
  aSlug(slug);
  for (const tree of ["agents", "test"]) {
    const there = join(root, tree, slug);
    if (existsSync(there) && readdirSync(there).length > 0) throw cannotRun(`${relative(root, there)} already holds files: ${slug} is an agent of this project already`);
  }
  const words = wordsFor(slug, template);
  return ["agents", "test"].flatMap((tree) => copied(join(TEMPLATES, template, tree), join(root, tree), words)).map((file) => relative(root, file));
}

function aSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw cannotRun(`${slug} cannot be an agent's name: lowercase letters, digits and dashes, starting with a letter`);
  }
}

/** The words a template's `{{…}}` and `__slug__` stand for. */
export function wordsFor(slug: string, template: Template): Record<string, string> {
  const parts = slug.split("-");
  const next = NEXT[template];
  return {
    slug,
    Class: parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join(""),
    Title: parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
    Language: next.language,
    install: next.install,
    ring0: next.ring0,
    agents: OURS.dependencies["@pinecall/agents"]!,
  };
}

// A new TypeScript project depends on the framework this CLI is released with, and on nothing of
// the CLI: the CLI is installed once per machine, and Pinecall starts a deployed project with its own.
const OURS = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};

// Every file written, so a caller can say what it wrote.
function copied(from: string, to: string, words: Record<string, string>): string[] {
  mkdirSync(to, { recursive: true });
  const written: string[] = [];
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, RENAMED[entry] ?? entry.replaceAll("__slug__", words.slug!));
    if (statSync(source).isDirectory()) written.push(...copied(source, target, words));
    else {
      writeFileSync(target, filled(readFileSync(source, "utf8"), words));
      written.push(target);
    }
  }
  return written;
}

function filled(text: string, words: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, word: string) => words[word] ?? whole);
}

function nextSteps(folder: string, template: Template): string {
  const next = NEXT[template];
  return `▸ ${folder} · a ${next.language} agent

  cd ${folder}
  ${next.install}
  pinecall link        sign in, pick the org: its key goes to .env
  pinecall chat        talk to it here
  pinecall test        its goldens, against a real model
  pinecall start       answer calls
`;
}
