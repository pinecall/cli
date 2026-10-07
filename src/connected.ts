/** The line `pinecall start` prints once the agent's socket is registered. */

import type { Door_ } from "./line.js";

export interface Connected {
  slug: string;
  url: string;
  /** How many tools it declares; absent when the gateway would not say. */
  tools?: number;
  /** The org and world that took it; absent when the gateway does not say. */
  org?: string;
  env?: string;
  /** Where the key was read from: the environment or the project's .env. */
  source?: string;
}

/**
 * The line `pinecall start` prints once registered: slug, org, world, gateway, key source, tools.
 * The org and key source are shown because a shell-exported key overrides the project's and can
 * register the agent into another org.
 */
export function connectedLine(agent: Connected): string {
  const said = [agent.slug];
  if (agent.org !== undefined) said.push(agent.org);
  if (agent.env !== undefined) said.push(agent.env);
  said.push(`connected to ${agent.url}`);
  if (agent.source !== undefined) said.push(`key from ${agent.source}`);
  if (agent.tools !== undefined) said.push(`tools ${agent.tools}`);
  return said.join(" · ");
}

/** The doors line: web (always) plus every phone line the org assigned to this agent. */
export function doorsOf(slug: string, doors: Door_[]): string {
  const its = doors.filter((one) => one.agent === slug);
  const said = its.map((one) => (one.number === null ? one.channel : `${one.channel} ${one.number}`));
  return `doors    ${["web", ...said].join(" · ")}`;
}
