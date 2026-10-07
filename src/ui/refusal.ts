/** HTTP-style refusals raised by the console's local doors. */

import { DevRefused } from "@pinecall/agents/client";

import { Refused } from "../testing/gateway.js";
import { refusal } from "../whoami.js";

/** Thrown by a local door; served as `{detail}` with `status`, FastAPI-style. */
export class Refusal extends Error {
  override readonly name = "Refusal";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Map an error to `{status, detail}`: a local `Refusal` or a `DevRefused` keeps its status, a gateway `Refused` keeps
 * the gateway's status and message, anything else is a 500.
 */
export function refusedAs(failed: unknown): { status: number; detail: string } {
  if (failed instanceof Refusal) return { status: failed.status, detail: failed.message };
  if (failed instanceof DevRefused) return { status: failed.status, detail: failed.detail };
  if (failed instanceof Refused) return { status: failed.status, detail: refusal(failed) };
  return { status: 500, detail: failed instanceof Error ? failed.message : String(failed) };
}
