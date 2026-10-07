/** Build an SDK client from a CLI door. */

import { Pinecall } from "@pinecall/agents/client";
import type { Door } from "./testing/gateway.js";

/** A client for this door. Kept in its own module so verbs without a socket never load `ws`. */
export function pinecallFor(door: Door): Pinecall {
  return new Pinecall({ url: door.url, apiKey: door.apiKey, env: door.world });
}
