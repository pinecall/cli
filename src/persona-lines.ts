/** Formatting for `pinecall personas`: the table, a single persona, and fact parsing. */

import type { Persona } from "./testing/personas.js";

// No facts is valid: the persona is told to state nothing about themselves.
const NO_FACTS = "(no facts: this caller may state nothing about themselves)";

// Unset model/voice means the runtime picks them.
const THE_RUNTIMES = "the runtime's";

// The `persona` judge runs only when a rule is set.
const NO_RULE = "(no rule: no `persona` judge runs on this caller's calls)";

const FACT_SHAPE = "a fact is what=said: --fact 'their phone=305 555 0101'";

/** Parse repeated `--fact 'what=said'` flags into a map. */
export function theFacts(said: string[]): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const one of said) {
    const at = one.indexOf("=");
    if (at <= 0) throw new Error(FACT_SHAPE);
    facts[one.slice(0, at).trim()] = one.slice(at + 1).trim();
  }
  return facts;
}

/** Lines printed by `show`: goal, style, models, rule and facts. */
export function linesOf(persona: Persona): string[] {
  const facts = Object.entries(persona.facts);
  const rule = [
    ...(persona.accepts_when === "" ? [] : [`  accepts when: ${persona.accepts_when}`]),
    ...(persona.declines_when === "" ? [] : [`  declines when: ${persona.declines_when}`]),
  ];
  return [
    `${persona.name} · ${persona.goal}`,
    ...(persona.about === "" ? [] : [`  ${persona.about}`]),
    `  ${persona.style}`,
    `  played by ${persona.llm ?? THE_RUNTIMES} · read by ${persona.tts ?? THE_RUNTIMES} · voice ${persona.voice ?? THE_RUNTIMES}`,
    ...(rule.length === 0 ? [`  ${NO_RULE}`] : rule),
    ...(facts.length === 0 ? [`  ${NO_FACTS}`] : facts.map(([what, said]) => `  ${what}: ${said}`)),
  ];
}

// Column widths are measured from the content, not fixed.
export function asATable(personas: Persona[]): string[] {
  const name = Math.max(...personas.map((one) => one.name.length));
  const style = Math.max(...personas.map((one) => one.style.length));
  return personas.map((one) => `${one.name.padEnd(name)}  ${one.style.padEnd(style)}  ${one.goal}`);
}
