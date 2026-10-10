/** `pinecall judging`: whether this org's calls are judged at hang-up, and the model they are judged on. */

import { parseArgs } from "node:util";

import type { ModelConfig } from "@pinecall/agents/wire";

import { optionsOf } from "./agent-setting.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { asked, type Door } from "./testing/gateway.js";
import { SHORT_NAMES } from "./testing/models.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall judging                                          whether calls are judged, and on what
       pinecall judging [on|off] [--model <vendor/model> [--option key=value …] | --platform]`;

const PATH = "/v1/org/judging";

export const group: Group = {
  purpose: "whether this org's calls are judged at hang-up, and the model the judges run on: Pinecall's, or one of yours",
  usage: `${USAGE}

  Every finished call of the org is judged at hang-up unless judging is off. The judges run on
  Pinecall's judge model, and each judge that answers is one eval on your bill — unless you name a
  model of your own: --model is the model every agent's calls are judged on (an agent's own
  \`pinecall agent set --judge\` wins over it), tried on your org's keys before it is kept. On your
  org's own key for its vendor (\`pinecall providers add\`) the model's bill is yours and its evals
  are never billed; a local model is your vendor's plugin pointed at your server, --option
  base_url=… — the options run on your own key alone. On a key Pinecall lends, the evals are
  billed as on Pinecall's. --platform goes back to Pinecall's model. The judge is asked for a
  tool call, so the model must call tools.

  on|off           judging on or off for every agent, from the next call; the model is kept
  --model x        vendor/model, or haiku · sonnet · opus
  --option k=v     one keyword argument of the model's plugin, repeated; the value read as JSON
  --platform       Pinecall's judge model again

  Examples
    $ pinecall judging
    judging on · Pinecall's judge model · evals billed · ceiling $0.05 a call

    $ pinecall judging --model openai/qwen3-32b --option base_url=http://gpu.internal:8000/v1
    judging on · openai/qwen3-32b · base_url="http://gpu.internal:8000/v1" · your own openai key: evals not billed`,
  run,
};

/** Test overrides: streams and environment. */
export interface Deciding {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

/** GET and PUT /v1/org/judging, as the gateway answers them. */
interface Judging {
  on: boolean;
  ceiling_usd: number | null;
  model?: ModelConfig | null;
}

const NOT_A_JUDGE_MODEL = (said: string): string =>
  `--model ${said} names no model: vendor/model, or one of ${Object.keys(SHORT_NAMES).join(" · ")}`;

const ONE_MODEL = "--model names one of yours and --platform Pinecall's: one of them";

const OPTIONS_NEED_A_MODEL = "--option is the plugin's of a model of yours: name it with --model";

export async function run(argv: string[], how: Deciding = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      option: { type: "string", multiple: true },
      platform: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const [verb, ...rest] = positionals;
  if (rest.length > 0 || (verb !== undefined && verb !== "on" && verb !== "off")) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  let model: ModelConfig | null | undefined;
  try {
    model = modelWanted(values.model, values.option, values.platform);
  } catch (refused) {
    err.write(`${(refused as Error).message}\n`);
    return 2;
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  try {
    const standing = await asked<Judging>(door, PATH);
    const changes = verb !== undefined || model !== undefined;
    const now = changes
      ? await asked<Judging>(door, PATH, { method: "PUT", body: wanted(standing, verb, model) })
      : standing;
    out.write(values.json ? `${JSON.stringify(now)}\n` : `${await described(door, now)}\n`);
    return 0;
  } catch (failed) {
    err.write(`${refusal(failed)}\n`);
    return 1;
  }
}

/** The model a command line names: one of yours, null for Pinecall's, undefined when it names none. */
function modelWanted(said: string | undefined, options: string[] | undefined, platform: boolean | undefined): ModelConfig | null | undefined {
  if (platform === true && said !== undefined) throw new Error(ONE_MODEL);
  if (platform === true) return null;
  if (said === undefined) {
    if (options !== undefined) throw new Error(OPTIONS_NEED_A_MODEL);
    return undefined;
  }
  const named = modelNamed(said);
  if (named === undefined) throw new Error(NOT_A_JUDGE_MODEL(said));
  const kwargs = optionsOf("option", options);
  return kwargs === undefined ? named : { ...named, options: kwargs };
}

// The model id keeps every slash after the vendor's: `livekit/openai/gpt-5-mini`.
function modelNamed(said: string): ModelConfig | undefined {
  const tier = SHORT_NAMES[said];
  if (tier !== undefined) return { provider: "anthropic", model: tier };
  const slash = said.indexOf("/");
  if (slash <= 0 || slash === said.length - 1) return undefined;
  return { provider: said.slice(0, slash), model: said.slice(slash + 1) };
}

// The door takes the whole: what is not changed travels as it stands.
function wanted(standing: Judging, verb: string | undefined, model: ModelConfig | null | undefined): { on: boolean; model?: ModelConfig } {
  const on = verb === undefined ? standing.on : verb === "on";
  const kept = model === undefined ? (standing.model ?? null) : model;
  return kept === null ? { on } : { on, model: kept };
}

async function described(door: Door, judging: Judging): Promise<string> {
  const said = [judging.on ? "judging on" : "judging off — no call is judged at hang-up"];
  const model = judging.model ?? null;
  const ceiling = judging.ceiling_usd === null ? "" : ` · ceiling $${judging.ceiling_usd.toFixed(2)} a call`;
  if (model === null) return [...said, `Pinecall's judge model · evals billed${ceiling}`].join(" · ");
  said.push(`${model.provider}/${model.model}`);
  const options = Object.entries(model.options ?? {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  if (options.length > 0) said.push(options.join(" · "));
  const brought = await asked<{ vendors: string[] }>(door, "/v1/provider-keys");
  const own = brought.vendors.includes(model.provider);
  said.push(own ? `your own ${model.provider} key: evals not billed` : `${model.provider} on a key Pinecall lends: evals billed${ceiling}`);
  return said.join(" · ");
}
