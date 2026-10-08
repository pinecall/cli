/** Where a written call is dialled: the `/v1/chat` socket of a gateway, how a call opens on it, and how long a dropped one is redialled. */

/** How a written call opens: which process serves it, who calls, who plays them, in what state. */
export interface Opened {
  /** Pin the serving process; otherwise the gateway picks the newest socket holding the agent. */
  app?: string;
  /** The contact memory files the call under. */
  contact?: string;
  /** The simulated persona; the gateway records it on `call.started` for attribution. */
  persona?: string;
  /** The state the call opens in, carried on its `call.started`. */
  state?: Record<string, unknown>;
}

/** The `/v1/chat` WebSocket URL for a gateway base URL. */
export function chatUrl(base: string, agent: string, opened: Opened = {}): string {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/chat`;
  url.searchParams.set("agent", agent);
  // searchParams encodes each value: a raw `+` in a contact would arrive as a space.
  if (opened.app !== undefined) url.searchParams.set("app", opened.app);
  if (opened.contact !== undefined) url.searchParams.set("contact", opened.contact);
  if (opened.persona !== undefined) url.searchParams.set("persona", opened.persona);
  if (opened.state !== undefined) url.searchParams.set("state", JSON.stringify(opened.state));
  return url.toString();
}

// Reconnect budget: about a minute in total, enough for a gateway restart.
export const BACK_TRIES = 15;
const BACK_FIRST_MS = 500;
const BACK_CAP_MS = 5_000;

/** Exponential backoff before the `back`-th reconnect attempt. */
export function waitBack(back: number): number {
  return Math.min(BACK_FIRST_MS * 2 ** (back - 1), BACK_CAP_MS);
}
