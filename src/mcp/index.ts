/** `pinecall mcp`: the MCP server on stdio, and `install`, which writes it into every assistant on this machine. */

import { parseArgs } from "node:util";

import type { Group } from "../groups.js";
import { version } from "../version.js";
import { PRODUCTION, theChosenWorld } from "../world.js";
import { installEverywhere, listed, reported } from "./install/installing.js";

const USAGE = "usage: pinecall mcp [--prod]\n       pinecall mcp install [--list | --remove] [--prod]";

export const group: Group = {
  purpose: "the MCP server an assistant runs this CLI as, and `install`, which adds it to every assistant here",
  usage: `${USAGE}

  With nothing after it, the MCP server on stdin and stdout, for an assistant to launch: the tools
  sign this machine in, link a project, and (as they land) hold the agent, chat with it, test it.
  It starts no process of its own. Every tool acts in the sandbox; started with --prod, a tool
  may ask for production, and your org's switch still decides.

  install writes \`npx -y pinecall@latest mcp\` into every assistant installed here — Claude Code,
  Claude Desktop, Codex, Cursor, Windsurf, Antigravity, Gemini CLI — replacing an older entry,
  copying each file to .bak first, and leaving every other setting and comment as it was. No key
  is written: the server reads the project's .env.

  --list     every assistant, and whether Pinecall is in it; changes nothing
  --remove   take Pinecall out of every assistant
  --prod     the server may act in production (install writes the flag into each entry)`,
  run,
};

export async function run(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const production = theChosenWorld() === PRODUCTION;
  if (argv[0] === "install") {
    const { values } = parseArgs({ args: argv.slice(1), options: { list: { type: "boolean" }, remove: { type: "boolean" } } });
    if (values.list === true) {
      out.write(`assistants on this machine:\n${listed().join("\n")}\n`);
      return 0;
    }
    const done = installEverywhere(production, values.remove === true);
    out.write(`${reported(done, values.remove === true).join("\n")}\n`);
    return done.some((one) => one.did === "failed") ? 1 : 0;
  }
  if (argv.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  // The SDK is loaded only here: `pinecall prompt` must not pay for it.
  const { serve } = await import("./server.js");
  await serve(version(), process.env, production);
  return 0;
}
