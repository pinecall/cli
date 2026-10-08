/** `pinecall console [agent]`: open the console in a browser, signed in with this project's key. */

import { parseArgs } from "node:util";

import { openInABrowser } from "./browser.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { aLoginCode, consoleUrl, whyNoConsole } from "./start-console.js";

export const group: Group = {
  purpose: "the console in a browser, signed in: the sandbox's, or production's with --prod",
  usage: `usage: pinecall console [agent] [--prod] [--no-open]

  Opens the console of the world this verb acts in, signed in. The key itself never travels: the
  gateway mints a one-use code for it, good for five minutes, and the page spends the code for a
  key of that browser's own.

  Without --prod it is the SANDBOX's console — the same gateway under /sandbox, where your
  \`pinecall start\` registers, with your own copies, their calls, chat, evals, knowledge and
  memory. With --prod it is production's, at the gateway's root, if your org lets you act there.

  With no agent it opens the org's floor; name one and it opens that agent's screens.

  --no-open    print the URL and do not open a browser`,
  run,
};

/** Output streams, environment and browser opener overrides, for tests. */
export interface Opening {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  open?: (url: string) => void;
}

export async function run(argv: string[], opening: Opening = {}): Promise<number> {
  const out = opening.out ?? process.stdout;
  const err = opening.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { "no-open": { type: "boolean", default: false } },
  });
  const door = await theDoor(opening.env ?? process.env, err);
  if (door === undefined) return 2;
  // Mint the one-use login code in the world asked; a bad key is refused here, before a browser
  // opens. The key itself never leaves this process.
  let code: string;
  try {
    code = await aLoginCode(door);
  } catch (refused) {
    err.write(`${whyNoConsole(refused)}\n`);
    return 1;
  }
  const url = consoleUrl(door.url, door.world, positionals[0], code);
  out.write(`console  ${url}   (opens within five minutes, once)\n`);
  if (values["no-open"] !== true) (opening.open ?? openInABrowser)(url);
  return 0;
}
