/** The `console_url` tool: the console of the sandbox, signed in for five minutes, once. */

import { z } from "zod";

import { aLoginCode, consoleUrl } from "../../start-console.js";
import { tool } from "../tool.js";

export const consoleTool = tool({
  name: "console_url",
  description: "A link that opens the sandbox's console signed in, on the org's floor or on one agent: good for five minutes, once.",
  schema: { agent: z.string().optional().describe("open on this agent's screens; the org's floor when left out") },
  manual:
    "`console_url` answers a link for the person to open: the console signed in, its calls with every turn and verdict, its settings, a playground to talk to the agent by voice. The link carries a one-use code that dies in five minutes; it is the one value no answer hides.",
  reveals: (result) => [String((result as { url: string }).url)],
  handler: async (args, session) => {
    const door = await session.door();
    const url = consoleUrl(door.url, door.world, args.agent, await aLoginCode(door));
    return { url, expires: "five minutes, one use" };
  },
});
