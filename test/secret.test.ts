/** Piped stdin handed out a line at a time, so several values can share one pipe. */

import { Readable } from "node:stream";
import { expect, it } from "vitest";

import { linesOfStdin } from "../src/secret.js";

it("gives each call the next line of one pipe, and nothing past the last", async () => {
  const next = linesOfStdin(Readable.from([Buffer.from("Basic cGs6c2s=\n4\n")]));
  expect([await next(), await next(), await next()]).toEqual(["Basic cGs6c2s=", "4", ""]);
});

it("reads an empty pipe as empty values", async () => {
  const next = linesOfStdin(Readable.from([]));
  expect(await next()).toBe("");
});
