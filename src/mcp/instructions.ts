/** The server's instructions: the journey from nothing to an agent answering, and the tools by stage. Each tool's manual rides its own description. */

import type { Stage } from "./tools/all.js";

const JOURNEY = `Pinecall runs voice and chat agents written as a class. These tools take a person from an empty
folder to an agent on Pinecall, without a terminal.

The journey: \`project\` (show, open or new) → \`whoami\`, which is refused naming \`link\` when the
project has no key, and \`link\` names \`login\` when this machine is not signed in → \`start\` holds
the agent → \`chat\` talks to it, \`test\` runs its goldens, \`simulate\` plays a caller → \`agent\`,
\`voices\`, \`lexicon\`, \`docs\` and \`memory\` tune it → \`deploy\` runs it on Pinecall →
\`console_url\` opens the console for the person. \`docs_search\` and \`get_doc\` read
docs.pinecall.io: read a page whole before writing code from it.

Every tool acts in the sandbox. A server a person installed with \`pinecall mcp install --prod\`
takes \`prod: true\` on a tool, and the org's own switch still decides; any other server refuses it.

A tool that runs long (\`login\`, \`test\`, \`simulate\`, \`deploy\`) answers within \`wait_s\` seconds
(25 unless asked, at most 50) with what it has, and says how to keep waiting.

No secret passes through you: no tool takes a vendor key, a carrier secret or an app's secret, and
none returns a Pinecall key. A person types those in a terminal (\`pinecall providers add\`,
\`pinecall carriers add\`, \`pinecall secrets set\`) or in the console.

What cannot be undone is not a tool: erasing data, forgetting a contact, dropping a base, a number
or a carrier, removing a deployed app. Those stay \`pinecall\` verbs a person types.`;

/** The instructions a host gives the model: the journey, then each stage's tools by name. */
export function instructions(stages: readonly Stage[]): string {
  return [JOURNEY, "", "## The tools, by stage", "", ...stages.map((one) => `- **${one.stage}**: ${one.tools.map((tool) => `\`${tool.name}\``).join(", ")}`)].join("\n");
}
