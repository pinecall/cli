// `pinecall chat`: the caller socket it opens, and which process that socket asks to be served by.

import { describe, expect, it } from "vitest";

import { chatUrl } from "../src/chat-url.js";
import { group, lineOf, run } from "../src/chat.js";
import { notASlug } from "../src/home.js";

describe("the caller socket chat opens", () => {
  it("flips the scheme and names the agent on the gateway's own host", () => {
    expect(chatUrl("http://127.0.0.1:8080", "clinica-norte")).toBe(
      "ws://127.0.0.1:8080/v1/chat?agent=clinica-norte",
    );
  });

  it("keeps a path the gateway is proxied under, and goes wss over https", () => {
    expect(chatUrl("https://voice.pinecall.io/pc/", "tienda-sur")).toBe(
      "wss://voice.pinecall.io/pc/v1/chat?agent=tienda-sur",
    );
  });

  // With a `pinecall start` running, an unnamed chat would be served by that process's tools.
  it("asks to be served by this process's own app socket when it has one", () => {
    expect(chatUrl("http://127.0.0.1:8080", "clinica-norte", { app: "app_7c1e" })).toBe(
      "ws://127.0.0.1:8080/v1/chat?agent=clinica-norte&app=app_7c1e",
    );
  });

  // The gateway writes the persona into `call.started`; without it the run cannot be attributed.
  it("names the persona a written simulation is playing", () => {
    expect(chatUrl("http://127.0.0.1:8080", "clinica-norte", { app: "app_7c1e", persona: "office manager" })).toBe(
      "ws://127.0.0.1:8080/v1/chat?agent=clinica-norte&app=app_7c1e&persona=office+manager",
    );
  });

  // `--as` sets the caller id that memory files the call under. `+` must be encoded or it arrives
  // as a space.
  it("says who is calling when --as named a contact, encoded", () => {
    expect(chatUrl("http://127.0.0.1:8080", "clinica-norte", { contact: "+34600123456" })).toBe(
      "ws://127.0.0.1:8080/v1/chat?agent=clinica-norte&contact=%2B34600123456",
    );
  });

  // The gateway puts it on the call's call.started, and the class opens in it before rendering.
  it("carries the state the call opens in as JSON", () => {
    const url = new URL(chatUrl("http://127.0.0.1:8080", "clinica-norte", { state: { stage: "book", patient: { id: "p-1" } } }));
    expect(JSON.parse(url.searchParams.get("state") ?? "")).toEqual({ stage: "book", patient: { id: "p-1" } });
  });

  // Without --as the runtime names an anonymous visitor, so memory keeps nothing.
  it("claims no contact at all when nobody said who is calling", () => {
    expect(chatUrl("http://127.0.0.1:8080", "clinica-norte", { app: "app_7c1e" })).not.toContain("contact");
  });

  it("says in one line that the agent is served from this terminal", () => {
    expect(group.purpose).toContain("served from this terminal");
  });
});

// The verb prints the conversation, the four marks view.ts owns, and errors; the rest is --events.
describe("what one entry off the socket prints", () => {
  const frame = (type: string, data: Record<string, unknown>): string => JSON.stringify({ type, data });

  it("gives the conversation its four marks", () => {
    expect(lineOf(frame("turn.agent", { text: "¿Cuál es su nombre?" }))).toBe("› ¿Cuál es su nombre?");
    expect(lineOf(frame("tool.call", { name: "findPatient", arguments: { phone: "600000001" } }))).toBe(
      '→ findPatient({"phone":"600000001"})',
    );
    expect(lineOf(frame("tool.result", { name: "findPatient", summary: "Ana García" }))).toBe(
      "← findPatient Ana García",
    );
  });

  it("has no line at all for the machinery around it", () => {
    for (const type of ["call.started", "state.changed", "prompt.changed", "tools.changed", "agent.state", "metrics.llm"]) {
      expect(lineOf(frame(type, {}))).toBeNull();
    }
  });

  // A tool error prints its message, not the bare word "error".
  it("says what an error was in the words it carries", () => {
    expect(lineOf(frame("error", { code: "tool_timeout", message: "findPatient took longer than 10s" }))).toBe(
      "✗ findPatient took longer than 10s",
    );
  });

  it("leaves the caller's own sentence to the prompt that already echoed it", () => {
    expect(lineOf(frame("turn.user", { text: "hola" }))).toBeNull();
  });
});

// `--agent` is always a slug and `--file` is the file; a path passed to --agent is refused.
describe("naming an agent, as against naming a file", () => {
  it("takes a slug and says nothing about it", () => {
    expect(notASlug("clinica-norte")).toBeUndefined();
    expect(notASlug(undefined)).toBeUndefined();
  });

  it("refuses a file, and the sentence names the flag that takes one", () => {
    expect(notASlug("agent.tsx")).toBe(
      "an agent is named by its slug, not a file: `--file agent.tsx` names the class to load.",
    );
    expect(notASlug("./agents/clinica.ts")).toContain("--file ./agents/clinica.ts");
    expect(notASlug("src/agent")).toContain("not a file");
  });
});

describe("`pinecall chat <agent>` mounts nothing", () => {
  // Caller side only: the gateway hands the call to whichever process holds the slug, so no `app=`.
  it("opens the chat socket at the slug with no app of its own", () => {
    expect(chatUrl("https://cloud.pinecall.io", "clinica-norte", { contact: "+34600123456" })).toBe(
      "wss://cloud.pinecall.io/v1/chat?agent=clinica-norte&contact=%2B34600123456",
    );
  });

  it("refuses a file where the slug goes, before it looks for a gateway", async () => {
    expect(await run(["agent.tsx"])).toBe(2);
  });
});
