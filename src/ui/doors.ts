/** Dev verbs answered by this process, which has the agent's directory on disk. */

import { type DevVerb } from "@pinecall/agents/wire";

import { DevRefused, type DevHandler } from "@pinecall/agents/client";
import { refusedAs } from "./refusal.js";

import type { Chatting } from "./chatting.js";
import type { Drifting } from "./drifting.js";
import type { Knowing } from "./knowing.js";
import type { Promoting } from "./promoting.js";
import type { Remembering } from "./remembering.js";
import type { Reproducing } from "./reproducing.js";
import type { Simulating } from "./simulating.js";
import type { Testing } from "./testing.js";

/** Doors `pinecall start` provides, one per console screen. */
export interface Own {
  simulating?: Simulating | undefined;
  testing?: Testing | undefined;
  chatting?: Chatting | undefined;
  knowing?: Knowing | undefined;
  remembering?: Remembering | undefined;
  promoting?: Promoting | undefined;
  drifting?: Drifting | undefined;
  reproducing?: Reproducing | undefined;
}

/** Handlers keyed by wire verb. */
export type Verbs = Partial<Record<DevVerb, (asked: unknown) => Promise<unknown>>>;

/** Build the verb table `pinecall start` answers `dev.request` from. A new screen adds one row here. */
export function ownVerbs(own: Own): Verbs {
  const verbs: Verbs = {};
  const { simulating, testing, chatting, knowing, remembering, promoting, drifting, reproducing } = own;
  if (simulating !== undefined) {
    verbs["simulate.start"] = (asked) => simulating.start(asked);
  }
  if (testing !== undefined) {
    verbs["goldens.roster"] = () => testing.roster();
    verbs["goldens.run"] = (asked) => testing.start(asked);
  }
  if (chatting !== undefined) {
    verbs["chat.roster"] = () => chatting.roster();
    verbs["chat.start"] = (asked) => chatting.start(asked);
    verbs["chat.say"] = (asked) => chatting.say(asked);
    verbs["chat.end"] = (asked) => chatting.end(asked);
  }
  if (knowing !== undefined) {
    verbs["knowledge.roster"] = () => knowing.roster();
    verbs["knowledge.push"] = (asked) => knowing.push(asked);
    verbs["knowledge.eval"] = (asked) => knowing.measure(asked);
  }
  if (remembering !== undefined) {
    verbs["memory.roster"] = () => remembering.roster();
    verbs["memory.eval"] = (asked) => remembering.recall(asked);
    verbs["memory.extraction"] = (asked) => remembering.extract(asked);
  }
  if (promoting !== undefined) {
    verbs["promote.roster"] = () => promoting.roster();
    verbs["promote.write"] = (asked) => promoting.promote(asked);
  }
  if (drifting !== undefined) {
    verbs["drift.read"] = (asked) => drifting.read(asked);
  }
  if (reproducing !== undefined) {
    verbs["reproductions.roster"] = (asked) => reproducing.roster(asked);
    verbs["reproductions.read"] = (asked) => reproducing.read(asked);
  }
  return verbs;
}

const NOT_HERE = (verb: string): string => `this process answers no ${verb}: nothing of it is in this directory`;

/** Adapt the verb table to a `DevHandler`; refusals keep their status and message (`refusedAs`). */
export function devHandler(verbs: Verbs): DevHandler {
  return async (verb, data) => {
    const answer = verbs[verb];
    if (answer === undefined) throw new DevRefused(404, NOT_HERE(verb));
    try {
      return (await answer(data)) as Record<string, unknown>;
    } catch (failed) {
      const said = refusedAs(failed);
      throw new DevRefused(said.status, said.detail);
    }
  };
}
