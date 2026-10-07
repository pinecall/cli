/** Follows a simulated call's log, printing it as entries arrive. */

import type { CamelEvent } from "@pinecall/agents/client";
import { lineFor, metricsLine } from "../view.js";
import type { Entry, Spoken } from "./gateway.js";

// Quiet period before the caller's next line, and the per-turn timeout.
export const SETTLE_MS = 400;
export const A_TURN_MAY_TAKE_MS = 30_000;

// The simulation's only view of the call; the caller model's transcript is built from these entries.
export class Heard {
  call: string | undefined;
  agentTurns = 0;
  /** Whether the call has ended, whoever hung up. */
  over = false;
  readonly said: Spoken[] = [];
  private last = Date.now();

  constructor(
    private readonly out: NodeJS.WritableStream,
    private readonly opened?: ((call: string) => void) | undefined,
  ) {}

  /** Record an entry and print it if it is a conversation line. */
  absorb(entry: Entry): void {
    this.last = Date.now();
    if (typeof entry.call === "string" && this.call === undefined) {
      this.call = entry.call;
      this.opened?.(entry.call);
    }
    if (entry.type === "turn.agent") this.agentTurns += 1;
    // Stop sending turns after call.ended, or each one waits out the full turn timeout.
    if (entry.type === "call.ended") this.over = true;
    if (entry.type === "turn.user" || entry.type === "turn.agent") {
      this.said.push({
        who: entry.type === "turn.agent" ? "agent" : "caller",
        said: String(entry.data["text"] ?? ""),
      });
    }
    // Print from the log, not from what was sent: on a spoken call the caller's turn is the STT output.
    const line = lineFor(entry as unknown as CamelEvent);
    if (line === null) return;
    const metrics = entry.type === "turn.agent"
      ? `  ${metricsLine(entry.data["metrics"] as Record<string, unknown> | undefined)}`
      : "";
    this.out.write(`${line.mark} ${line.text}${metrics}\n`);
  }

  /** Wait for the next agent turn, then for the log to go quiet. */
  async answered(said: number): Promise<void> {
    const deadline = Date.now() + A_TURN_MAY_TAKE_MS;
    while (this.agentTurns === said && !this.over && Date.now() < deadline) await after(SETTLE_MS / 4);
    await this.quiet();
  }

  /** Wait until no entry has arrived for SETTLE_MS. */
  async quiet(): Promise<void> {
    const deadline = Date.now() + A_TURN_MAY_TAKE_MS;
    while (Date.now() - this.last < SETTLE_MS && Date.now() < deadline) await after(SETTLE_MS / 4);
  }
}

export function after(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, ms));
}
