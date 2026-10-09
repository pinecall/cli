/** `pinecall deploy`: the project uploaded as a release, which Pinecall installs and runs itself. */

import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";

import { signed } from "@pinecall/agents/client";
import type { HostedApp, HostedAppList, Release, ReleaseList } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { logsOf } from "./deploy-logs.js";
import { agentFilesOfTheProject } from "./home.js";
import { languageOf } from "./language.js";
import { packed, projectFiles } from "./packed.js";
import { asked, knocked, Refused, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall deploy [--name <app>] [--note '…'] [--no-follow] [--prod]",
  "       pinecall deploy list [--json] [--prod]",
  "       pinecall deploy releases [--name <app>] [--json] [--prod]",
  "       pinecall deploy rollback <release> [--name <app>] [--prod]",
  "       pinecall deploy logs [--name <app>] [--follow] [--prod]",
  "       pinecall deploy stop | start [--name <app>] [--prod]",
  "       pinecall deploy rm [--name <app>] [--prod]",
].join("\n");

export const group: Group = {
  purpose: "run this project on Pinecall: uploaded as a release, installed and started there",
  usage: `${USAGE}

  The box runs the project the way \`pinecall start\` would, in a container of its own: it installs
  the dependencies from the lockfile, starts the agents on a token it minted for the app, and hands
  them the org's secrets (\`pinecall secrets\`) as environment variables. The release it replaces
  keeps answering until the new one's agents register, so a deploy cuts no call; one that does not
  install, exits, or registers nothing is reported with its last lines, and the one before keeps
  serving.

  What travels is every file the project's .gitignore files leave in — read where each sits, no git
  asked — never node_modules, .git, dist or any .env. The sandbox's box unless --prod.

  (none)             upload this folder as the app's next release, and follow it until it is live
  list               the org's hosted apps: the newest release, the one serving, and why one failed
  releases           one app's releases, newest first
  rollback <n>       release n's sources kept again as the next release, and followed
  logs               the last lines of the app's process, fresh from Pinecall; --follow keeps printing
  stop               the process drains and nothing runs; its releases and token stay
  start              a stopped app runs again, its newest release
  rm                 stop hosting the app: its releases go, and its token is revoked

  --name <app>       which app: this folder's name unless given (lower-case words and dashes)
  --note '…'         why, kept with the release
  --no-follow        upload and return, without waiting for it to go live
  --follow           with logs: keep printing the lines that come, until Ctrl-C

  Examples
    ~/acme-support $ pinecall deploy --prod --note "reads the order's eta back"
    acme-support: release 4 sent · 38 KB · 3b507661b052
    acme-support: the box installs and starts it; the release before keeps answering meanwhile
    acme-support: release 4 is live`,
  run,
};

/** Output streams, environment and clock overrides, for tests. */
export interface Deploying {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** How often the app is read while following, and for how long. */
  everyMs?: number;
  withinMs?: number;
  /** Ends `logs --follow`; the CLI's never does. */
  until?: () => boolean;
}

const VERBS = ["up", "list", "releases", "rollback", "logs", "stop", "start", "rm"] as const;

type Verb = (typeof VERBS)[number];

export const A_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The runner beats every five seconds, installs within five minutes and waits two for a register.
const EVERY_MS = 3000;

const WITHIN_MS = 8 * 60 * 1000;

export const NOT_A_NAME = (name: string): string =>
  `${name} is no name for an app: lower-case letters and digits joined by dashes — pass --name support`;

export const NOTHING_TO_SEND = "nothing to send: this folder holds no file a release would carry";

// Pinecall installs the project and starts it with its own `pinecall`, which serves the agent
// through the framework the project pinned.
const SERVED_BY = ["@pinecall/agents"] as const;

export const NOT_SERVABLE = (missing: readonly string[]): string =>
  `Pinecall serves this project through its own ${missing.join(" and ")}, and its package.json does not list ${missing.join(" or ")} in dependencies: npm i ${missing.join(" ")}`;

export const NOT_HOSTED = (file: string): string =>
  `Pinecall hosts TypeScript projects, and ${file} is not one: run \`pinecall start\` on a server of your own, with a server's token in PINECALL_KEY`;

const NOT_A_RELEASE = (said: string): string => `rollback ${said}: a release is its number, from \`pinecall deploy releases\``;

const NONE_YET = "Pinecall hosts no app for this org here yet: `pinecall deploy` uploads this folder as one";

const REPLACED = (ours: number, newer: number): string => `release ${ours} was replaced by release ${newer} before it went live`;

const STOPPED = (name: string): string => `${name}: stopped — its process drains; its releases and token stay`;

const STARTED = (name: string): string =>
  `${name}: started — its newest release answers once its agents register (\`pinecall deploy list\`)`;

// The runner beats every five seconds: a fresh read of an app's lines is a beat or two away.
const LOGS_EVERY_MS = 2000;

const LOGS_WITHIN_MS = 15_000;

const STILL_WAITING = (release: number, seconds: number): string =>
  `release ${release} is not live after ${seconds}s: \`pinecall deploy list\` says where it is`;

export async function run(argv: string[], how: Deploying = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const cwd = how.cwd ?? process.cwd();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      note: { type: "string", default: "" },
      json: { type: "boolean", default: false },
      "no-follow": { type: "boolean", default: false },
      follow: { type: "boolean", default: false },
    },
  });
  const [said = "up", release] = positionals;
  const verb = said as Verb;
  if (!(VERBS as readonly string[]).includes(said) || (verb === "rollback" && release === undefined)) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  const name = values.name ?? basename(cwd).toLowerCase();
  if (verb !== "list" && !A_SLUG.test(name)) {
    err.write(`${NOT_A_NAME(name)}\n`);
    return 2;
  }
  if (verb === "rollback" && !/^[1-9][0-9]*$/.test(release!)) {
    err.write(`${NOT_A_RELEASE(release!)}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err, cwd);
  if (door === undefined) return 2;
  const following = { out, everyMs: how.everyMs ?? EVERY_MS, withinMs: how.withinMs ?? WITHIN_MS };
  try {
    if (verb === "list") return listed(await asked<HostedAppList>(door, "/v1/hosted"), values.json, out);
    if (verb === "releases") return releasesOf(await asked<ReleaseList>(door, `${appPath(name)}/releases`), values.json, out);
    if (verb === "rm") {
      await knocked(door, appPath(name), { method: "DELETE" });
      out.write(`${name}: no longer hosted, its token revoked\n`);
      return 0;
    }
    if (verb === "stop" || verb === "start") {
      await knocked(door, `${appPath(name)}/${verb}`, { method: "POST" });
      out.write(`${verb === "stop" ? STOPPED(name) : STARTED(name)}\n`);
      return 0;
    }
    if (verb === "logs") {
      const pacing = { everyMs: how.everyMs ?? LOGS_EVERY_MS, withinMs: how.withinMs ?? LOGS_WITHIN_MS, until: how.until ?? (() => false) };
      return await logsOf(door, name, values.follow, pacing, out);
    }
    if (verb === "rollback") {
      const again = await asked<Release>(door, `${appPath(name)}/rollback`, { method: "POST", body: { release: Number(release) } });
      out.write(`${name}: release ${release!}'s sources sent again as release ${again.release}\n`);
      return values["no-follow"] ? 0 : await followed(door, again, following);
    }
    const foreign = agentFilesOfTheProject(cwd).find((file) => languageOf(file) !== "typescript");
    if (foreign !== undefined) {
      err.write(`${NOT_HOSTED(relative(cwd, foreign))}\n`);
      return 2;
    }
    const missing = notDependedOn(cwd);
    if (missing.length > 0) {
      err.write(`${NOT_SERVABLE(missing)}\n`);
      return 2;
    }
    const source = sourcesOf(cwd);
    if (source.length === 0) {
      err.write(`${NOTHING_TO_SEND}\n`);
      return 2;
    }
    const sent = await uploaded(door, name, source, values.note);
    out.write(`${name}: release ${sent.release} sent · ${kilobytes(sent.bytes)} · ${sent.sha256.slice(0, 12)}\n`);
    return values["no-follow"] ? 0 : await followed(door, sent, following);
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return 1;
  }
}

export function notDependedOn(cwd: string): string[] {
  const manifest = join(cwd, "package.json");
  const listed = existsSync(manifest)
    ? ((JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {})
    : {};
  return SERVED_BY.filter((name) => !(name in listed));
}

export function sourcesOf(cwd: string): Buffer {
  const files = projectFiles(cwd);
  return files.length === 0 ? Buffer.alloc(0) : packed(cwd, files);
}

// The body is the tarball itself: `knocked` sends JSON.
export async function uploaded(door: Door, name: string, source: Buffer, note: string): Promise<Release> {
  const query = note === "" ? "" : `?note=${encodeURIComponent(note.slice(0, 200))}`;
  const answered = await fetch(`${door.url.replace(/\/$/, "")}${appPath(name)}/releases${query}`, {
    method: "POST",
    headers: { ...signed(door.apiKey, door.world), "content-type": "application/gzip" },
    body: new Uint8Array(source),
  });
  if (!answered.ok) throw new Refused(answered.status, await answered.text());
  return (await answered.json()) as Release;
}

interface Following {
  out: NodeJS.WritableStream;
  everyMs: number;
  withinMs: number;
}

/** Read the app until the release is live (0), failed or replaced (1), or the time is up (1). */
async function followed(door: Door, sent: Release, following: Following): Promise<number> {
  const { out, everyMs, withinMs } = following;
  out.write(`${sent.name}: Pinecall installs and starts it; the release before keeps answering meanwhile\n`);
  const started = Date.now();
  while (Date.now() - started < withinMs) {
    const app = (await asked<HostedAppList>(door, "/v1/hosted")).apps.find((one) => one.name === sent.name);
    const said = app === undefined ? undefined : standing(app, sent.release);
    if (said !== undefined) {
      out.write(`${said.line}\n`);
      return said.code;
    }
    await new Promise((waited) => setTimeout(waited, everyMs));
  }
  out.write(`${STILL_WAITING(sent.release, Math.round(withinMs / 1000))}\n`);
  return 1;
}

export function standing(app: HostedApp, ours: number): { line: string; code: number } | undefined {
  if (app.live_release === ours) return { line: `${app.name}: release ${ours} is live`, code: 0 };
  if (app.release !== null && app.release > ours) return { line: REPLACED(ours, app.release), code: 1 };
  if (app.release === ours && app.failed_why !== null) {
    const before = app.live_release === null ? "nothing was serving before it" : `release ${app.live_release} keeps serving`;
    return { line: `${app.name}: release ${ours} failed — ${before}\n${app.failed_why}`, code: 1 };
  }
  return undefined;
}

function listed(answered: HostedAppList, asJson: boolean, out: NodeJS.WritableStream): number {
  if (asJson) out.write(`${JSON.stringify(answered)}\n`);
  else if (answered.apps.length === 0) out.write(`${NONE_YET}\n`);
  else {
    const wide = Math.max(...answered.apps.map((app) => app.name.length));
    for (const app of answered.apps) out.write(`${app.name.padEnd(wide)}  ${stateOf(app)}\n`);
  }
  return 0;
}

function stateOf(app: HostedApp): string {
  if (app.stopped) return `stopped${app.release === null ? "" : ` · newest release ${app.release}`}`;
  if (app.release === null) return "no release yet";
  const serving = app.live_release === null ? "nothing live" : `live: release ${app.live_release}`;
  if (app.failed_why !== null) return `${serving} · release ${app.release} failed: ${app.failed_why.split("\n")[0]}`;
  if (app.live_release === app.release) return serving;
  return `${serving} · release ${app.release} on its way`;
}

function releasesOf(answered: ReleaseList, asJson: boolean, out: NodeJS.WritableStream): number {
  if (asJson) out.write(`${JSON.stringify(answered)}\n`);
  for (const release of asJson ? [] : answered.releases) {
    const when = new Date(release.created_at * 1000).toISOString().slice(0, 16).replace("T", " ");
    const note = release.note === "" ? "" : `  ${release.note}`;
    out.write(`${String(release.release).padStart(4)}  ${when}  ${kilobytes(release.bytes).padStart(8)}  ${release.author}${note}\n`);
  }
  return 0;
}

export function appPath(name: string): string {
  return `/v1/hosted/${encodeURIComponent(name)}`;
}

function kilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
