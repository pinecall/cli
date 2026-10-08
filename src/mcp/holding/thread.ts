/** An agent served in a worker thread of this process: the project's own serve entry, its `main` called with the thread's streams. */

import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type { Started } from "../../language.js";
import { servingFrom, type Serving } from "../../serving.js";

// A thread is not a process: same pid, own module cache, ended with terminate(). Its stdin ending is
// the order to drain, as for the CLI's child; tsx is registered first when the entry is a checkout's .ts.
const ENTRY = `
const { workerData } = require("node:worker_threads");
const { EventEmitter } = require("node:events");
(async () => {
  if (workerData.tsx !== undefined) (await import(workerData.tsx)).register();
  const { main } = await import(workerData.entry);
  process.exitCode = await main(workerData.argv, { out: process.stdout, err: process.stderr, env: process.env, input: process.stdin, signals: new EventEmitter() });
})();`;

/** Longer than a drain: the gateway's answer, then the tools still running. */
const LEAVES_WITHIN_MS = 40_000;

/** A tenant's leak ends its thread, not the server. */
export const CEILING_MB = 1024;

/** The last lines a thread printed, for the `logs` tool: kept in memory, never written to stdout. */
export class Logs {
  readonly lines: string[] = [];
  constructor(private readonly keep = 500) {}

  add(text: string): void {
    for (const line of text.split("\n")) if (line.trim() !== "") this.lines.push(line);
    if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
  }

  last(count: number): string[] {
    return this.lines.slice(-count);
  }

  /** A stream whose lines land here: what a core writes for a terminal, kept off the protocol's stdout. */
  stream(): NodeJS.WritableStream {
    return new Writable({ write: (chunk: Buffer, _encoding, done) => (this.add(chunk.toString()), done()) });
  }
}

/** A serve entry this server started in a thread. */
export interface Thread extends Serving {
  /** Resolves with the exit code when the thread is gone; the sentence it died with is in the logs. */
  exited: Promise<number>;
  /** Ask it to drain and leave; terminated if it has not within the grace. Resolves when it is gone. */
  stop(): Promise<number>;
}

/** What a thread is started on: the serve entry's file and the argv after it, from the CLI's own `Started`. */
export function threadArgs(started: Started): { entry: string; argv: string[] } {
  const at = started.command.findIndex((word) => /[\\/]serve[\\/]index\.[jt]s$/.test(word));
  if (at < 0) throw new Error("only a TypeScript agent is served in a thread: a Ruby or Python one is attached to the process that runs it");
  return { entry: started.command[at]!, argv: started.command.slice(at + 1) };
}

/** Start the serve entry in a thread and read its lines; its stderr and its non-entry lines go to the logs. */
export function threadServing(started: Started, logs: Logs, registersWithinMs?: number): Thread {
  const { entry, argv } = threadArgs(started);
  const tsx = entry.endsWith(".ts") ? import.meta.resolve("tsx/esm/api") : undefined;
  const worker = new Worker(ENTRY, {
    eval: true,
    workerData: { entry: pathToFileURL(entry).href, argv, tsx },
    env: started.env,
    stdin: true,
    stdout: true,
    stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: CEILING_MB },
  });
  const said = new PassThrough();
  said.on("data", (chunk: Buffer) => logs.add(chunk.toString()));
  worker.stderr.on("data", (chunk: Buffer) => logs.add(chunk.toString()));
  const serving = servingFrom(worker.stdout, said, registersWithinMs);
  const exited = new Promise<number>((done) => {
    worker.once("error", (failed: Error) => logs.add(failed.message.includes("memory") ? `the agent's thread passed its ${CEILING_MB} MB ceiling and was ended` : failed.message));
    worker.once("exit", (code) => done(code));
  });
  let stopping: Promise<number> | undefined;
  const stop = (): Promise<number> => {
    stopping ??= (async () => {
      const late = setTimeout(() => void worker.terminate(), LEAVES_WITHIN_MS);
      worker.stdin?.end();
      try {
        return await exited;
      } finally {
        clearTimeout(late);
      }
    })();
    return stopping;
  };
  return {
    ...serving,
    registered: (slug) =>
      Promise.race([
        serving.registered(slug),
        exited.then((code) => Promise.reject(new Error(`${slug} did not load (exit ${code}): ${logs.last(3).join(" · ") || "no line said why"}`))),
      ]),
    exited,
    stop,
  };
}

/** Run a serve entry's one-shot verb (`prompt`) in a thread to its end, and answer what it printed. */
export async function threadOnce(started: Started): Promise<{ code: number; out: string; err: string }> {
  const { entry, argv } = threadArgs(started);
  const tsx = entry.endsWith(".ts") ? import.meta.resolve("tsx/esm/api") : undefined;
  const worker = new Worker(ENTRY, { eval: true, workerData: { entry: pathToFileURL(entry).href, argv, tsx }, env: started.env, stdout: true, stderr: true });
  let out = "";
  let err = "";
  worker.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  worker.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
  const code = await new Promise<number>((done) => {
    worker.once("error", (failed: Error) => ((err += failed.message), done(1)));
    worker.once("exit", done);
  });
  return { code, out, err };
}
