// Device pairing as data: a link to open, the key once approved, and a refusal in the person's words.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { paired, signingIn, TOOK_TOO_LONG } from "../src/pairing.js";

const A_WORD = "cli_a_word_that_dies_in_ten_minutes";
const A_KEY = "pk_the_key_the_page_left";

let server: Server;
let url = "";
let approvedAfter = Number.POSITIVE_INFINITY;
let polls = 0;

beforeEach(async () => {
  polls = 0;
  server = createServer((request, response) => {
    const answer = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/v1/login/pairings") return answer(200, { code: A_WORD });
    polls += 1;
    return polls > approvedAfter ? answer(200, { key: A_KEY }) : answer(202, {});
  });
  await new Promise<void>((bound) => server.listen(0, "127.0.0.1", bound));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  approvedAfter = Number.POSITIVE_INFINITY;
  server.closeAllConnections();
  await new Promise<void>((closed) => server.close(() => closed()));
});

describe("a pairing", () => {
  it("is a link on the gateway's sign-in page, carrying only the one-use word", async () => {
    const pairing = await paired(url);

    expect(pairing.link).toBe(signingIn(url, A_WORD));
    expect(pairing.link).toBe(`${url}/cli?c=${A_WORD}`);
  });

  it("hands over the key once a person approved it, and not before", async () => {
    approvedAfter = 2;
    const pairing = await paired(url);

    expect(await pairing.collected({ every: 1, until: 5_000 })).toBe(A_KEY);
    expect(polls).toBe(3);
  });

  it("gives up in the person's words when nobody approves it in time", async () => {
    const pairing = await paired(url);

    await expect(pairing.collected({ every: 1, until: 20 })).rejects.toThrow(TOOK_TOO_LONG);
  });
});
