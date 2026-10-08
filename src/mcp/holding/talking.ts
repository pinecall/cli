/** A written call with the held agent: one socket per call, and each line answered whole — the agent's turns, its tools and their results. */

import { signed } from "@pinecall/agents/client";
import WebSocket from "ws";

import { answered, NOTHING_OWED, owing, sent, type Owed } from "../../answered.js";
import { chatUrl } from "../../chat-url.js";
import type { Open } from "../../env.js";
import { Refused } from "../tool.js";

/** How long one line waits for the agent to finish answering it. */
export const ANSWERS_WITHIN_MS = 60_000;
const HANG_UP_WITHIN_MS = 5_000;

/** One entry of the call as a model reads it. */
export type Heard =
  | { agent: string }
  | { tool: string; args: unknown }
  | { result: string; output: unknown }
  | { state: Record<string, unknown> }
  | { error: string };

/** What one line got back. */
export interface Answer {
  call: string | null;
  heard: Heard[];
  /** The call ended while answering (the agent hung up, or the gateway closed it). */
  ended: boolean;
}

/** One open written call. */
export class Talk {
  call: string | null = null;
  ended = false;
  private owed: Owed = NOTHING_OWED;
  private heard: Heard[] = [];
  private waiting: (() => void) | undefined;

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (frame: Buffer) => this.took(JSON.parse(frame.toString()) as Entry));
    socket.on("close", (_code, reason: Buffer) => {
      this.ended = true;
      const why = reason.toString();
      if (why !== "" && !why.startsWith("the call ended")) this.heard.push({ error: why });
      this.waiting?.();
    });
  }

  /** Dial the agent on this app, as this caller, in this state. */
  static async opened(door: Open, slug: string, app: string, contact?: string, state?: Record<string, unknown>): Promise<Talk> {
    const url = chatUrl(door.url, slug, { app, ...(contact === undefined ? {} : { contact }), ...(state === undefined ? {} : { state }) });
    const socket = new WebSocket(url, { headers: signed(door.apiKey, door.world) });
    await new Promise<void>((open, refuse) => {
      socket.once("open", () => open());
      socket.once("error", (failed) => refuse(new Refused(`the gateway did not take the call: ${failed.message}`)));
      socket.once("close", (_code, reason: Buffer) => refuse(new Refused(reason.toString() || "the gateway closed the call before it opened")));
    });
    return new Talk(socket);
  }

  /** Say a line and wait until it was heard and answered, or the call ended. */
  async say(text: string): Promise<Answer> {
    if (this.ended) throw new Refused("this call has ended: say a line without `call` to open another");
    this.heard = [];
    this.socket.send(JSON.stringify({ text }));
    this.owed = sent(this.owed);
    await this.untilAnswered();
    return { call: this.call, heard: this.heard, ended: this.ended };
  }

  /** Hang up: the gateway ends the call and closes the socket. */
  async end(): Promise<Answer> {
    if (!this.ended) {
      this.socket.send(JSON.stringify({ hangup: true }));
      await new Promise<void>((closed) => {
        const late = setTimeout(() => (this.socket.close(), closed()), HANG_UP_WITHIN_MS);
        this.socket.once("close", () => (clearTimeout(late), closed()));
      });
    }
    return { call: this.call, heard: [], ended: true };
  }

  private untilAnswered(): Promise<void> {
    return new Promise((done) => {
      const late = setTimeout(() => {
        this.heard.push({ error: `no answer within ${ANSWERS_WITHIN_MS / 1000}s` });
        this.waiting = undefined;
        done();
      }, ANSWERS_WITHIN_MS);
      this.waiting = () => {
        if (!this.ended && !answered(this.owed)) return;
        clearTimeout(late);
        this.waiting = undefined;
        done();
      };
    });
  }

  private took(entry: Entry): void {
    if (typeof entry.call === "string") this.call = entry.call;
    this.owed = owing(this.owed, entry);
    const heard = heardOf(entry);
    if (heard !== undefined) this.heard.push(heard);
    this.waiting?.();
  }
}

interface Entry {
  type?: string;
  call?: string | null;
  data?: Record<string, unknown>;
}

function heardOf(entry: Entry): Heard | undefined {
  const data = entry.data ?? {};
  switch (entry.type) {
    case "turn.agent":
      return { agent: String(data["text"] ?? "") };
    case "tool.call":
      return { tool: String(data["name"] ?? "?"), args: data["arguments"] ?? {} };
    case "tool.result":
      if (data["error"] !== undefined && data["error"] !== null) return { error: `${String(data["name"] ?? "tool")}: ${String(data["error"])}` };
      return { result: String(data["name"] ?? "?"), output: data["output"] ?? data["summary"] ?? null };
    case "state.changed":
      return { state: (data["state"] as Record<string, unknown> | undefined) ?? {} };
    case "error":
      return { error: String(data["message"] ?? "") };
    default:
      return undefined;
  }
}
