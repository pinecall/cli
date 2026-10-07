/** The machine label shown on keys minted for this terminal. */

import { hostname } from "node:os";

/** The hostname, or "cli" when it cannot be read. */
export function thisMachine(): string {
  try {
    return hostname();
  } catch {
    return "cli";
  }
}
