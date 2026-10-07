/** `pinecall supervise`: what a typed line means, and what a person at the desk is shown. */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ALREADY_ENDED, lineOf, moveOf, run } from "../src/supervise.js";
import { pointingAt } from "./home.js";

// A stream that keeps what was written, so a test can read output as a string.
function collected(): { stream: NodeJS.WritableStream; text(): string } {
  const written: string[] = [];
  const stream = { write: (chunk: string) => written.push(chunk) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => written.join("") };
}

describe("what a typed line means", () => {
  it("reads the five moves the desk has", () => {
    expect(moveOf("t")).toEqual({ verb: "takeover" });
    expect(moveOf("x")).toEqual({ verb: "release" });
    expect(moveOf("w no le has dicho el precio")).toEqual({ verb: "whisper", text: "no le has dicho el precio" });
    expect(moveOf("s Le paso con recepción.")).toEqual({ verb: "say", text: "Le paso con recepción." });
    expect(moveOf("e el paciente colgó")).toEqual({ verb: "end", reason: "el paciente colgó" });
  });

  it("ends a call with no reason when nobody gave one", () => {
    expect(moveOf("e")).toEqual({ verb: "end", reason: undefined });
  });

  it("keeps the whole sentence, spaces and all, and not just the first word", () => {
    expect(moveOf("w dile que la doctora Vidal no pasa consulta el jueves")).toEqual({
      verb: "whisper",
      text: "dile que la doctora Vidal no pasa consulta el jueves",
    });
  });

  // A bare `w` is an early enter, not a whisper of "".
  it("refuses a whisper and a say with nothing to said", () => {
    expect(moveOf("w")).toBeNull();
    expect(moveOf("s")).toBeNull();
  });

  it("q leaves the desk and is not a verb anybody is sent", () => {
    expect(moveOf("q")).toBe("leave");
  });

  it("says nothing at all about a line nobody meant", () => {
    expect(moveOf("hola")).toBeNull();
    expect(moveOf("")).toBeNull();
  });
});

describe("what the desk is shown", () => {
  it("prints both speakers with the seq the entry landed under", () => {
    expect(lineOf(12, "turn.user", { text: "¿Tenéis algo el martes?" })).toBe("  12  caller  ¿Tenéis algo el martes?");
    expect(lineOf(13, "turn.agent", { text: "Sí, a las nueve." })).toBe("  13  agent   Sí, a las nueve.");
  });

  it("prints every move a human made, by the name the log gave it", () => {
    expect(lineOf(20, "supervisor.whispered", { text: "el precio" })).toBe("  20  desk    whispered el precio");
    expect(lineOf(21, "supervisor.took_over", {})).toBe("  21  desk    took_over");
  });

  it("prints the end and why", () => {
    expect(lineOf(30, "call.ended", { reason: "agent_hung_up" })).toBe("  30  ——      ended: agent_hung_up");
  });

  // The desk shows the conversation only; metrics and prompt changes stay in the log.
  it("prints nothing a supervisor cannot act on", () => {
    expect(lineOf(4, "metrics.llm", { ttft: 0.3 })).toBeNull();
    expect(lineOf(5, "prompt.changed", { name: "view" })).toBeNull();
  });
});

describe("the verb itself", () => {
  it("says what it needs when nobody named a call", async () => {
    const err = collected();

    expect(await run([], { err: err.stream, out: collected().stream })).toBe(2);
    expect(err.text()).toContain("usage: pinecall supervise <call>");
  });

  // A mistyped id or an ended call must be refused, not shown as an empty transcript.
  it("refuses a desk on a call that has already ended, and says where to read it", async () => {
    const gateway = await aGatewayWhereTheCall({ live: false, last_seq: 58 });
    const err = collected();

    const code = await run(["call_over"], { err: err.stream, out: collected().stream, env: gateway.env });

    expect(code).toBe(2);
    expect(err.text()).toContain(ALREADY_ENDED("call_over"));
    await gateway.close();
  });

  // Piped input closes the keyboard early; the desk must not draw a prompt afterwards
  // (ERR_USE_AFTER_CLOSE).
  it("takes its moves from a pipe, sends them, and leaves without a word of its own", async () => {
    const desk = await aDeskWhereTheCallIsLive();
    const out = collected();

    const code = await run(["call_live"], {
      out: out.stream,
      err: collected().stream,
      env: desk.env,
      input: Readable.from(["t\n", "s Buenos días.\n", "q\n"]),
    });

    expect(code).toBe(0);
    expect(desk.verbs).toEqual([{ verb: "takeover" }, { verb: "say", text: "Buenos días." }]);
    // The transcript prints; only the keyboard prompt is skipped.
    expect(out.text()).toContain("¿Tenéis algo el martes?");
    expect(out.text()).not.toContain(">");
    await desk.close();
  });

  it("refuses a desk on a call this gateway never wrote", async () => {
    const gateway = await aGatewayWhereTheCall(null);
    const err = collected();

    await expect(run(["CA_typo"], { err: err.stream, out: collected().stream, env: gateway.env })).rejects.toThrow(
      "no call CA_typo on this gateway",
    );
    await gateway.close();
  });
});

/** A gateway with a live call, an endless transcript and working verbs. */
async function aDeskWhereTheCallIsLive(): Promise<{
  env: NodeJS.ProcessEnv;
  verbs: unknown[];
  close(): Promise<void>;
}> {
  const verbs: unknown[] = [];
  const anEntry = {
    seq: 13,
    ts: 1790000000,
    call: "call_live",
    agent: "clinica-norte",
    type: "turn.user",
    ephemeral: false,
    data: { speech_id: "sp_1", text: "¿Tenéis algo el martes?", metrics: {} },
  };
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/verbs") === true) {
      const body: Buffer[] = [];
      request.on("data", (chunk: Buffer) => body.push(chunk));
      request.on("end", () => {
        verbs.push(JSON.parse(Buffer.concat(body).toString()));
        response.writeHead(202, { "content-type": "application/json" });
        response.end("{}");
      });
      return;
    }
    if (request.headers.accept === "text/event-stream") {
      // One turn, then the stream stays open: the desk must leave on its own (the hang under test).
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify(anEntry)}\n\n`);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ live: true, last_seq: 12 }));
  });
  await new Promise<void>((bound) => server.listen(0, "127.0.0.1", bound));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    env: pointingAt(url, "pc_test_a_key"),
    verbs,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}

/** A gateway whose `/state` door answers with that standing, or 404 without one. */
async function aGatewayWhereTheCall(standing: { live: boolean; last_seq: number } | null): Promise<{
  env: NodeJS.ProcessEnv;
  close(): Promise<void>;
}> {
  const server = createServer((_request, response) => {
    response.writeHead(standing === null ? 404 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(standing ?? { detail: "no log for call" }));
  });
  await new Promise<void>((bound) => server.listen(0, "127.0.0.1", bound));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    env: pointingAt(url, "pc_test_a_key"),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}
