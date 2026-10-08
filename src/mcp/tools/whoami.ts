/** The `whoami` tool: which org and gateway the project's key opens, and whether it may act in production. */

import { whoIs } from "../../whoami.js";
import { tool } from "../tool.js";

export const whoami = tool({
  name: "whoami",
  description: "Which org, gateway and environment the open project's key acts in, and whether production is allowed.",
  schema: {},
  manual:
    "`whoami` first, in any session: it proves the project's key and names the org. Refused with a sentence naming `link` when the project has no key yet.",
  handler: async (_args, session) => {
    const door = await session.door();
    const who = await whoIs(door);
    return {
      org: who.slug ?? who.org,
      gateway: door.url,
      environment: door.world,
      key_from: door.source,
      person: who.name ?? who.label ?? null,
      production_allowed_for_this_key: who.production === true,
      production_allowed_for_this_server: session.production,
    };
  },
});
