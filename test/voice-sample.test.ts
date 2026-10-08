// The voices as data: the gateway's own voice, a vendor that lists none told so, and a sample's timings read.

import { describe, expect, it } from "vitest";

import { aDuration, defaultVoice, notListed } from "../src/voice-sample.js";

describe("the voices as data", () => {
  it("names the gateway's own voice, and refuses by name when it has none", () => {
    expect(defaultVoice({ providers: [], defaults: { tts: "cartesia" } })).toBe("cartesia");
    expect(() => defaultVoice({ providers: [], defaults: {} })).toThrow("name one with --tts <vendor>");
  });

  it("tells a vendor that lists no voices which ones do", () => {
    expect(notListed("rime", ["cartesia", "elevenlabs"])).toContain("these list theirs: cartesia, elevenlabs");
    expect(notListed("rime", [])).toContain("no vendor of this gateway lists its voices");
  });

  it("reads the first audio and the whole sentence from Server-Timing", () => {
    const header = "first-audio;dur=212, total;dur=840";

    expect(aDuration(header, "first-audio")).toBe(212);
    expect(aDuration(header, "total")).toBe(840);
    expect(aDuration("", "total")).toBeNull();
  });
});
