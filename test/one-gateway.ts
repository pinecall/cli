// A fake gateway serving both worlds at one URL: it reads the world off the `pinecall-env` header,
// answers whoami and mints login codes, and records what every request claimed.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** The person's key, as `pinecall link` writes it to .env. It opens both worlds. */
export const PERSONS_KEY = "pc_the_persons_key";

/** One request the gateway received. */
export interface Knock {
  method: string;
  path: string;
  /** The `pinecall-env` the request carried, if any. */
  world: string | undefined;
  /** The bearer it carried, if any. */
  bearer: string | undefined;
  body: Record<string, unknown>;
}

export class OneGateway {
  readonly heard: Knock[] = [];
  /** The person's production switch. */
  opensProduction = true;
  /** Server tokens the org made; the world of each is its prefix's. */
  readonly tokens = new Set<string>();
  #minted = 0;
  #server: Server | undefined;
  url = "";

  async open(): Promise<void> {
    const server = createServer((request, response) => void this.#heard(request, response));
    await new Promise<void>((bound) => server.listen(0, "127.0.0.1", bound));
    this.#server = server;
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    if (this.#server === undefined) return;
    this.#server.closeAllConnections();
    await new Promise<void>((closed) => this.#server!.close(() => closed()));
    this.#server = undefined;
  }

  async #heard(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let text = "";
    for await (const chunk of request) text += String(chunk);
    const world = request.headers["pinecall-env"];
    const knock: Knock = {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      world: typeof world === "string" ? world : undefined,
      bearer: request.headers.authorization?.replace(/^Bearer /, ""),
      body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
    };
    this.heard.push(knock);
    const [status, body] = this.#answer(knock);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  #answer(knock: Knock): [number, unknown] {
    const token = knock.bearer !== undefined && this.tokens.has(knock.bearer);
    if (knock.bearer !== PERSONS_KEY && !token) return [401, { detail: "this door takes an API key" }];
    // A person's key acts in the world the header names, the sandbox when it names none.
    const own = knock.bearer!.startsWith("pc_live_") ? "production" : "sandbox";
    // A server's token acts in its own world; a header naming the other is refused, as the runtime does.
    if (token && knock.world !== undefined && knock.world !== own) {
      return [403, { detail: `this key is a ${own} server's token, and this request is for ${knock.world}: a server's token opens the world it was made in` }];
    }
    const world = token ? own : (knock.world ?? "sandbox");
    if (!token && world === "production" && !this.opensProduction) {
      return [403, { detail: "Berna has no production access: an admin gives it in Team" }];
    }
    if (knock.path === "/v1/login/codes") {
      if (token) return [403, { detail: "a server's token names nobody" }];
      return [200, { code: `lc_${++this.#minted}`, expires_at: 0 }];
    }
    if (knock.path === "/v1/whoami") {
      return [
        200,
        token
          ? { org: "org_1", slug: "clinica", key_id: "k_server", label: "the server", env: world, name: null, production: world === "production" }
          : { org: "org_1", slug: "clinica", key_id: "k_laptop", label: "the laptop", env: world, name: "Berna", production: this.opensProduction },
      ];
    }
    return [404, { detail: "Not Found" }];
  }
}
