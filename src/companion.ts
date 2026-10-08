/** The CLI's own socket beside the agent's process: it takes no call, and answers the console's verbs. */

import { createRequire } from "node:module";

import { aLostSocket, Pinecall } from "@pinecall/agents/client";

import type { Home } from "./home.js";
import { callsFrom } from "./line.js";
import type { Served, Serving } from "./serving.js";
import { callingFrom } from "./signed-in.js";
import type { Door } from "./testing/gateway.js";
import { goldensOf } from "./testing/goldens.js";
import { chattingFrom, linesThrough, type Chatting } from "./ui/chatting.js";
import { devHandler, ownVerbs } from "./ui/doors.js";
import { driftingFrom } from "./ui/drifting.js";
import { hereOf, knowingFrom } from "./ui/knowing.js";
import { promotingFrom } from "./ui/promoting.js";
import { rememberingFrom, rememberingPiecesFor } from "./ui/remembering.js";
import { reproducingFrom } from "./ui/reproducing.js";
import { simulatingFrom, simulatingPiecesFor } from "./ui/simulating.js";
import { testingFrom, testingPiecesFor } from "./ui/testing.js";
import { PRODUCTION } from "./world.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/** How the companion names itself in the org's list of processes, apart from the agent's own. */
export const COMPANION_SDK = `pinecall-cli/${version}`;

/** The companion socket, and what closing it lets go. */
export interface Companion {
  pc: Pinecall;
  close(): Promise<void>;
}

/**
 * Hold every agent with `answersDev`: the console's verbs come here, the calls never do, and no
 * declaration is sent, so the agent's process's own stands. `view.render` is the agent's process's,
 * whose class draws the panel. Connect it after the agents registered, so there is a declaration
 * to inherit.
 */
export function companionFor(door: Door, homes: Home[], serving: Serving, out: NodeJS.WritableStream, sdk: string = COMPANION_SDK): Companion {
  const pc = new Pinecall({ url: door.url, apiKey: door.apiKey, env: door.world, sdk });
  const chattings: Chatting[] = [];
  for (const home of homes) {
    const served: Served = { slug: home.name, app: () => serving.app(home.name) };
    const chatting = chattingFrom(home.name, linesThrough(door, out, served), () => goldensOf(home.goldens));
    chattings.push(chatting);
    const agent = pc.agent(home.name, { takesUnclaimed: false, answersDev: true });
    agent.onDev(
      devHandler(
        ownVerbs({
          simulating: simulatingFrom(door, home.name, out, simulatingPiecesFor(served)),
          testing: testingFrom(door, home.name, out, testingPiecesFor(home, served)),
          chatting,
          knowing: knowingFrom(door, home.name, hereOf(home, home.name)),
          remembering: rememberingFrom(door, home.name, rememberingPiecesFor(home)),
          promoting: promotingFrom(door, home.name, out),
          drifting: driftingFrom(door),
          reproducing: reproducingFrom(),
        }),
      ),
    );
  }
  // The agent's process says when the gateway is lost and back; here only an error of our own.
  pc.onErrors((failed) => {
    if (!aLostSocket(failed)) process.stderr.write(`${failed.stack ?? failed.message}\n`);
  });
  // The gateway keeps a developer's phone only while a socket of their key is up: said on every connect.
  pc.onConnected(() => {
    if (door.world !== PRODUCTION) void sayWhoCallsFromHere(door);
  });
  return {
    pc,
    async close(): Promise<void> {
      for (const chatting of chattings) await chatting.close();
      pc.close();
    },
  };
}

/** Re-send the phone number saved by `pinecall line from`; failures are silent. */
async function sayWhoCallsFromHere(door: Door): Promise<void> {
  const kept = callingFrom(door.url);
  if (kept === undefined) return;
  try {
    await callsFrom(door, kept);
  } catch {
    // Retried on the next connect; `pinecall line` shows the actual state.
  }
}
