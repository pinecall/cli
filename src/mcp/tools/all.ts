/** Every tool the MCP server offers, by the stage a person meets it at. */

import type { Tool } from "../tool.js";
import { agent } from "./agent.js";
import { judges, personas, simulate } from "./callers.js";
import { cases } from "./cases.js";
import { chat } from "./chat.js";
import { consoleTool } from "./console.js";
import { logs, start, status, stop } from "./holding.js";
import { deploy } from "./hosting.js";
import { docs, memory, remember } from "./knowing.js";
import { lexicon } from "./lexicon.js";
import { link } from "./link.js";
import { login } from "./login.js";
import { callbacks, carriers, line, numbers } from "./phone.js";
import { project } from "./project.js";
import { prompt } from "./prompt.js";
import { call, calls, pipeline, providers } from "./reading.js";
import { docsSearch, getDoc } from "./site.js";
import { supervise } from "./supervising.js";
import { monitors } from "./monitors.js";
import { telemetry } from "./telemetry.js";
import { webhook } from "./webhook.js";
import { evalTool, runs, test } from "./testing.js";
import { voices, voiceSample } from "./voicing.js";
import { whoami } from "./whoami.js";

/** One stage of the journey and its tools. */
export interface Stage {
  stage: string;
  /** Its page under docs/mcp/, every tool's parameters and a real answer. */
  page: string;
  tools: readonly Tool[];
}

export const STAGES: readonly Stage[] = [
  { stage: "Getting started", page: "getting-started", tools: [whoami, login, link, project] },
  { stage: "Holding the agent, and talking to it", page: "holding-and-talking", tools: [start, stop, status, logs, chat, prompt, consoleTool] },
  { stage: "The agent's settings", page: "settings", tools: [agent, lexicon, voices, voiceSample] },
  { stage: "Calls, and what they run on", page: "calls", tools: [calls, call, pipeline, providers, telemetry, monitors, webhook] },
  { stage: "The phone", page: "phone", tools: [line, numbers, carriers, callbacks] },
  { stage: "Supervising a live call", page: "supervising", tools: [supervise] },
  { stage: "Testing", page: "testing", tools: [test, runs, cases, simulate, personas, judges, evalTool] },
  { stage: "Knowledge and memory", page: "knowledge-and-memory", tools: [docs, memory, remember] },
  { stage: "Going live, and the docs", page: "going-live", tools: [deploy, docsSearch, getDoc] },
];

export const TOOLS: readonly Tool[] = STAGES.flatMap((one) => one.tools);
