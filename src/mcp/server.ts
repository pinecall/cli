/** The MCP server: every tool registered on one stdio connection, each answer scrubbed, each failure one sentence. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";

import { refusal } from "../whoami.js";
import { instructions } from "./instructions.js";
import { scrubbed } from "./scrubbed.js";
import { Session } from "./session.js";
import type { Tool } from "./tool.js";
import { TOOLS } from "./tools/all.js";

/** The text content a tool answers with. */
interface Answer {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** A server over these tools, its session in the sandbox unless `production` was allowed. */
export function serverOf(version: string, env: NodeJS.ProcessEnv, production: boolean, tools: readonly Tool[] = TOOLS, given?: Session): McpServer {
  const server = new McpServer({ name: "pinecall", version }, { instructions: instructions(tools) });
  const session = given ?? new Session(env, production, () => declaredRoots(server));
  for (const one of tools) {
    server.registerTool(one.name, { description: one.description, inputSchema: one.schema }, async (args: unknown) =>
      answered(session, () => one.call(args, session), one.reveals),
    );
  }
  return server;
}

/** Serve on this process's stdin and stdout until the host closes them: stdout is the protocol, and nothing else writes to it. */
export async function serve(version: string, env: NodeJS.ProcessEnv, production: boolean, transport: Transport = onStdio()): Promise<void> {
  const session = new Session(env, production, () => declaredRoots(server));
  const server = serverOf(version, env, production, TOOLS, session);
  const closed = new Promise<void>((ended) => (server.server.onclose = ended));
  await server.connect(transport);
  await closed;
  // A host that hangs up leaves no call open and no agent registered.
  await session.close();
}

// The SDK's stdio transport never notices its input ending: the host hanging up closes it here.
function onStdio(): Transport {
  const transport = new StdioServerTransport();
  process.stdin.once("end", () => void transport.close());
  return transport;
}

// A refusal is the model's to act on: its sentence, scrubbed, and never a stack.
async function answered(session: Session, calling: () => Promise<unknown>, reveals?: (result: unknown) => string[]): Promise<Answer> {
  try {
    const result = await calling();
    return { content: [{ type: "text", text: scrubbed(JSON.stringify(result, null, 2), session.secrets(), reveals?.(result) ?? []) }] };
  } catch (failed) {
    const said = failed instanceof ZodError ? failed.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : refusal(failed);
    return { content: [{ type: "text", text: scrubbed(said, session.secrets()) }], isError: true };
  }
}

// A host that declares roots says where the project is; one that does not leaves the cwd and `project open`.
async function declaredRoots(server: McpServer): Promise<string[]> {
  if (server.server.getClientCapabilities()?.roots === undefined) return [];
  try {
    const { roots } = await server.server.listRoots();
    return roots.filter((root) => root.uri.startsWith("file://")).map((root) => fileURLToPath(root.uri));
  } catch {
    return [];
  }
}
