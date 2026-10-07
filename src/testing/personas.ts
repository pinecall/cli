/** An agent's personas stored on the gateway: list, write, delete. */

import { asked, type Door } from "./gateway.js";

/** A stored persona. */
export interface Persona {
  name: string;
  about: string;
  goal: string;
  style: string;
  facts: Record<string, string>;
  state: Record<string, unknown>;
  /** Models and voice used to play the caller; null uses the runtime default. */
  llm: string | null;
  tts: string | null;
  voice: string | null;
  /** When the caller hangs up satisfied or not; read by the `persona` judge. */
  accepts_when: string;
  declines_when: string;
  author: string;
  set_at: number;
}

/** Body of a persona write; `was` is the old name on a rename. */
export interface Written {
  about?: string;
  goal: string;
  style: string;
  facts?: Record<string, string>;
  state?: Record<string, unknown>;
  llm?: string | null;
  tts?: string | null;
  voice?: string | null;
  accepts_when?: string;
  declines_when?: string;
  was?: string;
}

/** Error message for an unknown persona name. */
export const NOBODY = (name: string, agent: string): string =>
  `no persona called ${name} for ${agent}: \`pinecall personas add ${name} --goal '…' --style '…'\`, or the console's Personas`;

// A persona is one agent's: every door is under the agent.
const door = (agent: string, name?: string): string =>
  `/v1/agents/${encodeURIComponent(agent)}/personas${name === undefined ? "" : `/${encodeURIComponent(name)}`}`;

/** Every persona of the agent. */
export async function personasOf(gateway: Door, agent: string): Promise<Persona[]> {
  return (await asked<{ personas: Persona[] }>(gateway, door(agent))).personas;
}

/** One of the agent's personas by name, or undefined. */
export async function personaNamed(gateway: Door, agent: string, name: string): Promise<Persona | undefined> {
  return (await personasOf(gateway, agent)).find((one) => one.name === name);
}

/** Create, replace or rename one of the agent's personas; returns its updated list. */
export async function writePersona(gateway: Door, agent: string, name: string, written: Written): Promise<Persona[]> {
  return (await asked<{ personas: Persona[] }>(gateway, door(agent, name), { method: "PUT", body: written })).personas;
}

/** Delete one of the agent's personas; returns its updated list. */
export async function dropPersona(gateway: Door, agent: string, name: string): Promise<Persona[]> {
  return (await asked<{ personas: Persona[] }>(gateway, door(agent, name), { method: "DELETE" })).personas;
}
