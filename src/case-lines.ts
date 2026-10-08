/** What `pinecall cases` prints: the inbox one line a case, and one case whole with the commands that come next. */

import type { CaseList, EvalCase } from "./testing/cases.js";

const NOTHING = "—";

/** The inbox: how many wait, then one line a case — status, name, what broke, the world it came from, its age. */
export function inboxLines(agent: string, list: CaseList, now: number): string[] {
  const waiting = `${list.pending} waiting of at most ${list.pending_at_most}`;
  if (list.cases.length === 0) return [waiting, `${agent} has no cases here: a call a judge broke on is kept at hang-up, or \`pinecall cases keep <call> --name x\``];
  const wide = Math.max(...list.cases.map((one) => one.name.length));
  const broke = list.cases.map(brokeOf);
  const wideBroke = Math.max(...broke.map((one) => one.length));
  return [
    waiting,
    ...list.cases.map((one, at) =>
      [one.status.padEnd(9), one.name.padEnd(wide), broke[at]!.padEnd(wideBroke), one.source_env.padEnd(10), ageOf(one.created_at, now)].join("  ").trimEnd(),
    ),
  ];
}

/** One case whole: what broke and why, the caller's lines, the state, the expect, where it came from, and what to type next. */
export function caseLines(one: EvalCase): string[] {
  const golden = one.golden;
  const version = one.source_version === null ? "" : `, settings v${one.source_version}`;
  const lines = [
    `${one.name} · ${one.status} · ${one.agent}`,
    `  from ${one.source_call} (${one.source_env}${version}) · kept by ${one.author} · ${dayOf(one.created_at)}`,
    ...marks(one),
    "",
    "  broke",
    ...(one.broke.length === 0 ? [`    ${NOTHING} nothing: a person kept it from a call that held`] : one.broke.map((broken) => `    ${broken.judge}  ${broken.reason}`)),
    "  the caller",
    ...golden.input.map((line) => `    "${line}"`),
    `  state   ${JSON.stringify(golden.state ?? {})}`,
    ...(golden.events === undefined || golden.events.length === 0 ? [] : [`  events  ${JSON.stringify(golden.events)}`]),
    ...(golden.memory === undefined || golden.memory.length === 0 ? [] : [`  memory  ${JSON.stringify(golden.memory)}`]),
    ...(golden.today === undefined ? [] : [`  today   ${golden.today}`]),
    `  expect  ${JSON.stringify(golden.expect ?? {})}`,
    "",
    ...nextFor(one),
  ];
  return lines;
}

/** The judges that broke on a case, by name, or a dash. */
function brokeOf(one: EvalCase): string {
  return one.broke.length === 0 ? NOTHING : one.broke.map((broken) => broken.judge).join(", ");
}

function marks(one: EvalCase): string[] {
  const said = [
    ...(one.held_out ? ["held out: played only when a run names it"] : []),
    ...(one.kept_in_repo ? ["kept in the repository: the nightly plays the file"] : []),
    ...(one.decided_by === null ? [] : [`${one.status} by ${one.decided_by}`]),
  ];
  return said.map((line) => `  ${line}`);
}

// The commands a person types next, by where the case stands.
function nextFor(one: EvalCase): string[] {
  const play = `pinecall test --case ${one.name}`;
  const next: [string, string][] = [[play, "play it again through the agent this terminal serves"]];
  if (one.status === "pending") {
    next.push([`pinecall cases approve ${one.name}`, "the nightly plays it from now on"]);
    next.push([`pinecall cases dismiss ${one.name}`, "nothing to fix; --judge-was-wrong <judge> when the judge was"]);
  }
  if (one.status === "approved" && !one.kept_in_repo) next.push([`pinecall cases pull ${one.name}`, "a golden in the repository instead"]);
  if (one.status === "dismissed") next.push([`pinecall cases reopen ${one.name}`, "pending again"]);
  const wide = Math.max(...next.map(([command]) => command.length));
  return next.map(([command, why]) => `  ${command.padEnd(wide)}  ${why}`);
}

/** How long ago, in the largest whole unit: 40s, 12m, 3h, 2d. */
export function ageOf(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor(now - at));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function dayOf(at: number): string {
  return new Date(at * 1000).toISOString().slice(0, 16).replace("T", " ");
}
