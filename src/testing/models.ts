/** Resolve `--model`/`--llm` values (short name or `vendor/model`) to wire model configs. */

import { type ModelConfig } from "@pinecall/agents/wire";
import { type Camel } from "@pinecall/agents/wire";

// Short names for Anthropic tiers; the provider 404s on a bare "haiku". Other names pass through,
// and a name without a vendor defaults to Anthropic.
export const SHORT_NAMES: Record<string, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
};

/** Parse a model name into provider and model id, expanding short names. */
export function modelOf(value: string): Camel<ModelConfig> | undefined {
  if (value === "") return undefined;
  const [provider, name] = value.includes("/") ? value.split("/", 2) : ["anthropic", value];
  if (provider === "" || name === "") return undefined;
  return { provider: provider!, model: SHORT_NAMES[name!] ?? name! };
}

/**
 * The name as a settings field stores it. Short names expand to `anthropic/<id>`; anything else is
 * kept as typed, since the gateway accepts a bare vendor or a bare model.
 */
export function theModelNamed(value: string): string | undefined {
  const model = modelOf(value);
  if (model === undefined) return undefined;
  return value.includes("/") || SHORT_NAMES[value] !== undefined ? `${model.provider}/${model.model}` : value;
}

// Shared refusal for every verb taking a model (`--llm`, `--judge`), named by its flag.
export const NOT_A_MODEL = (said: string, flag = "--llm"): string =>
  `${flag} ${said} names no model: vendor/model, a vendor alone, a model alone, ` +
  `or one of ${Object.keys(SHORT_NAMES).join(" · ")}`;
