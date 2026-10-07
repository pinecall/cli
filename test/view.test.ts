// The live terminal view is a pure function of the entries, so it is tested without a terminal.

import { describe, expect, it } from "vitest";

import { absorb, draw, metricsLine, screenFor, statePanel } from "../src/view.js";

const anEvent = (type: string, data: unknown): never => ({ type, data }) as never;

describe("the STATE panel", () => {
  it("shows a field the agent wrote and marks the one that just changed", () => {
    const found = absorb(
      screenFor("clinica-norte", "http://localhost:8080"),
      anEvent("state.changed", {
        state: { patient: { name: "Ana" }, slots: [] },
        changed: ["patient"],
        cause: { by: "findPatient" },
      }),
    );
    const panel = statePanel(found.state, found.changed);

    expect(panel).toContain('● patient: {"name":"Ana"}');
    expect(panel).toContain("  slots: []");
  });

  it("says so rather than showing an empty box before the first tool has run", () => {
    expect(statePanel({}, [])).toEqual(["  (no state yet)"]);
  });

  it("keeps only the fields of the last state.changed, because the state is sent whole", () => {
    let screen = screenFor("clinica-norte", "http://localhost:8080");
    screen = absorb(screen, anEvent("state.changed", { state: { patient: "Ana" }, changed: ["patient"] }));
    screen = absorb(screen, anEvent("state.changed", { state: { patient: "Ana", slots: [1] }, changed: ["slots"] }));

    expect(statePanel(screen.state, screen.changed)).toEqual(['  patient: Ana', "● slots: [1]"]);
  });
});

describe("the metrics line of a turn", () => {
  it("prints the three latencies livekit measured, in milliseconds", () => {
    const line = metricsLine({ e2e_latency: 1.234, llm_node_ttft: 0.41, tts_node_ttfb: 0.087 });

    expect(line).toBe("e2e_latency 1234ms  llm_node_ttft 410ms  tts_node_ttfb 87ms");
  });

  it("leaves out what the session did not measure rather than printing a zero", () => {
    expect(metricsLine({ e2e_latency: 0.5 })).toBe("e2e_latency 500ms");
    expect(metricsLine({})).toBe("no metrics on this turn");
  });
});

describe("the view as a whole", () => {
  it("draws the header, the transcript and the last turn's metrics", () => {
    let screen = screenFor("clinica-norte", "http://localhost:8080");
    screen = absorb(screen, anEvent("call.started", { channel: "web" }));
    screen = absorb(screen, anEvent("turn.user", { text: "quiero cambiar la hora" }));
    screen = absorb(screen, anEvent("turn.agent", { text: "¿para qué día?", metrics: { e2e_latency: 1 } }));
    screen = absorb(screen, anEvent("tool.call", { name: "freeSlots", arguments: { day: "martes" } }));

    const page = draw(screen, 30, 100);

    expect(page).toContain("pinecall clinica-norte  http://localhost:8080  calls 1");
    expect(page).toContain("‹ quiero cambiar la hora");
    expect(page).toContain("› ¿para qué día?");
    expect(page).toContain('→ freeSlots({"day":"martes"})');
    expect(page).toContain("metrics  e2e_latency 1000ms");
  });

  it("shows the raw entries instead of the panels when the e key is on", () => {
    const screen = absorb(screenFor("a", "u"), anEvent("turn.user", { text: "hola" }));

    expect(draw(screen, 30, 200, true)).toContain('{"type":"turn.user","data":{"text":"hola"}}');
  });

  it("never writes a line wider than the terminal it is drawn on", () => {
    const screen = absorb(screenFor("a", "u"), anEvent("turn.user", { text: "x".repeat(500) }));

    for (const line of draw(screen, 20, 40).split("\n")) expect(line.length).toBeLessThanOrEqual(40);
  });
});
