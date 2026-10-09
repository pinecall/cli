/** The `telemetry` tool: where the org's calls' traces go, shown and cleared; set is the person's terminal. */

import { z } from "zod";

import { asked } from "../../testing/gateway.js";
import { tool } from "../tool.js";

interface Collector {
  endpoint: string;
  header_names: string[];
  pii: boolean;
}

export const telemetry = tool({
  name: "telemetry",
  description: "Where the org sends its calls' traces: its own OpenTelemetry collector, shown or cleared. Setting one is the person's, in a terminal: the headers are a credential.",
  schema: {
    action: z.enum(["show", "clear"]).describe("show says where traces go and which headers are set, never their values; clear stops the export"),
  },
  manual:
    "`telemetry` reads where this org exports a copy of every spoken call's spans (OTLP; a chat has none: the model's requests, speech in and out, every tool, each span carrying pinecall.org, pinecall.env, pinecall.agent and pinecall.call) and can stop it. Pointing it somewhere is never a tool, since the collector's headers are a credential: the person types `pinecall telemetry set <url> --header <name>` in a terminal, where each value is read off stdin.",
  handler: async (args, session) => {
    const door = await session.door();
    if (args.action === "clear") {
      await asked(door, "/v1/telemetry", { method: "DELETE" });
      return { cleared: true };
    }
    const found = await asked<Collector | null>(door, "/v1/telemetry");
    return found === null ? { collector: null, says: "this org sends its traces nowhere" } : { collector: found };
  },
});
