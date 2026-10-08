// A gateway with the agent's settings doors, for `pinecall agent`'s tests: three corners, a
// history, a diff and the org's processes, and every write it was sent.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const TEAM = {
  holder: "",
  version: 11,
  author: "m_bruno",
  note: "cleaner on the phone",
  set_at: 1758300000,
  config: { voice: "carolina", llm: "anthropic/claude-haiku-5-5", language: "es", greeting: { say: "Clínica Norte, buenas." }, memory: { remember: ["allergies"], forget: [] } },
};
export const YOURS = { holder: "m_ana", version: 3, author: "m_ana", note: null, set_at: 1758310000, config: { voice: "amelia" } };

export const PROCESS = {
  app: "app_7",
  agents: ["clinica-norte", "clinica-norte-sales"],
  env: "production",
  host: "web-1",
  address: "34.1.2.3",
  sdk: "pinecall/0.5.1",
  holder: null,
  connected_at: 1758300000,
};

/** One request as the gateway received it. */
interface Heard {
  method: string;
  path: string;
  body: unknown;
  /** The world the request named (`--prod`), if any. */
  world: string | undefined;
}

/** A gateway with the settings doors that answers the three corners and records every write. */
export class FakeGateway {
  readonly heard: Heard[] = [];
  yours: typeof YOURS | null = YOURS;
  team: typeof TEAM | null = TEAM;
  refuse: { status: number; detail: string } | undefined;
  #server!: Server;
  url = "";

  async open(): Promise<void> {
    this.#server = createServer((request, response) => void this.#answer(request, response));
    await new Promise<void>((bound) => this.#server.listen(0, "127.0.0.1", bound));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((closed) => this.#server.close(() => closed()));
  }

  get written(): Record<string, unknown> {
    const put = this.heard.filter((one) => one.method === "PUT" || one.method === "POST").at(-1);
    return (put?.body ?? {}) as Record<string, unknown>;
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const world = request.headers["pinecall-env"];
    const heard: Heard = {
      method: request.method ?? "",
      path: request.url ?? "",
      body: text === "" ? null : JSON.parse(text),
      world: typeof world === "string" ? world : undefined,
    };
    this.heard.push(heard);
    const answer = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (this.refuse !== undefined && heard.method !== "GET") return answer(this.refuse.status, { detail: this.refuse.detail });
    if (heard.path === "/v1/apps") return answer(200, { apps: [PROCESS] });
    if (heard.path.endsWith("/stop")) return answer(200, { app: "app_7", stopped: true });
    if (heard.path.endsWith("/history?team=true")) return answer(200, { world: "sandbox", holder: "", rows: [TEAM, { ...TEAM, version: 10, note: null, config: { voice: "carolina" } }] });
    if (heard.path.includes("/diff")) return answer(200, { ours: YOURS, theirs: TEAM, changed: ["voice", "llm"] });
    return answer(200, { world: "sandbox", yours: this.yours, team: this.team, production: null });
  }
}
