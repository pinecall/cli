// No secret crosses a model: known secrets and anything shaped like a Pinecall key are hidden.

import { describe, expect, it } from "vitest";

import { HIDDEN, scrubbed } from "../../src/mcp/scrubbed.js";

describe("an answer, scrubbed", () => {
  it("hides the secrets the session holds, wherever they appear", () => {
    expect(scrubbed("the key is s3cr3t-value here", ["s3cr3t-value"])).toBe(`the key is ${HIDDEN} here`);
  });

  it("hides anything shaped like a Pinecall key, a server's token or a login code", () => {
    const said = scrubbed("pc_live_abcdef123 · pc_test_abcdef123 · pk_abcdef123 · lc_abcdef123");

    expect(said).toBe([HIDDEN, HIDDEN, HIDDEN, HIDDEN].join(" · "));
  });

  it("leaves a sign-in link's one-use word, which a person must open", () => {
    expect(scrubbed("https://cloud.pinecall.io/cli?c=cli_word_123456")).toContain("cli_word_123456");
  });

  it("ignores a secret too short to be one, rather than hiding every short word", () => {
    expect(scrubbed("a b c", ["a"])).toBe("a b c");
  });
});
