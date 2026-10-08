/** The server's instructions: the journey from nothing to an agent answering, then every tool's manual. */

import type { Tool } from "./tool.js";

const JOURNEY = `Pinecall runs voice and chat agents written as a class. These tools take a person from an empty
folder to an agent that answers, without a terminal: whoami → (login → link) → project.

Every tool acts in the sandbox. Production is reached only by a server a person installed with
\`pinecall mcp install --prod\`.

No secret passes through you: no tool takes a vendor key, a carrier secret or an app's secret, and
none returns a Pinecall key. A person types those in a terminal (\`pinecall providers add\`,
\`pinecall carriers add\`, \`pinecall secrets set\`) or in the console.

What cannot be undone is not a tool: erasing data, forgetting a contact, dropping a base, a number
or a carrier, removing a deployed app. Those stay \`pinecall\` verbs a person types.`;

/** The instructions a host gives the model, assembled from the tools' manuals. */
export function instructions(tools: readonly Tool[]): string {
  return [JOURNEY, "", "## The tools", "", ...tools.map((one) => `- **${one.name}** — ${one.manual}`)].join("\n");
}
