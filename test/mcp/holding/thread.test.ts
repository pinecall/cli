// The agent in a thread: started on the serve entry's own main, registered from its lines, drained on stdin's end — no process started.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Logs, threadArgs, threadOnce, threadServing } from "../../../src/mcp/holding/thread.js";

// A serve entry with the framework's contract: main(argv, io), one entry a line on out, stdin's end to leave.
function aServeEntry(body: string): string {
  const folder = join(mkdtempSync(join(tmpdir(), "pinecall-thread-")), "serve");
  mkdirSync(folder);
  const file = join(folder, "index.js");
  writeFileSync(file, `export async function main(argv, io) {\n${body}\n}\n`);
  return file;
}

const REGISTERS = `
  if (argv[0] === "prompt") { io.out.write("the prompt\\n"); return 0; }
  io.err.write("a line of the tenant's own\\n");
  io.out.write(JSON.stringify({ type: "agent.registered", agent: "front-desk", call: null, data: { app: "app_1" } }) + "\\n");
  await new Promise((left) => { io.input.on("end", left); io.input.resume(); });
  io.err.write("draining · no live calls\\n");
  return 0;`;

describe("a thread holding the agent", () => {
  it("reads the serve entry and its argv out of the command the CLI would start", () => {
    const entry = "/p/node_modules/@pinecall/agents/dist/serve/index.js";

    expect(threadArgs({ command: [process.execPath, entry, "start", "--slug", "x"], env: {} })).toEqual({ entry, argv: ["start", "--slug", "x"] });
    expect(() => threadArgs({ command: ["bundle", "exec", "ruby", "-e", "x"], env: {} })).toThrow("attached to the process that runs it");
  });

  it("registers from its lines, keeps its stderr in the logs, and drains when told to leave", async () => {
    const logs = new Logs();
    const thread = threadServing({ command: [process.execPath, aServeEntry(REGISTERS), "start"], env: {} }, logs);

    expect(await thread.registered("front-desk")).toBe("app_1");
    expect(await thread.stop()).toBe(0);
    expect(logs.last(5)).toEqual(["a line of the tenant's own", "draining · no live calls"]);
  });

  it("refuses with the load's own words when the entry dies before it registers", async () => {
    const logs = new Logs();
    const thread = threadServing({ command: [process.execPath, aServeEntry(`io.err.write("Transform failed: Expected ;\\n"); return 1;`), "start"], env: {} }, logs);

    await expect(thread.registered("front-desk")).rejects.toThrow("Transform failed: Expected ;");
  });

  it("runs a one-shot verb to its end and answers what it printed", async () => {
    const printed = await threadOnce({ command: [process.execPath, aServeEntry(REGISTERS), "prompt"], env: {} });

    expect(printed).toEqual({ code: 0, out: "the prompt\n", err: "" });
  });

  it("keeps only the newest lines it was given", () => {
    const logs = new Logs(3);
    logs.add("a\nb\n\nc\nd");

    expect(logs.last(10)).toEqual(["b", "c", "d"]);
  });
});
