// The /v1/chat socket's address: the gateway's own scheme as ws/wss, the agent, and how the call opens.

import { describe, expect, it } from "vitest";

import { chatUrl, waitBack } from "../src/chat-url.js";

describe("where a written call is dialled", () => {
  it("is the gateway's /v1/chat on its websocket scheme, naming the agent", () => {
    expect(chatUrl("https://cloud.pinecall.io", "front-desk")).toBe("wss://cloud.pinecall.io/v1/chat?agent=front-desk");
    expect(chatUrl("http://127.0.0.1:8080/", "x")).toBe("ws://127.0.0.1:8080/v1/chat?agent=x");
  });

  it("pins the process and the caller, encoding a + so it never arrives as a space", () => {
    const url = new URL(chatUrl("https://g.io", "a", { app: "app_1", contact: "+15550100", state: { stage: "ask" } }));

    expect(url.searchParams.get("app")).toBe("app_1");
    expect(url.searchParams.get("contact")).toBe("+15550100");
    expect(JSON.parse(url.searchParams.get("state")!)).toEqual({ stage: "ask" });
  });

  it("redials sooner first and never waits more than five seconds", () => {
    expect([1, 2, 3, 10].map(waitBack)).toEqual([500, 1000, 2000, 5000]);
  });
});
