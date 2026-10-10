/** A judge as the command line writes it and as the terminal reads it: its flags, its table, what a try answered. */

import type { JudgeList, JudgeRequest, JudgeRow, JudgeTried } from "@pinecall/agents/wire";

import { answerOf } from "./testing/score.js";

/** Whose judges: the org's (null), or one agent's by its slug. */
export type Whose = string | null;

/** The flags that write a judge, as typed. */
export interface Asking {
  asks?: string | undefined;
  answer?: string | undefined;
  when?: string | undefined;
  reads?: string | undefined;
}

// Mirrors the gateway's name rule so a bad name gets a readable error.
const A_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const READS = ["prompt", "evidence", "facts"] as const;

const CHOICE = "choice:";
const TRIGGER = "trigger:";

export const NAME_SHAPE = (name: string): string =>
  `${name} is no name for a judge: lower-case letters and digits joined by hyphens — offers-next-slot`;

export const NO_QUESTION = "a judge needs --asks: the one sentence the judge model answers about the call";

const NOT_AN_ANSWER = (said: string): string =>
  `--answer ${said}: verdict (held or broken), score (1 to 5), or choice:a,b,c (two choices at least)`;

const NOT_WHEN = (said: string): string =>
  `--when ${said}: always, simulations, or trigger:'…' (a yes-or-no asked first; a no is N/A)`;

const NOT_READ = (said: string): string => `--reads ${said}: any of ${READS.join(", ")}, comma-separated`;

/** Why a judge's name is refused, or undefined. */
export function nameRefused(name: string): string | undefined {
  return A_NAME.test(name) ? undefined : NAME_SHAPE(name);
}

/** The body that writes a judge of one's own whole; throws the sentence a flag is refused with. */
export function judgeRequestOf(flags: Asking): JudgeRequest {
  const question = flags.asks?.trim() ?? "";
  if (question === "") throw new Error(NO_QUESTION);
  return { question, ...answered(flags.answer), ...when(flags.when), ...reads(flags.reads) };
}

function answered(said: string | undefined): Pick<JudgeRequest, "answer" | "choices"> {
  if (said === undefined || said === "verdict") return { answer: "verdict" };
  if (said === "score") return { answer: "score" };
  if (said.startsWith(CHOICE)) {
    const choices = said.slice(CHOICE.length).split(",").map((one) => one.trim()).filter((one) => one !== "");
    if (choices.length >= 2) return { answer: "choice", choices };
  }
  throw new Error(NOT_AN_ANSWER(said));
}

function when(said: string | undefined): Pick<JudgeRequest, "when" | "trigger"> {
  if (said === undefined || said === "always") return { when: "always" };
  if (said === "simulations") return { when: "simulations" };
  if (said.startsWith(TRIGGER) && said.slice(TRIGGER.length).trim() !== "") {
    return { when: "trigger", trigger: said.slice(TRIGGER.length).trim() };
  }
  throw new Error(NOT_WHEN(said));
}

function reads(said: string | undefined): Pick<JudgeRequest, "reads"> {
  if (said === undefined) return {};
  const named = said.split(",").map((one) => one.trim()).filter((one) => one !== "");
  const wrong = named.find((one) => !(READS as readonly string[]).includes(one));
  if (wrong !== undefined) throw new Error(NOT_READ(wrong));
  return { reads: named as (typeof READS)[number][] };
}

/** The door of a list of judges, or of one judge in it. */
export function judgesPath(whose: Whose, name?: string): string {
  const list = whose === null ? "/v1/org/judges" : `/v1/agents/${encodeURIComponent(whose)}/judges`;
  return `${list}${name === undefined ? "" : `/${encodeURIComponent(name)}`}`;
}

/** One line per judge: name, whose, on or off, how it answers, when it runs, and what it holds a call to. */
export function tableOf(list: JudgeList): string[] {
  const rows = list.judges;
  const cells = rows.map((row) => [row.name, row.owner, row.on ? "on" : "off", answerLabel(row), whenLabel(row), textOf(row)]);
  const widths = [0, 1, 2, 3, 4].map((at) => Math.max(...cells.map((cell) => cell[at]!.length)));
  return cells.map((cell) => cell.map((text, at) => (at < widths.length ? text.padEnd(widths[at]!) : text)).join("  ").trimEnd());
}

function answerLabel(row: JudgeRow): string {
  if (row.answer === "choice") return `choice: ${row.choices.join("|")}`;
  return row.answer === "score" ? "score 1-5" : "verdict";
}

function whenLabel(row: JudgeRow): string {
  return row.when === "trigger" ? "on a trigger" : row.when;
}

// The library's summary is a line; an own judge's question is what it asks.
function textOf(row: JudgeRow): string {
  return row.owner === "pinecall" ? (row.summary ?? row.question) : row.question;
}

/** What a try answered: a line per call, then the evals and their cost. */
export function triedLines(tried: JudgeTried): string[] {
  const wide = Math.max(0, ...tried.rows.map((row) => row.call.length));
  const lines = tried.rows.map((row) => {
    if (row.judgment === null) return `${row.call.padEnd(wide)}  · not judged: ${row.not_judged ?? "nothing said why"}`;
    return `${row.call.padEnd(wide)}  ${answerOf(row.judgment)}`;
  });
  return [...lines, `${tried.evals} eval${tried.evals === 1 ? "" : "s"} · $${tried.cost_usd.toFixed(4)} · nothing was written`];
}
