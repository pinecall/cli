// A gateway with the sign-in doors and whoami, and an MCP client wired to a server in memory: what the MCP tests drive.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { MakesBeside } from "../../src/mcp/holding/held.js";
import { serverOf, type Trace } from "../../src/mcp/server.js";
import { Session } from "../../src/mcp/session.js";

export const A_WORD = "cli_a_word_that_dies_in_ten_minutes";
export const THE_MACHINES_KEY = "pc_live_the_machines_own_key_0001";
export const A_PROJECTS_KEY = "pc_live_the_projects_own_key_0002";

/** A gateway that pairs (approved when told), says who a key is, and lists one org. */
export class FakeGateway {
  approved = false;
  url = "";
  /** More doors for one test: `METHOD /path?query` → status and body; every body asked is kept in `asked`. */
  readonly doors = new Map<string, [number, unknown]>();
  readonly asked: { door: string; body: unknown }[] = [];
  #server!: Server;

  async open(): Promise<void> {
    this.#server = createServer((request, response) => {
      const answer = (status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      const key = (request.headers.authorization ?? "").replace("Bearer ", "");
      const door = `${request.method} ${request.url}`;
      const extra = this.doors.get(door);
      if (extra !== undefined) {
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk.toString()));
        request.on("end", () => {
          this.asked.push({ door, body: body === "" ? null : (JSON.parse(body) as unknown) });
          answer(extra[0], extra[1]);
        });
        return;
      }
      if (request.url === "/v1/login/pairings") return answer(200, { code: A_WORD });
      if (request.url === `/v1/login/pairings/${A_WORD}/key`) return this.approved ? answer(200, { key: THE_MACHINES_KEY }) : answer(202, {});
      if (request.url === "/v1/login/orgs") return answer(200, { orgs: [{ org: "org_1", slug: "clinica", here: false }] });
      if (request.url === "/v1/login/org") return answer(200, { key: A_PROJECTS_KEY });
      // The label echoes the key on purpose: what a tool answers must hide it anyway.
      if (request.url === "/v1/whoami") return answer(200, { org: "org_1", slug: "clinica", key_id: "k_1", label: `made with ${key}`, env: request.headers["pinecall-env"] ?? "sandbox", name: "Berna", production: true });
      return answer(404, { detail: "no such door" });
    });
    await new Promise<void>((bound) => this.#server.listen(0, "127.0.0.1", bound));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((closed) => this.#server.close(() => closed()));
  }
}

/** A folder that is a project: `agents/<name>/agent.tsx`, and a .env with the key when one is given. */
export function aProject(key?: string, url?: string, file = "agent.tsx", agents = ["front-desk"]): string {
  const root = mkdtempSync(join(tmpdir(), "pinecall-mcp-"));
  for (const name of agents) {
    mkdirSync(join(root, "agents", name), { recursive: true });
    writeFileSync(join(root, "agents", name, file), "// the class\n");
  }
  if (key !== undefined) writeFileSync(join(root, ".env"), `PINECALL_KEY=${key}\n${url === undefined ? "" : `PINECALL_URL=${url}\n`}`);
  return root;
}

// What the fake framework's serve entry does: register the agent, unless its class says it is broken; leave on stdin's end.
const A_SERVE_ENTRY = `import { readFileSync } from "node:fs";
export async function main(argv, io) {
  const file = argv[argv.indexOf("--file") + 1];
  const slug = argv[argv.indexOf("--slug") + 1];
  if (readFileSync(file, "utf8").includes("BROKEN")) { io.err.write("Transform failed: Expected ;\\n"); return 1; }
  io.out.write(JSON.stringify({ type: "agent.registered", agent: slug, call: null, data: { app: "app_" + process.pid + "_" + Date.now() } }) + "\\n");
  await new Promise((left) => { io.input.on("end", left); io.input.resume(); });
  io.err.write("draining · no live calls\\n");
  return 0;
}
`;

/** A project that installs a framework whose serve entry registers the agent, so a thread can hold it with no gateway socket. */
export function aServedProject(key: string, url: string): string {
  const root = aProject(key, url);
  const framework = join(root, "node_modules", "@pinecall", "agents");
  mkdirSync(join(framework, "serve"), { recursive: true });
  writeFileSync(join(framework, "package.json"), JSON.stringify({ name: "@pinecall/agents", version: "0.0.0", type: "module", exports: { "./serve": "./serve/index.js" } }));
  writeFileSync(join(framework, "serve", "index.js"), A_SERVE_ENTRY);
  return root;
}

/** A companion that connects to nothing: the tests hold the agent with no gateway socket. */
export const NOTHING_BESIDE: MakesBeside = () => ({ connect: async () => undefined, close: async () => undefined });

/** A client talking to a fresh server in memory, its home a temp folder so no real sign-in is read. */
export async function aClient(production = false, trace?: Trace): Promise<{ client: Client; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "pinecall-home-"));
  const env = { PINECALL_HOME: home };
  const session = new Session(env, production, async () => [], NOTHING_BESIDE);
  const server = serverOf("0.0.0-test", env, production, { session, ...(trace === undefined ? {} : { trace }) });
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "a-test", version: "0" });
  await Promise.all([server.connect(theirs), client.connect(ours)]);
  return { client, home };
}

/** A tool's answer: its text, and whether it was a refusal. */
export async function called(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; refused: boolean }> {
  const answer = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: answer.content.map((part) => part.text).join("\n"), refused: answer.isError === true };
}
