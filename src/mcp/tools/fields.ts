/** The fields many tools take, declared once so every schema says them in the same words. */

import { z } from "zod";

/** Which agent of the project, when it has several. */
export const AGENT = z.string().optional().describe("the agent's name; the project's only agent when left out");

/** Production instead of the sandbox; the org's switch says whether this key may. */
export const PROD = z
  .boolean()
  .optional()
  .describe("act in production instead of the sandbox; the org's own switch decides whether this key may");

/** How long a tool that runs long waits before answering what it has. */
export const WAIT_S = 25;

/** A host that waits longer than this for one tool call gives up on it. */
export const LONGEST_WAIT_S = 50;

export const WAIT = z.number().int().min(0).max(LONGEST_WAIT_S).optional().describe(`how long to wait before answering what is known so far, in seconds; ${WAIT_S} when left out`);
