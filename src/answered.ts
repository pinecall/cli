/** When a written caller is owed nothing more: every line sent was heard as a turn, and the agent is listening again. */

/** Lines sent the gateway has not yet taken as a turn, and whether the agent is still answering one. */
export interface Owed {
  lines: number;
  answering: boolean;
}

export const NOTHING_OWED: Owed = { lines: 0, answering: false };

/** One more line sent, not yet heard. */
export function sent(owed: Owed): Owed {
  return { ...owed, lines: owed.lines + 1 };
}

/**
 * What is still owed after one more entry of the call. Lines sent together are taken one turn at a
 * time: each `turn.user` is one of them heard, and the agent listening again is that one answered.
 */
export function owing(owed: Owed, entry: { type?: string; data?: unknown }): Owed {
  if (entry.type === "turn.user") return { lines: Math.max(owed.lines - 1, 0), answering: true };
  const state = entry.type === "agent.state" ? (entry.data as { state?: string } | undefined)?.state : undefined;
  return state === "listening" && owed.answering ? { ...owed, answering: false } : owed;
}

/** Every line sent was heard and answered. */
export function answered(owed: Owed): boolean {
  return owed.lines === 0 && !owed.answering;
}
