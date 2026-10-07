/** `pinecall start` output modes: the plain log and the full-screen view, over the agent's process. */

import type { CamelEvent } from "@pinecall/agents/client";
import { absorb, draw, screenFor, type Screen } from "./view.js";

// Repaint at most 10 times a second; per-event redraws flicker.
const FRAME_MS = 100;

const CLEAR = "\x1b[2J\x1b[3J\x1b[H";
const KEYS = "keys: p pause · c clear · e events · q quit";

/** Subscribe to an agent's events; returns an unsubscribe function. */
export type Listen = (listener: (event: CamelEvent) => void) => () => void;


/** The agent's process, as the screens see it: its lines, and when it is gone. */
export interface Held {
  /** Resolves with its exit code. */
  gone: Promise<number>;
  /** Ask it to leave, as a signal would. */
  leave(): Promise<number>;
}

/** One agent in the plain log: its events, its `connected` line, and lines printed after it. */
export interface Plain {
  slug: string;
  heard: Listen;
  connected: string;
  after: () => Promise<string[]>;
}

// Default mode: append-only lines without cursor movement, for process managers and `docker logs`.
// With several agents each line is prefixed with the slug. Ends when the agent's process does.
export async function plain(held: Held, agents: Plain[], url: string): Promise<number> {
  const width = Math.max(...agents.map((agent) => agent.slug.length));
  const prefix = (slug: string): string => (agents.length > 1 ? `${slug.padEnd(width)} │ ` : "");
  for (const agent of agents) {
    let screen = screenFor(agent.slug, url);
    agent.heard((event) => {
      const before = screen;
      screen = absorb(screen, event);
      for (const line of newLines(before, screen)) process.stdout.write(`${prefix(agent.slug)}${line}\n`);
    });
  }
  for (const agent of agents) process.stdout.write(`${prefix(agent.slug)}${agent.connected}\n`);
  for (const agent of agents) {
    for (const said of await agent.after()) process.stdout.write(`${prefix(agent.slug)}${said}\n`);
  }
  return await held.gone;
}

// Lines an event added to the screen, so the plain log appends only those.
function newLines(before: Screen, after: Screen): string[] {
  const lines: string[] = [];
  for (const line of after.transcript.slice(before.transcript.length)) lines.push(`${line.mark} ${line.text}`);
  for (const line of after.tools.slice(before.tools.length)) lines.push(`${line.mark} ${line.text}`);
  for (const metric of after.metrics.slice(before.metrics.length)) lines.push(`metrics  ${metric}`);
  if (after.changed !== before.changed && after.changed.length > 0) {
    lines.push(`state    ${after.changed.join(", ")}`);
  }
  return lines;
}

/** The full-screen terminal view, repainted at most ten times a second, until `q` or the process leaves. */
export async function live(held: Held, listen: Listen, watching: Watching): Promise<number> {
  let screen = screenFor(watching.slug, watching.url);
  let paused = false;
  let raw = false;
  let dirty = true;

  const paint = (): void => {
    if (paused || !dirty) return;
    dirty = false;
    const rows = process.stdout.rows ?? 40;
    const columns = process.stdout.columns ?? 100;
    const page = draw(screen, rows - 3, columns, raw);
    process.stdout.write(`${CLEAR}${page}\n\n${KEYS}\n`);
  };

  listen((event) => {
    screen = absorb(screen, event);
    dirty = true;
  });

  const timer = setInterval(paint, FRAME_MS);
  paint();
  // Raw mode turns ^C into a key, so it asks the process to leave as q does; SIGTERM still arrives
  // as a signal, and the process leaves on its own.
  const quit = await new Promise<boolean>((done) => {
    const stop = onKey((key) => {
      if (key === "q" || key === "\u0003") {
        stop();
        done(true);
        return;
      }
      if (key === "p") paused = !paused;
      if (key === "c") screen = screenFor(watching.slug, watching.url);
      if (key === "e") raw = !raw;
      dirty = true;
    });
    void held.gone.finally(() => {
      stop();
      done(false);
    });
  });
  clearInterval(timer);
  process.stdout.write(CLEAR);
  return quit ? await held.leave() : await held.gone;
}

/** The agent the full-screen view shows. */
export interface Watching {
  slug: string;
  url: string;
}

// Raw mode for single keypresses; without a TTY there are no keys but the view still draws.
function onKey(handle: (key: string) => void): () => void {
  const input = process.stdin;
  if (!input.isTTY) return () => undefined;
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  const listener = (chunk: string): void => handle(chunk);
  input.on("data", listener);
  return () => {
    input.off("data", listener);
    input.setRawMode(false);
    input.pause();
  };
}
