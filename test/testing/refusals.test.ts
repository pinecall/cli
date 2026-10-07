// Extracting the gateway's message from a refusal body.

import { describe, expect, it } from "vitest";

import { Refused } from "../../src/testing/gateway.js";

// Print `detail`, not the raw body; a 422 carries a pydantic error array.
describe("what a refusal says", () => {
  it("is the sentence FastAPI put under detail", () => {
    expect(new Refused(404, JSON.stringify({ detail: "no eval run run_x on this gateway" })).message).toBe(
      "the gateway answered 404: no eval run run_x on this gateway",
    );
  });

  it("names the field and the rule when a request was refused for its shape", () => {
    const body = JSON.stringify({ detail: [{ type: "greater_than_equal", loc: ["query", "limit"], msg: "Input should be greater than or equal to 1" }] });
    expect(new Refused(422, body).message).toBe("the gateway answered 422: limit: Input should be greater than or equal to 1");
  });

  it("prints a body it does not recognise exactly as it arrived", () => {
    expect(new Refused(502, "<html>nginx</html>").message).toBe("the gateway answered 502: <html>nginx</html>");
  });
});
