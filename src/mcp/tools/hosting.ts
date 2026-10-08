/** The `deploy` tool: the project run on Pinecall — a release uploaded and followed until live, its list, its releases, its logs, a rollback, stop and start. */

import { basename, relative } from "node:path";

import type { HostedAppList, Release, ReleaseList } from "@pinecall/agents/wire";
import { z } from "zod";

import { A_SLUG, appPath, NOT_A_NAME, NOT_HOSTED, NOT_SERVABLE, NOTHING_TO_SEND, notDependedOn, sourcesOf, standing, uploaded } from "../../deploy.js";
import { logsOf } from "../../deploy-logs.js";
import { agentFilesOfTheProject } from "../../home.js";
import { languageOf } from "../../language.js";
import { asked, knocked, type Door } from "../../testing/gateway.js";
import { collected } from "../collected.js";
import { Refused, tool } from "../tool.js";
import { PROD, WAIT, WAIT_S } from "./fields.js";

const EVERY_MS = 3000;

export const deploy = tool({
  name: "deploy",
  description: "Run the project on Pinecall: a release uploaded and followed until live; the apps, their releases, their logs, a rollback, stop and start.",
  schema: {
    action: z.enum(["deploy", "wait", "list", "releases", "logs", "rollback", "stop", "start"]).describe("deploy uploads the project as a release; wait follows one further; list the org's apps; releases of one app; logs of its process; rollback sends a release's sources again; stop and start its process"),
    name: z.string().optional().describe("the app's name; the project folder's when left out"),
    note: z.string().optional().describe("`deploy`: a note kept with the release"),
    release: z.number().int().min(1).optional().describe("`wait`: the release to wait for; `rollback`: the release whose sources are sent again"),
    wait_s: WAIT,
    prod: PROD,
  },
  manual:
    "`deploy` uploads the project as a release — what its `.gitignore` files leave in, never `node_modules`, `.git`, `dist` or any `.env` — and Pinecall installs it and starts its agents; the release before keeps answering until the new one's agents register, so no call is cut. It follows the release for `wait_s` and answers whether it is live or why it failed; `wait` follows it further. `logs` reads the app's last lines. TypeScript projects only. Removing an app is never a tool: `pinecall deploy rm` in a terminal.",
  handler: async (args, session) => {
    const root = await session.project();
    const door = await session.door(args.prod);
    const name = args.name ?? basename(root).toLowerCase();
    if (args.action === "list") return await asked<HostedAppList>(door, "/v1/hosted");
    if (!A_SLUG.test(name)) throw new Refused(NOT_A_NAME(name));
    const waitS = args.wait_s ?? WAIT_S;
    switch (args.action) {
      case "releases":
        return await asked<ReleaseList>(door, `${appPath(name)}/releases`);
      case "logs": {
        const lines = collected();
        await logsOf(door, name, false, { everyMs: 2000, withinMs: 15_000, until: () => true }, lines.stream);
        return { app: name, lines: lines.lines() };
      }
      case "stop":
      case "start":
        await knocked(door, `${appPath(name)}/${args.action}`, { method: "POST" });
        return { app: name, [args.action === "stop" ? "stopped" : "started"]: true };
      case "rollback": {
        if (args.release === undefined) throw new Refused("rollback takes the release whose sources are sent again: `releases` lists them");
        const again = await asked<Release>(door, `${appPath(name)}/rollback`, { method: "POST", body: { release: args.release } });
        return { sent: again.release, ...(await followed(door, name, again.release, waitS)) };
      }
      case "wait":
        if (args.release === undefined) throw new Refused("wait takes the release to follow: the one `deploy` answered");
        return await followed(door, name, args.release, waitS);
      default: {
        const foreign = agentFilesOfTheProject(root).find((file) => languageOf(file) !== "typescript");
        if (foreign !== undefined) throw new Refused(NOT_HOSTED(relative(root, foreign)));
        const missing = notDependedOn(root);
        if (missing.length > 0) throw new Refused(NOT_SERVABLE(missing));
        const source = sourcesOf(root);
        if (source.length === 0) throw new Refused(NOTHING_TO_SEND);
        const sent = await uploaded(door, name, source, args.note ?? "");
        return { app: name, release: sent.release, bytes: sent.bytes, sha256: sent.sha256, ...(await followed(door, name, sent.release, waitS)) };
      }
    }
  },
});

// Read the app until the release is live, failed or replaced, or the wait is up: then `wait` follows it further.
async function followed(door: Door, name: string, release: number, waitS: number): Promise<Record<string, unknown>> {
  const until = Date.now() + waitS * 1000;
  for (;;) {
    const app = (await asked<HostedAppList>(door, "/v1/hosted")).apps.find((one) => one.name === name);
    const said = app === undefined ? undefined : standing(app, release);
    if (said !== undefined) return { live: said.code === 0, said: said.line };
    if (Date.now() >= until) return { live: false, waiting: true, says: `release ${release} is not live yet: call deploy with action wait and release ${release}` };
    await new Promise((rung) => setTimeout(rung, EVERY_MS));
  }
}
