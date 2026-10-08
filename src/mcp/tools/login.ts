/** The `login` tool: this machine signed in through a link a person opens, waited for without holding the host. */

import { z } from "zod";

import { CLOUD_URL } from "../../env.js";
import { keptAs, paired } from "../../pairing.js";
import { refusal } from "../../whoami.js";
import type { Session, Signing } from "../session.js";
import { tool } from "../tool.js";
import { WAIT, WAIT_S } from "./fields.js";

const POLL_MS = 250;

export const login = tool({
  name: "login",
  description: "Sign this machine in to Pinecall: `start` returns a link for the person to open; `status` waits for their approval.",
  schema: {
    action: z.enum(["start", "status"]).describe("start opens a sign-in and answers its link; status waits for the person to approve it"),
    gateway: z.string().url().optional().describe("the gateway to sign in to; Pinecall Cloud when left out"),
    wait_s: WAIT,
  },
  manual:
    "`login` signs this machine in, once: `start` answers a link — show it to the person, who signs in there, in a browser, where a password belongs — then call `status` until it says signed in. No password and no key ever passes through you. Then `link` writes the project's key.",
  handler: async (args, session) => {
    if (args.action === "start") return await started(session, args.gateway ?? CLOUD_URL);
    return await statusOf(session.signing, args.wait_s ?? WAIT_S);
  },
});

// The key is collected in the background; `status` reads how it ended.
async function started(session: Session, url: string): Promise<unknown> {
  const pairing = await paired(url);
  const signing: Signing = { url, link: pairing.link };
  session.signing = signing;
  pairing
    .collected()
    .then((key) => keptAs(url, key, session.env))
    .then(
      (who) => (signing.settled = { name: who.name ?? who.label ?? "this key's person" }),
      (failed: unknown) => (signing.settled = { failed: refusal(failed) }),
    );
  return { link: signing.link, says: "Show the person this link to sign in, then call login with action status." };
}

async function statusOf(signing: Signing | undefined, waitS: number): Promise<unknown> {
  if (signing === undefined) return { signed_in: false, says: "nothing in flight: call login with action start" };
  const until = Date.now() + waitS * 1000;
  while (signing.settled === undefined && Date.now() < until) await new Promise((rung) => setTimeout(rung, POLL_MS));
  const settled = signing.settled;
  if (settled === undefined) return { signed_in: false, waiting: true, link: signing.link };
  if ("failed" in settled) return { signed_in: false, refused: settled.failed };
  return { signed_in: true, gateway: signing.url, as: settled.name };
}
