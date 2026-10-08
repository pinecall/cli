/** Live progress for `pinecall test`: header, a line per golden, and a progress bar. */

import { oneRun, theRuns, type Cell, type Door, type EvalRun } from "./gateway.js";
import { DECLARED, reportOf } from "./matrix.js";

// Poll interval for the run's row.
const EVERY_MS = 500;

/** What is known about the run before the gateway has stored it. */
export interface Watched {
  agent: string;
  goldens: number;
  /** Cases of the org's dataset played beside them: a count when named, `dataset` when the whole of it is, whose size only the gateway knows. */
  cases?: number | "dataset";
  /** Model names for display: the declared model, or those passed on the command line. */
  models: string[];
  /** Display name for the runner's `declared` model. */
  declaredAs: string;
}

const OPEN = "○";
const READING = "reading…";
const BAR_WIDTH = 20;
const FILLED = "█";
const EMPTY = "░";
// Call id prefix length on live lines; the full id is in the report.
const A_CALL_SHOWN = 12;

/**
 * Poll and draw the run's row until the POST that started it answers, then return the run.
 * Non-TTY output gets only the header; `--json` gets nothing.
 *
 * `sharing` lists other streams writing to the same terminal; they are hooked while the block is drawn.
 */
export async function followed(
  door: Door,
  watched: Watched,
  pending: Promise<EvalRun>,
  out: NodeJS.WritableStream,
  asJson: boolean,
  sharing: NodeJS.WritableStream[] = out === process.stdout ? [process.stderr] : [],
): Promise<EvalRun> {
  const knocked = Date.now();
  const live = !asJson && isTerminal(out);
  const total = watched.cases === "dataset" ? null : (watched.goldens + (watched.cases ?? 0)) * Math.max(watched.models.length, 1);
  let settled = false;
  const answered = pending.finally(() => (settled = true));
  let id: string | undefined;
  const bottom = new Bottom(out);
  if (live) bottom.own(sharing);
  try {
    while (!settled) {
      await Promise.race([answered.catch(() => undefined), sleep(EVERY_MS)]);
      if (settled) break;
      if (id === undefined) {
        id = await inFlight(door, watched.agent);
        if (id !== undefined && !asJson) out.write(`${header(watched, id)}\n`);
      }
      if (id === undefined || !live) continue;
      const soFar = await oneRun(door, id);
      bottom.draw([...settledLines(soFar, watched), ...readingLines(soFar), bar(soFar, total, knocked)]);
    }
    bottom.erase();
    return await settledRun(door, answered, id);
  } finally {
    bottom.giveBack();
  }
}

// Node's fetch times out a response not started within 5 minutes, which a long spoken suite
// exceeds. The run continues on the gateway, so fall back to polling its row.
async function settledRun(door: Door, answered: Promise<EvalRun>, id: string | undefined): Promise<EvalRun> {
  try {
    return await answered;
  } catch (lost) {
    if (id === undefined) throw lost;
    return await untilItStops(door, id);
  }
}

/** Poll a run until it is no longer running. */
async function untilItStops(door: Door, id: string): Promise<EvalRun> {
  for (;;) {
    const run = await oneRun(door, id);
    if (run.status !== "running") return run;
    await sleep(EVERY_MS);
  }
}

/** Header line: agent, golden count, the cases played, models and run id. */
export function header(watched: Watched, id: string): string {
  const counted = watched.goldens > 0 || watched.cases === undefined ? [`${watched.goldens} golden${watched.goldens === 1 ? "" : "s"}`] : [];
  if (watched.cases === "dataset") counted.push("the dataset");
  else if (watched.cases !== undefined) counted.push(`${watched.cases} case${watched.cases === 1 ? "" : "s"}`);
  return [watched.agent, ...counted, ...watched.models, id].join(" · ");
}

// The runner admits one run per agent and stores it before the first call, so the newest running
// row is ours.
export async function inFlight(door: Door, agent: string): Promise<string | undefined> {
  const newest = (await theRuns(door, 1, agent))[0];
  return newest?.status === "running" ? newest.id : undefined;
}

// Judged cells, rendered through `reportOf` so live and final lines are identical.
function settledLines(run: EvalRun, watched: Watched): string[] {
  const lines: string[] = [];
  let heading: string | undefined;
  for (const cell of run.matrix?.runs ?? []) {
    if (watched.models.length > 1 && cell.model !== heading) {
      heading = cell.model;
      lines.push(`  ${cell.model === DECLARED ? watched.declaredAs : cell.model}`);
    }
    lines.push(...reportOf(narrowed(run, cell), {}, watched.declaredAs).slice(1, -1));
  }
  return lines;
}

// The run narrowed to a single cell.
function narrowed(run: EvalRun, cell: Cell): EvalRun {
  const matrix = run.matrix!;
  const failures = matrix.failures.filter((one) => one.golden === cell.golden && one.model === cell.model);
  return { ...run, matrix: { ...matrix, models: [cell.model], goldens: [cell.golden], runs: [cell], failures } };
}

// Calls opened but not yet judged.
function readingLines(run: EvalRun): string[] {
  const judged = run.matrix?.runs.length ?? 0;
  return run.calls
    .slice(judged)
    .map((opened) => `  ${OPEN} ${opened.golden}  ${opened.call.slice(0, A_CALL_SHOWN)}…  ${READING}`);
}

// A run of the whole dataset has no total this side knows: it counts what was judged.
function bar(run: EvalRun, total: number | null, knocked: number): string {
  const judged = run.matrix?.runs.length ?? 0;
  const seconds = Math.round((Date.now() - knocked) / 1000);
  if (total === null) return `${judged} judged · ${seconds}s`;
  const filled = total === 0 ? BAR_WIDTH : Math.round((judged / total) * BAR_WIDTH);
  return `[${FILLED.repeat(filled)}${EMPTY.repeat(BAR_WIDTH - filled)}] ${judged}/${total} · ${seconds}s`;
}

// Fallback width: a pty with no window size reports 0 columns.
const A_TERMINAL_WIDTH = 80;

type Write = (...args: unknown[]) => boolean;

interface Writes {
  write: Write;
}

/**
 * A block redrawn in place at the bottom of the terminal. Other writes to the terminal would break
 * the cursor-up count, so every sharing stream's `write` is wrapped to erase the block first.
 */
class Bottom {
  #rows = 0;
  readonly #write: Write;
  readonly #borrowed = new Map<Writes, Write>();

  constructor(private readonly out: NodeJS.WritableStream) {
    this.#write = (out as unknown as Writes).write.bind(out) as Write;
  }

  /** Wrap `write` on this stream and the sharing ones. */
  own(sharing: NodeJS.WritableStream[]): void {
    for (const stream of [this.out, ...sharing]) {
      const owned = stream as unknown as Writes;
      if (this.#borrowed.has(owned)) continue;
      const raw = owned.write.bind(stream) as Write;
      this.#borrowed.set(owned, raw);
      owned.write = (...args: unknown[]) => {
        this.erase();
        return raw(...args);
      };
    }
  }

  /** Restore every wrapped `write`. */
  giveBack(): void {
    for (const [owned, raw] of this.#borrowed) owned.write = raw;
    this.#borrowed.clear();
  }

  /** Redraw the block over the previous one. */
  draw(lines: string[]): void {
    // Count wrapped rows, not lines, or the next redraw lands mid-block.
    const columns = (this.out as NodeJS.WriteStream).columns || A_TERMINAL_WIDTH;
    const climb = this.#rows > 0 ? `\x1b[${this.#rows}A` : "";
    this.#write(`${climb}\x1b[0J${lines.map((line) => `${line}\n`).join("")}`);
    this.#rows = lines.reduce((rows, line) => rows + Math.max(1, Math.ceil([...line].length / columns)), 0);
  }

  /** Clear the block, leaving the cursor where it began. */
  erase(): void {
    if (this.#rows > 0) this.draw([]);
  }
}

function isTerminal(out: NodeJS.WritableStream): boolean {
  return (out as NodeJS.WriteStream).isTTY === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
