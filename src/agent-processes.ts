/** `pinecall agent list` and `agent stop`: the processes holding the org's agents. */

import { type AppList, type AppProcess, type AppStopped } from "@pinecall/agents/wire";

import { asked, type Door } from "./testing/gateway.js";

/** Print every app connected in the key's world, one line each. */
export async function listed(door: Door, out: NodeJS.WritableStream): Promise<number> {
  const { apps } = await asked<AppList>(door, "/v1/apps");
  if (apps.length === 0) {
    out.write("no app is connected here: `pinecall start` holds a project's agents\n");
    return 0;
  }
  for (const app of apps) out.write(`${lineOf(app)}\n`);
  return 0;
}

/**
 * Stop one app: the gateway closes its socket with the stop code, and the process exits instead
 * of reconnecting. A supervisor (systemd, pm2) may restart it.
 */
export async function stopped(door: Door, app: string | undefined, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  if (app === undefined || app === "") {
    err.write("usage: pinecall agent stop <app> — the app is the first column of `pinecall agent list`\n");
    return 2;
  }
  const answer = await asked<AppStopped>(door, `/v1/apps/${encodeURIComponent(app)}/stop`, { method: "POST" });
  out.write(`stopped ${answer.app}: its agents are free — a supervisor that restarts it (systemd, pm2) starts it again\n`);
  return 0;
}

/** One app as a line: id, agents, corner, host and address, SDK, connected since. */
export function lineOf(app: AppProcess): string {
  const whose = app.holder === null ? "the org's" : (app.holder.name ?? app.holder.holder ?? "");
  const where = `${app.host ?? "an unnamed host"}${app.address === null ? "" : ` (${app.address})`}`;
  const since = new Date(app.connected_at * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `${app.app}  ${app.agents.join(", ") || "no agent yet"}  ${whose} · ${where} · ${app.sdk ?? "an unknown sdk"} · since ${since}`;
}
