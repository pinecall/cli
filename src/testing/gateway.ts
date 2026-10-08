/** HTTP client for the gateway's eval endpoints: run a suite, read runs, read a call log. */

import { type ExtractionGolden, type ExtractionRun, type ModelConfig } from "@pinecall/agents/wire";
import { type Camel } from "@pinecall/agents/wire";
import { type SessionLine } from "@pinecall/agents/wire";

import { signed, type World } from "@pinecall/agents/client";
import type { Golden } from "./goldens.js";

/** One judge's verdict on one golden. */
export interface Score {
  metric: string;
  score: number;
  passed: boolean;
  /** The judge's reasoning: seqs for a code policy, model output otherwise. */
  reason: string;
  /** The question judged, as LiveKit attaches it to each judgment. */
  criteria: string;
  /** Model calls this judgment made; zero for a code policy. */
  judge_calls: number;
}

/** One LLM request as the provider received it. */
export interface Asked {
  /** One string per static system block; empty when the vendor puts system text in `messages`. */
  system: string[];
  /** Tool JSON schemas sent with the request. */
  tools: Record<string, unknown>[];
  messages: Record<string, unknown>[];
}

/** One matrix cell: a golden under a model, its scores and call summary. */
export interface Cell {
  model: string;
  golden: string;
  scores: Score[];
  summary: Summary | null;
  /** The call's LLM requests, present only on failing cells (the prompt is not in the log).
   * Null on spoken runs, whose requests are built in the worker. */
  asked?: Asked[] | null;
}

/** `call.summary` as written to the log. */
export interface Summary {
  duration_s: number;
  turns: number;
  cost?: { usd: number };
}

/** Scores of every golden under every model. */
export interface Matrix {
  models: string[];
  goldens: string[];
  metrics: string[];
  /** Total model calls made by judges across the matrix. */
  judge_calls: number;
  runs: Cell[];
  failures: { model: string; golden: string; metric: string }[];
}

/** The call a golden opened under one model. */
export interface Opened {
  golden: string;
  model: string;
  call: string;
}

/** One stored suite run, read by `test` and `runs`. */
export interface EvalRun {
  id: string;
  agent: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "done" | "failed";
  calls: Opened[];
  matrix: Matrix | null;
  error: string | null;
}

/** Body of `POST /v1/evals/run`. */
export interface Wanted {
  agent: string;
  goldens: Golden[];
  models?: Camel<ModelConfig>[];
  app?: string;
  /** Ring 2: run the goldens as spoken calls instead of text sessions. */
  voice?: boolean;
  /** Interferer level in dB below the caller's voice (spoken runs). */
  interferer_db?: number;
  /** Fraction of caller packets dropped, 0 to 1 (spoken runs). */
  packet_loss?: number;
}

/** One call log entry from `GET /v1/calls/{call}/events`. */
export interface Entry {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  /** Call id; set on chat socket frames, optional on a single call's page. */
  call?: string | null;
}

/** Gateway URL and credentials. */
export interface Door {
  url: string;
  apiKey: string;
  /** World sent on every request; the gateway rejects a mismatch. */
  world: World;
}

/** Run and score every golden through the app holding the agent. */
export async function aRun(door: Door, wanted: Wanted): Promise<EvalRun> {
  return await asked<EvalRun>(door, "/v1/evals/run", { method: "POST", body: wanted });
}

/** Run each case through one extraction on the gateway, scored by code. */
export async function extracted(door: Door, agent: string, cases: ExtractionGolden[]): Promise<ExtractionRun> {
  return await asked<ExtractionRun>(door, `/v1/agents/${encodeURIComponent(agent)}/memory/extraction`, {
    method: "POST",
    body: { cases },
  });
}

/** Recent runs, newest first, optionally for one agent. */
export async function theRuns(door: Door, limit: number, agent?: string): Promise<EvalRun[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (agent !== undefined) query.set("agent", agent);
  const answered = await asked<{ runs: EvalRun[] }>(door, `/v1/evals/runs?${query.toString()}`);
  return answered.runs;
}

/** One run with its calls and, once finished, its matrix. */
export async function oneRun(door: Door, id: string): Promise<EvalRun> {
  return await asked<EvalRun>(door, `/v1/evals/runs/${encodeURIComponent(id)}`);
}

/** A simulated caller: goal, style and facts, plus optional voice settings and judge rules. */
export interface Persona {
  name: string;
  goal: string;
  style: string;
  facts?: Record<string, unknown>;
  llm?: string;
  tts?: string;
  voice?: string;
  accepts_when?: string;
  declines_when?: string;
}

/** One turn of a simulated call. */
export interface Spoken {
  who: "agent" | "caller";
  said: string;
}

/** The simulated caller's next line and whether it hangs up. */
export interface Improvised {
  say: string;
  hangup: boolean;
}

/** Ask the runtime (which holds the provider keys) for the simulated caller's next line. */
export async function theNextLine(
  door: Door,
  asking: { persona: Persona; heard: Spoken[]; turns_left: number },
): Promise<Improvised> {
  return await asked<Improvised>(door, "/v1/evals/caller", { method: "POST", body: asking });
}

/** Filters for reading a call log. */
export interface Narrowed {
  limit?: number;
  /** Only entries with a seq above this (a seq, not an index). */
  after?: number;
  /** Entry types to return (`types=a.b,c.d`). */
  types?: string[];
}

/** One page of a call's log. */
export async function entriesOf(door: Door, call: string, narrowed: Narrowed = {}): Promise<Entry[]> {
  const query = new URLSearchParams({
    after: String(narrowed.after ?? 0),
    limit: String(narrowed.limit ?? 500),
  });
  if (narrowed.types !== undefined) query.set("types", narrowed.types.join(","));
  const answered = await asked<{ entries: Entry[] } | null>(
    door,
    `/v1/calls/${encodeURIComponent(call)}/events?${query.toString()}`,
  );
  // 204: the call is over and the cursor has everything, so an empty page.
  return answered?.entries ?? [];
}

/** The agent's calls, newest first. */
export async function theSessions(door: Door, agent: string, limit: number): Promise<SessionLine[]> {
  const path = `/v1/agents/${encodeURIComponent(agent)}/sessions?limit=${limit}`;
  const answered = await asked<{ calls: SessionLine[] }>(door, path);
  return answered.calls;
}

/** A non-2xx gateway response. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    readonly text: string,
  ) {
    super(`the gateway answered ${status}: ${saidIn(text)}`);
  }
}

/**
 * Extract the message from a FastAPI error body (`detail`). A 422 list becomes `field: message`
 * pairs; an unparseable body is returned unchanged.
 */
export function saidIn(text: string): string {
  try {
    const said: unknown = (JSON.parse(text) as { detail?: unknown }).detail;
    if (typeof said === "string") return said;
    if (Array.isArray(said)) return said.map(oneComplaint).join("; ");
    return text;
  } catch {
    return text;
  }
}

function oneComplaint(said: unknown): string {
  const { loc, msg } = said as { loc?: unknown[]; msg?: string };
  const where = (loc ?? []).slice(1).join(".");
  return where === "" ? (msg ?? "") : `${where}: ${msg ?? ""}`;
}

// Shared fetch: signs the request and throws `Refused` with the gateway's message on non-2xx.
export async function knocked(
  door: Door,
  path: string,
  sent: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const answered = await fetch(`${door.url.replace(/\/$/, "")}${path}`, {
    method: sent.method ?? "GET",
    headers: { ...signed(door.apiKey, door.world), "content-type": "application/json" },
    ...(sent.body === undefined ? {} : { body: JSON.stringify(sent.body) }),
  });
  if (!answered.ok) throw new Refused(answered.status, await answered.text());
  return answered;
}

/** The parsed JSON response, or null for an empty body. */
export async function asked<T>(
  door: Door,
  path: string,
  sent: { method?: string; body?: unknown } = {},
): Promise<T> {
  const text = await (await knocked(door, path, sent)).text();
  return (text === "" ? null : JSON.parse(text)) as T;
}
