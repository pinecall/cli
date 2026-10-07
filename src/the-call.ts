/** Check that a typed call id exists on the gateway, and whether the call is live. */

import { cannotRun } from "./cannot-run.js";
import { asked, Refused, type Door } from "./testing/gateway.js";

/** A call's liveness and log length. */
export interface Standing {
  /** Whether the call is in progress. */
  live: boolean;
  /** Seq of the last log entry. */
  lastSeq: number;
}

/**
 * Read the call's state, throwing CannotRun for an unknown id. `GET /v1/calls/{call}/state` is the
 * only door that answers 404 for an unknown call; the events door returns an empty page.
 */
export async function standingOf(door: Door, call: string): Promise<Standing> {
  let said: { live?: boolean; last_seq?: number };
  try {
    said = await asked<{ live?: boolean; last_seq?: number }>(door, `/v1/calls/${encodeURIComponent(call)}/state`);
  } catch (refused) {
    if (refused instanceof Refused && refused.status === 404) throw cannotRun(NO_SUCH_CALL(call));
    throw refused;
  }
  return { live: said.live === true, lastSeq: said.last_seq ?? 0 };
}

/** Message for an unknown call id; echoes the id so a typo is visible. */
export const NO_SUCH_CALL = (call: string): string =>
  `no call ${call} on this gateway: \`pinecall sessions list\` names the ones there are`;
