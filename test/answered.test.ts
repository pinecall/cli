// A written caller is owed an answer for every line sent: heard as a turn, then the agent listening again.

import { describe, expect, it } from "vitest";

import { answered, NOTHING_OWED, owing, sent } from "../src/answered.js";

const HEARD = { type: "turn.user", data: {} };
const LISTENING = { type: "agent.state", data: { state: "listening" } };

describe("what a written caller is owed", () => {
  it("is nothing before a line is sent", () => {
    expect(answered(NOTHING_OWED)).toBe(true);
  });

  it("is a line sent until it is heard and the agent listens again", () => {
    const one = sent(NOTHING_OWED);
    const heard = owing(one, HEARD);

    expect(answered(one)).toBe(false);
    expect(answered(heard)).toBe(false);
    expect(answered(owing(heard, LISTENING))).toBe(true);
  });

  it("is two answers for two lines sent together, taken one turn at a time", () => {
    const first = owing(owing(sent(sent(NOTHING_OWED)), HEARD), LISTENING);

    expect(answered(first)).toBe(false);
    expect(answered(owing(owing(first, HEARD), LISTENING))).toBe(true);
  });

  it("is not paid by the agent listening before it heard anything", () => {
    expect(owing(sent(NOTHING_OWED), LISTENING)).toEqual(sent(NOTHING_OWED));
  });
});
