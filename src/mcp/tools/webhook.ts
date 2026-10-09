/** The `webhook` tool: where the org's alerts are posted, shown, proven with a test and cleared; set is the person's terminal. */

import { z } from "zod";

import { asked } from "../../testing/gateway.js";
import { tool } from "../tool.js";

interface Webhook {
  url: string;
  signed: boolean;
}

export const webhook = tool({
  name: "webhook",
  description: "Where the org posts its alerts — a monitor fired, the spend unusual, a quota out — shown, proven with a signed test post, or cleared. Setting one is the person's, in a terminal: the secret is a credential.",
  schema: {
    action: z.enum(["show", "test", "clear"]).describe("show says the URL and whether posts are signed; test posts one webhook.test event and says whether the URL answered 2xx; clear stops the posting"),
  },
  manual:
    "`webhook` reads where this org's alerts are posted beyond the agent's log ({type, org, env, agent, at, data}, with x-pinecall-event and, when a secret is set, x-pinecall-signature as sha256=<HMAC-SHA256 of the body>), proves the URL with a test post, and can stop it. Pointing it somewhere is never a tool, since the secret is a credential: the person types `pinecall webhook set <url> --secret` in a terminal, where the secret is read off stdin. The bell in the console is each person's own choice, under Notifications.",
  handler: async (args, session) => {
    const door = await session.door();
    if (args.action === "clear") {
      await asked(door, "/v1/webhook", { method: "DELETE" });
      return { cleared: true };
    }
    if (args.action === "test") {
      return await asked<{ sent: boolean; error: string | null }>(door, "/v1/webhook/test", { method: "POST", body: {} });
    }
    const found = await asked<Webhook | null>(door, "/v1/webhook");
    return found === null ? { webhook: null, says: "this org posts its alerts nowhere" } : { webhook: found };
  },
});
