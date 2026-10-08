/** Every tool the MCP server offers, by the stage a person meets it at. */

import type { Tool } from "../tool.js";
import { agent } from "./agent.js";
import { judges, personas, simulate } from "./callers.js";
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
import { evalTool, runs, test } from "./testing.js";
import { voices, voiceSample } from "./voicing.js";
import { whoami } from "./whoami.js";

/** One stage of the journey and its tools. */
export interface Stage {
  stage: string;
  tools: readonly Tool[];
}

export const STAGES: readonly Stage[] = [
  { stage: "Getting started", tools: [whoami, login, link, project] },
  { stage: "Holding the agent, and talking to it", tools: [start, stop, status, logs, chat, prompt, consoleTool] },
  { stage: "Settings and reading", tools: [agent, calls, call, pipeline, providers, voices, voiceSample, line, numbers, carriers, callbacks, lexicon] },
  { stage: "Testing", tools: [test, runs, simulate, personas, judges, evalTool, docs, memory, remember] },
  { stage: "Going live, and the docs", tools: [deploy, docsSearch, getDoc] },
];

export const TOOLS: readonly Tool[] = STAGES.flatMap((one) => one.tools);
