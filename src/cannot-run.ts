/** The error a verb throws when it cannot run as typed (exit code 2). */

/**
 * Exit 2: the command cannot run at all (no key, unknown flag, unknown name); retrying won't help.
 * Exit 1 is reserved for a result that failed (a broken golden, a gateway refusal).
 * `cli/index.ts` maps this class to the exit code.
 */
export class CannotRun extends Error {
  override readonly name = "CannotRun";
}

/** Build a `CannotRun`: `throw cannotRun(\`no agent ${slug}…\`)`. */
export function cannotRun(said: string): CannotRun {
  return new CannotRun(said);
}
