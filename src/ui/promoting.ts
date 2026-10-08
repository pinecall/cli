/** Console door for `runs promote`: write a real call as a golden candidate. */

import type { Golden } from "../testing/goldens.js";
import { Refused, type Door } from "../testing/gateway.js";
import { CANDIDATES, promotedTo } from "../runs/candidate.js";
import { anObject, aString, maybeNumber, someWords } from "./asked.js";
import { Refusal } from "./refusal.js";

/** Written candidate: path, golden, and notes left for a person to resolve. */
export interface Promoted {
  path: string;
  candidate: Golden;
  notes: string[];
}

/** Promote door as the console server uses it. */
export interface Promoting {
  /** Directory candidates are written to. */
  roster(): Promise<{ agent: string | null; out: string }>;
  promote(asked: unknown): Promise<Promoted>;
}

const NO_CLASS = "no agent class in this directory: a candidate is written beside the goldens it will join";

/**
 * Promote door for one `pinecall start`. Writes to local `test/candidates`, so it lives here and
 * not in the gateway; a person edits the candidate before it becomes a golden.
 */
export function promotingFrom(door: Door, agent: string | null, out: NodeJS.WritableStream): Promoting {
  return {
    async roster(): Promise<{ agent: string | null; out: string }> {
      return { agent, out: CANDIDATES };
    },

    async promote(asked: unknown): Promise<Promoted> {
      if (agent === null) throw new Refusal(409, NO_CLASS);
      const given = anObject(asked, "a promotion");
      const call = aString(given, "call");
      const name = someWords(given, "name");
      try {
        const written = await promotedTo(door, call, {
          ...(name === undefined ? {} : { name }),
          out: CANDIDATES,
          fromSeq: maybeNumber(given, "from_seq", 0, Number.MAX_SAFE_INTEGER) ?? 0,
        });
        out.write(`${written.path}  promoted from ${call}\n`);
        return written;
      } catch (refused) {
        // Gateway refusals keep their status; a candidate this side could not write is 422.
        if (refused instanceof Refused) throw refused;
        throw new Refusal(422, refused instanceof Error ? refused.message : String(refused));
      }
    },
  };
}
