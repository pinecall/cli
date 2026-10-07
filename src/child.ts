/** The serve entry as a child process: started detached, told to leave once, killed if it does not. */

import { spawn, type ChildProcess } from "node:child_process";

import { cannotRun } from "./cannot-run.js";
import type { Started } from "./language.js";
import { servingFrom, type Served, type Serving } from "./serving.js";

/** A serve entry this process started. */
export interface Child extends Serving {
  /** Resolves with the exit code when it is gone. */
  exited: Promise<number>;
  /** Ask it to leave (it drains), kill it if it has not within the grace; resolves when it is gone. */
  stop(): Promise<number>;
}

/** Longer than a drain: the gateway's answer, then the tools still running, 30 s at most. */
const LEAVES_WITHIN_MS = 40_000;

/** What starting a child may be given instead of the process's own. */
export interface Spawning {
  err?: NodeJS.WritableStream;
  /**
   * Where SIGINT and SIGTERM are heard, for a verb that waits for the child to leave: the first is
   * passed on, the second kills. Without it this process dies as it would, and the child, its
   * stdin closed, leaves draining.
   */
  signals?: NodeJS.EventEmitter;
  graceMs?: number;
  registersWithinMs?: number;
}

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Start a serve entry with `--events`. Detached, so a terminal's Ctrl-C reaches this process alone;
 * its stdin is a pipe whose end tells it this process is gone.
 */
export function spawnServing(started: Started, how: Spawning = {}): Child {
  const err = how.err ?? process.stderr;
  const [program, ...args] = started.command;
  const child = spawn(program!, args, { detached: true, stdio: ["pipe", "pipe", "inherit"], env: started.env });
  const serving = servingFrom(child.stdout!, err, how.registersWithinMs);
  const exited = exitOf(child);
  const stop = stopper(child, exited, how.graceMs ?? LEAVES_WITHIN_MS);
  if (how.signals !== undefined) passOn(how.signals, child, stop, exited);
  return {
    ...serving,
    registered: (slug) =>
      Promise.race([
        serving.registered(slug),
        exited.then((code) => Promise.reject(cannotRun(`the agent's process left (exit ${code}) before ${slug} registered`))),
      ]),
    exited,
    stop,
  };
}

/** What starts a serve entry; a test hands in its own. */
export type Spawns = (started: Started) => Child;

/**
 * Serve one agent for as long as `use` runs: the entry started, its registration waited for, and
 * the entry stopped on the way out — or the agent stays registered after the verb is done.
 */
export async function whileServing<T>(started: Started, slug: string, use: (served: Served) => Promise<T>, spawns: Spawns = spawnServing): Promise<T> {
  const child = spawns(started);
  try {
    await child.registered(slug);
    return await use({ slug, app: () => child.app(slug) });
  } finally {
    await child.stop();
  }
}

/** Run a serve entry to its end, its output into the streams given, as `prompt` does; resolves with its exit code. */
export function runOnce(started: Started, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const [program, ...args] = started.command;
  const child = spawn(program!, args, { stdio: ["ignore", "pipe", "pipe"], env: started.env });
  child.stdout!.on("data", (chunk: Buffer) => out.write(chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => err.write(chunk.toString()));
  return exitOf(child);
}

function passOn(signals: NodeJS.EventEmitter, child: ChildProcess, stop: () => Promise<number>, exited: Promise<number>): void {
  let heard = 0;
  const passedOn = (): void => {
    heard += 1;
    if (heard === 1) void stop();
    else child.kill("SIGKILL");
  };
  for (const signal of SIGNALS) signals.on(signal, passedOn);
  const unheard = (): void => {
    for (const signal of SIGNALS) signals.off(signal, passedOn);
  };
  exited.then(unheard, unheard);
}

function exitOf(child: ChildProcess): Promise<number> {
  return new Promise((done, refuse) => {
    child.once("error", (failed) => refuse(cannotRun(`${child.spawnfile} could not be started: ${failed.message}`)));
    child.once("exit", (code, signal) => done(code ?? (signal === null ? 1 : 128)));
  });
}

// One SIGTERM and the end of its stdin, then a kill after the grace; asked twice, the same promise.
function stopper(child: ChildProcess, exited: Promise<number>, graceMs: number): () => Promise<number> {
  let stopping: Promise<number> | undefined;
  return () => {
    stopping ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return await exited;
      const kill = setTimeout(() => child.kill("SIGKILL"), graceMs);
      child.kill("SIGTERM");
      child.stdin?.end();
      try {
        return await exited;
      } finally {
        clearTimeout(kill);
      }
    })();
    return stopping;
  };
}
