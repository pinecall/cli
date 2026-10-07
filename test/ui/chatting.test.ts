// The console chat door: class matching, call lifecycle and refusals.

import { describe, expect, it } from "vitest";

import { chattingFrom, type Line, type Lines } from "../../src/ui/chatting.js";
import { Refusal } from "../../src/ui/refusal.js";

/** Fake `Lines` that records every turn, opening state and hangup. */
function aTerminal(): {
  said: string[];
  ended: string[];
  asked: (string | undefined)[];
  opened: (Record<string, unknown> | undefined)[];
  lines: Lines;
} {
  const said: string[] = [];
  const ended: string[] = [];
  const asked: (string | undefined)[] = [];
  const openedIn: (Record<string, unknown> | undefined)[] = [];
  let opened = 0;
  return {
    said,
    ended,
    asked,
    opened: openedIn,
    lines: {
      open: async (contact, opening) => {
        asked.push(contact);
        openedIn.push(opening);
        opened += 1;
        const call = `call_${opened}`;
        const line: Line = { call, say: (text) => said.push(`${call}: ${text}`), end: () => ended.push(call) };
        return line;
      },
      close: async () => {
        ended.push("closed");
      },
    },
  };
}

describe("which class this console chats with", () => {
  it("names the class of the directory `pinecall ui` runs in", async () => {
    const door = chattingFrom("clinica-norte", aTerminal().lines, async () => []);
    expect(await door.roster()).toEqual({ agent: "clinica-norte", states: [] });
  });

  it("refuses another agent: the class mounted here is this directory's", async () => {
    const door = chattingFrom("clinica-norte", aTerminal().lines, async () => []);
    await expect(door.start({ agent: "tienda-sur" })).rejects.toBeInstanceOf(Refusal);
    await expect(door.start({ agent: "tienda-sur" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("one written call", () => {
  it("opens it, files it under the contact the page named, and carries every turn down it", async () => {
    const terminal = aTerminal();
    const door = chattingFrom("clinica-norte", terminal.lines, async () => []);

    const opened = await door.start({ agent: "clinica-norte", as: "+34600111222" });
    await door.say({ call: opened.call, text: "quiero cambiar la cita" });

    expect(opened).toEqual({ call: "call_1" });
    expect(terminal.asked).toEqual(["+34600111222"]);
    expect(terminal.said).toEqual(["call_1: quiero cambiar la cita"]);
  });

  it("keeps two conversations apart, and each turn goes down its own socket", async () => {
    const terminal = aTerminal();
    const door = chattingFrom("clinica-norte", terminal.lines, async () => []);

    const first = await door.start({ agent: "clinica-norte" });
    const second = await door.start({ agent: "clinica-norte" });
    await door.say({ call: second.call, text: "hola" });
    await door.say({ call: first.call, text: "buenas" });

    expect(terminal.said).toEqual(["call_2: hola", "call_1: buenas"]);
  });

  it("hangs up, and then that call is not one this console holds any more", async () => {
    const terminal = aTerminal();
    const door = chattingFrom("clinica-norte", terminal.lines, async () => []);

    const opened = await door.start({ agent: "clinica-norte" });
    await door.end({ call: opened.call });

    expect(terminal.ended).toEqual(["call_1"]);
    await expect(door.say({ call: opened.call, text: "¿hola?" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a call nobody here opened, and a body that is not what the page sends", async () => {
    const door = chattingFrom("clinica-norte", aTerminal().lines, async () => []);
    await expect(door.say({ call: "call_elsewhere", text: "hola" })).rejects.toMatchObject({ status: 404 });
    await expect(door.say({ call: "call_elsewhere" })).rejects.toMatchObject({ status: 422 });
    await expect(door.start({ agent: 3 })).rejects.toMatchObject({ status: 422 });
  });

  // An open socket would leave the gateway thinking the call is still served.
  it("ends every call it holds when the console closes", async () => {
    const terminal = aTerminal();
    const door = chattingFrom("clinica-norte", terminal.lines, async () => []);

    await door.start({ agent: "clinica-norte" });
    await door.start({ agent: "clinica-norte" });
    await door.close();

    expect(terminal.ended).toEqual(["call_1", "call_2", "closed"]);
  });
});

describe("opening in a state", () => {
  // Equivalent of `pinecall chat --state`, picking the golden by name.
  const RESERVA = { name: "reserva", input: ["sí"], state: { stage: "confirm", slot: "martes a las diez" } };

  it("lists only the goldens that declare one", async () => {
    const door = chattingFrom("clinica-norte", aTerminal().lines, async () => [
      RESERVA,
      { name: "saluda", input: ["hola"] },
    ]);

    expect(await door.roster()).toEqual({ agent: "clinica-norte", states: ["reserva"] });
  });

  it("opens the call in that golden's state", async () => {
    const terminal = aTerminal();
    const door = chattingFrom("clinica-norte", terminal.lines, async () => [RESERVA]);

    await door.start({ agent: "clinica-norte", golden: "reserva" });

    expect(terminal.opened[0]).toEqual(RESERVA.state);
  });

  it("refuses a golden that declares none, by name", async () => {
    const door = chattingFrom("clinica-norte", aTerminal().lines, async () => [
      { name: "saluda", input: ["hola"] },
    ]);

    await expect(door.start({ agent: "clinica-norte", golden: "saluda" })).rejects.toMatchObject({ status: 404 });
  });
});
