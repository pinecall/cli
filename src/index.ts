#!/usr/bin/env node
/** `pinecall <group> [args]`: the tenant CLI entry point and group dispatcher. */

import { CannotRun } from "./cannot-run.js";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { helpFor, PLANNED, plannedGroup, type Group } from "./groups.js";
import { version } from "./version.js";
import { inTheWorld, withoutTheWorldFlag } from "./world.js";

// Order is the help order: first-day verbs first.
const BUILT = ["new", "link", "start", "console", "chat", "prompt", "test", "simulate", "eval", "sessions", "runs", "agent", "lexicon", "pipeline", "line", "numbers", "carriers", "personas", "judges", "docs", "memory", "remember", "supervise", "providers", "voices", "callbacks", "data", "deploy", "secrets", "login", "whoami", "mcp"] as const;

/** Every group name, built and planned, in help order. */
export function groupNames(): string[] {
  return [...BUILT, ...Object.keys(PLANNED)];
}

/** Groups that are implemented and have a help page. */
export function builtNames(): string[] {
  return [...BUILT];
}

/** Run one invocation. Each group parses its own flags; this only picks the module. */
export async function main(
  argv: string[],
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
): Promise<number> {
  // `--prod` is global, so it is stripped here before any group parses argv.
  const { argv: named, world } = withoutTheWorldFlag(argv);
  const [name, ...rest] = named;
  if (name === undefined || name === "--help" || name === "-h" || name === "help") {
    out.write(usage());
    return name === undefined ? 2 : 0;
  }
  if (name === "--version" || name === "-v" || name === "version") {
    out.write(`${version()}\n`);
    return 0;
  }
  const group = await groupFor(name, out);
  if (group === undefined) {
    err.write(`pinecall: no such group: ${name}\n\n${usage()}`);
    return 2;
  }
  // Refuse `--prod` on offline verbs rather than silently ignoring it.
  if (world !== undefined && group.offline === true) {
    err.write(`pinecall: ${name} reaches no gateway, so --prod names nothing it could ask\n`);
    return 2;
  }
  if (rest[0] === "--help" || rest[0] === "-h") {
    out.write(helpFor(name, group));
    return 0;
  }
  // Print thrown errors as one line, not a stack trace. Not via the SDK's `asError`, so this
  // module does not import the websocket client.
  try {
    return await inTheWorld(world, async () => await group.run(rest));
  } catch (failed) {
    err.write(`pinecall: ${saidBy(failed, name)}\n`);
    // 2: usage error, retrying cannot help. 1: a check failed or the gateway refused.
    return failed instanceof CannotRun || isAnUnknownFlag(failed) ? 2 : 1;
  }
}

// Lazy imports keep light verbs like `prompt` from loading the websocket client.
export async function groupFor(name: string, out: NodeJS.WritableStream = process.stdout): Promise<Group | undefined> {
  if (name === "new") return (await import("./new.js")).group;
  if (name === "mcp") return (await import("./mcp/index.js")).group;
  if (name === "link") return (await import("./linking.js")).group;
  if (name === "start") return (await import("./start.js")).group;
  if (name === "console") return (await import("./console.js")).group;
  if (name === "chat") return (await import("./chat.js")).group;
  if (name === "prompt") return (await import("./prompt.js")).group;
  if (name === "test") return (await import("./test.js")).group;
  if (name === "simulate") return (await import("./simulate.js")).group;
  if (name === "eval") return (await import("./eval.js")).group;
  if (name === "runs") return (await import("./runs/index.js")).group;
  if (name === "agent") return (await import("./agent.js")).group;
  if (name === "lexicon") return (await import("./lexicon.js")).group;
  if (name === "pipeline") return (await import("./pipeline.js")).group;
  if (name === "line") return (await import("./line.js")).group;
  if (name === "personas") return (await import("./personas.js")).group;
  if (name === "judges") return (await import("./judges.js")).group;
  if (name === "docs") return (await import("./docs.js")).group;
  if (name === "memory") return (await import("./memory.js")).group;
  if (name === "remember") return (await import("./remember.js")).group;
  if (name === "supervise") return (await import("./supervise.js")).group;
  if (name === "sessions") return (await import("./sessions.js")).group;
  if (name === "numbers") return (await import("./numbers.js")).group;
  if (name === "carriers") return (await import("./carriers.js")).group;
  if (name === "providers") return (await import("./providers.js")).group;
  if (name === "voices") return (await import("./voices.js")).group;
  if (name === "callbacks") return (await import("./callbacks.js")).group;
  if (name === "data") return (await import("./data.js")).group;
  if (name === "deploy") return (await import("./deploy.js")).group;
  if (name === "secrets") return (await import("./org-secrets.js")).group;
  if (name === "login") return (await import("./login.js")).group;
  if (name === "whoami") return (await import("./whoami.js")).group;
  const planned = PLANNED[name];
  return planned === undefined ? undefined : plannedGroup(name, planned, out);
}

/** Top-level help listing every group. */
export function usage(): string {
  const lines = [
    "usage: pinecall <group> [args]",
    "",
    "  new       a new project of one agent, in TypeScript or Ruby (--ruby)",
    "  link      this project's folder to one of your orgs: your key, in its .env",
    "  start     the app and its doors: the process you deploy (--prod for production)",
    "  console   the console in a browser, signed in: the sandbox's, --prod for production",
    "  chat      the app in this terminal's own process, and a prompt against it",
    "  prompt    the exact prompt a state would produce, offline",
    "  test      ring 1: the goldens, through the app in this terminal's own process",
    "  simulate  one persona calls the agent, live, with the checks resolving as they land",
    "  eval      ring 3: one real call, re-evaluated by the runtime's code checks",
    "  sessions  list | show a call's log, with what it cost and how it was judged",
    "  runs      list | show | diff the suites, promote a call, and watch the drift",
    "  agent     the agent's settings — yours, the team's, production's — set, knowledge, history, rollback",
    "  lexicon   an agent's words: how the voice says them and what the ears must know",
    "  pipeline  what the agent hears, decides and speaks with, and the knobs over it",
    "  line      which phone is yours, and whose terminal anybody else's call rings in",
    "  numbers   list | import | drop the numbers the org answers at",
    "  carriers  list | show | add | drop the org's carrier accounts: Twilio, a SIP peer, WhatsApp",
    "  personas  list | show | add | edit | rm | try an agent's synthetic callers",
    "  judges    list | add | rm the org's judges and the agent's own: a question asked of calls at hang-up",
    "  docs      the documents the agent searches: push | list | drop | eval | attach",
    "  memory    what memory kept about a contact, forget it, and hold recall to a golden",
    "  remember  the goldens memory.remember is held to: what a call teaches, and what it never keeps",
    "  supervise listen in on a live call: whisper, say, take the line, give it back, end",
    "  providers add | rm | list the provider keys this org brought of its own",
    "  voices    a vendor's voices in a language, and play one here before you choose it",
    "  callbacks the numbers people left when every seat was taken: who to call back",
    "  data      the org's data: erasures and their trail, who read a call, the policy, consent and the do-not-call list, export",
    "  deploy    run this project on Pinecall: a release it installs and starts, list | releases | rollback | rm",
    "  secrets   list | set | rm the values the org's hosted apps are started with",
    "  login     sign this machine in through a browser; `link` asks for it when it is needed",
    "  whoami    which gateway, which org, whether you act in production, and where the key came from",
    "  mcp       the MCP server an assistant runs this CLI as; `mcp install` adds it to every assistant here",
    "",
    "  --prod on any verb runs it in production, if your org lets you act there.",
    "",
  ];
  for (const [name, purpose] of Object.entries(PLANNED)) {
    lines.push(`  ${name.padEnd(10)}${purpose} — not built yet`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Whether this module is the process entry. argv[1] may be the node_modules bin symlink, so it
 * is resolved before comparing with import.meta.url.
 */
function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

// Replace node's verbose `parseArgs` unknown-option message with a pointer to the verb's help.
function saidBy(failed: unknown, verb: string): string {
  const said = failed instanceof Error ? failed.message : String(failed);
  if (!isAnUnknownFlag(failed)) return said;
  const named = said.split(".")[0]!.replace("Unknown option", `no such flag for ${verb}:`);
  return `${named} — \`pinecall ${verb} --help\``;
}

function isAnUnknownFlag(failed: unknown): boolean {
  return failed instanceof Error && (failed as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION";
}

// A closed pipe (`pinecall runs list | head`) raises EPIPE; exit 0 instead of printing a stack trace.
function quietWhenThePipeCloses(stream: NodeJS.WriteStream): void {
  stream.on("error", (failed: NodeJS.ErrnoException) => {
    if (failed.code !== "EPIPE") throw failed;
    process.exit(0);
  });
}

// Guarded so tests can import main() without running the CLI.
if (isEntry()) {
  quietWhenThePipeCloses(process.stdout);
  quietWhenThePipeCloses(process.stderr);
  process.exitCode = await main(process.argv.slice(2));
}
