/** `pinecall new <name> [--ruby]`: a project of one agent, ready for `link`, `chat`, `test` and `start`. */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { cannotRun } from "./cannot-run.js";
import type { Group } from "./groups.js";

const USAGE = "usage: pinecall new <name> [--ruby | --typescript]";

export const group: Group = {
  purpose: "a new project of one agent, in TypeScript or Ruby",
  offline: true,
  usage: `${USAGE}

  Writes ./<name>/: the agent under agents/<name>/ — a class that takes a message, its prompt, one
  tool — its ring-0 test, one golden, and the toolchain (package.json or Gemfile). The name is the
  agent's slug on the gateway: lowercase letters, digits and dashes, starting with a letter.

  --ruby        the class in Ruby (agent.rb, a view in ERB, minitest)
  --typescript  the class in TypeScript (agent.tsx, vitest); the default`,
  run,
};

/** The languages `new` writes a project in, each a folder under templates/. */
export type Template = "typescript" | "ruby";

/** A slug the gateway accepts: what the folder, the agent's name and its URL path all are. */
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const TEMPLATES = fileURLToPath(new URL("../templates/", import.meta.url));

// npm drops a published `.gitignore`, so the template carries it under another name.
const RENAMED: Record<string, string> = { _gitignore: ".gitignore" };

/** What the project's first commands are, per language. */
const NEXT: Record<Template, { install: string; ring0: string; language: string }> = {
  typescript: { install: "npm install", ring0: "npm test", language: "TypeScript" },
  ruby: { install: "bundle install", ring0: "bundle exec rake", language: "Ruby" },
};

export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout, cwd = process.cwd()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { ruby: { type: "boolean" }, typescript: { type: "boolean" } },
  });
  const [name, ...extra] = positionals;
  if (name === undefined || extra.length > 0) throw cannotRun(USAGE);
  if (values.ruby === true && values.typescript === true) throw cannotRun("--ruby or --typescript, not both");
  const template: Template = values.ruby === true ? "ruby" : "typescript";
  const root = scaffold(resolve(cwd, name), name, template);
  out.write(nextSteps(relative(cwd, root) || ".", template));
  return 0;
}

/** Write the project at `root` and answer it. Refuses a slug the gateway would not take, or a folder already in use. */
export function scaffold(root: string, slug: string, template: Template): string {
  if (!SLUG.test(slug)) {
    throw cannotRun(`${slug} cannot be an agent's name: lowercase letters, digits and dashes, starting with a letter`);
  }
  if (existsSync(root) && readdirSync(root).length > 0) throw cannotRun(`${root} already holds files: new writes into an empty folder`);
  const words = wordsFor(slug, template);
  for (const tree of ["common", template]) copied(join(TEMPLATES, tree), root, words);
  return root;
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
    cli: `^${OURS.version}`,
  };
}

// A new TypeScript project starts on this CLI and the framework it is released with: Pinecall
// starts a deployed project with the project's own `pinecall start`.
const OURS = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  dependencies: Record<string, string>;
};

function copied(from: string, to: string, words: Record<string, string>): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, RENAMED[entry] ?? entry.replaceAll("__slug__", words.slug!));
    if (statSync(source).isDirectory()) copied(source, target, words);
    else writeFileSync(target, filled(readFileSync(source, "utf8"), words));
  }
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
