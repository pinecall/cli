/** The `Group` contract for `pinecall <group>` modules, and the planned groups not built yet. */

/** A CLI group module: a one-line purpose and a run function. */
export interface Group {
  purpose: string;
  /** Help text printed under the purpose by `--help`. */
  usage?: string;
  /** The verb never contacts a gateway, so the dispatcher refuses `--prod`. */
  offline?: true;
  run(argv: string[]): Promise<number> | number;
}

/** The text `pinecall <group> --help` prints. */
export function helpFor(name: string, group: Group): string {
  const said = [`pinecall ${name} — ${group.purpose}`];
  if (group.usage !== undefined) said.push("", group.usage.trimEnd());
  return `${said.join("\n")}\n`;
}

/**
 * Groups that are designed but not built: typing one prints what it will do instead of
 * "unknown command". Remove an entry when the verb is implemented.
 */
export const PLANNED: Record<string, string> = {
  g: "generate a tool, a component, a golden, a persona, a channel",
  observe: "the agent log as it happens, with a persistent cursor",
  costs: "what the calls cost, by agent, model or channel",
  call: "the agent dials a number, for real",
  tokens: "mint a browser token for a web call",
};

/** The message a planned group prints. */
export function notBuiltYet(name: string, purpose: string): string {
  return `${name} is not built yet: ${purpose}`;
}

/** A runnable stub for a planned group that prints its purpose and exits 0. */
export function plannedGroup(name: string, purpose: string, out: NodeJS.WritableStream): Group {
  return {
    purpose,
    run() {
      out.write(`${notBuiltYet(name, purpose)}\n`);
      return 0;
    },
  };
}
