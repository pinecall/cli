/** `pinecall agent`: read and write an agent's settings per corner, and manage its processes. */

import { parseArgs } from "node:util";

import { type TuningAnswer } from "@pinecall/agents/wire";

import { linesOf, readSettings } from "./agent-lines.js";
import { clear, END_OF_TURN, fraction, limitOf, NO_LANGUAGE, NOT_A_CONFIDENCE, NOT_A_LIMIT, NOT_A_TEMPERATURE, NOT_AN_END_OF_TURN, NOT_ON_OR_OFF, OPTIONS, optionsOf, set, switched, temperatureOf, type Typed } from "./agent-setting.js";
import { filesRun } from "./agent-files.js";
import { knowledgeRun } from "./agent-knowledge.js";
import { listed, stopped } from "./agent-processes.js";
import { versionsRun } from "./agent-versions.js";
import { inTheEditor, type Editor } from "./editor.js";
import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { agentOfThisDirectory, notASlug } from "./home.js";
import { NOT_A_MODEL, theModelNamed } from "./testing/models.js";
import { refusal } from "./whoami.js";

const USAGE = [
  "usage: pinecall agent [--agent <slug>] [--json]",
  "       pinecall agent list · stop <app>",
  "       pinecall agent set [--voice x] [--tts x] [--tts-model x] [--stt x] [--llm x] [--temperature n] [--language en|es|pt-BR…]",
  "                          [--llm-builds Class] [--llm-option key=value …] [--stt-builds Class] [--stt-option key=value …]",
  "                          [--tts-builds Class] [--tts-option key=value …]",
  "                          [--judge x] [--judge-builds Class] [--judge-option key=value …]",
  "                          [--greeting '…' | --greeting improvise[:'…']] [--greeting-interruptible on|off]",
  "                          [--end-of-turn stt|livekit|smart-turn]",
  "                          [--hangup '…'] [--endpointing-ms n] [--min-interruption-words n] [--record on|off]",
  "                          [--max-duration 1-60|off]",
  "                          [--eot-threshold 0.5-0.9] [--eager-eot-threshold 0.3-0.9]",
  "                          [--remember '…' …] [--forget '…' …] [--team] [--note '…']",
  "       pinecall agent knowledge [--team] · knowledge edit [--team] [--note '…']",
  "       pinecall agent clear [voice|tts|tts-model|stt|llm|temperature|llm-builds|llm-options|stt-builds|stt-options|tts-builds|tts-options",
  "                             |judge|judge-builds|judge-options",
  "                             |language|greeting|hangup|turn|memory|record|max-duration|knowledge|bases …] [--team]",
  "       pinecall agent history [--team] · diff [--against team|production] · rollback <version> [--team]",
  "       pinecall agent pull [--team] · push <file> [--team]",
].join("\n");

export const group: Group = {
  purpose: "what the org set over the class — yours, the team's, production's — setting it, and the processes that hold it",
  usage: `${USAGE}

  With nothing after it: the agent's settings as your key sees them, three corners side by side —
  your own sandbox corner, the team's, and production's — a row per field, and which version each
  corner is at. A corner that set nothing reads as what it falls back to.

  set writes a NEW version in your own corner: what you set is yours, and a colleague's next call
  does not hear it. --team writes the org's own corner instead, which every corner falls back to.
  --prod writes production's, if your org lets you act there. The whole set travels with the version it was read at, so two people
  saving at once never write over each other: the second is told where the corner is now. A model
  knob reads four ways — \`--llm anthropic/claude-haiku-5-5\`, \`--llm cartesia\` (a vendor, its own
  model), \`--llm claude-haiku-5-5\` (a model, the vendor in use), and \`--llm haiku\` (a tier, which
  is expanded here to the id its provider answers to, as \`pinecall test --model\` expands it). A
  name that means no model at all is refused rather than written. --language is the tag the voice
  and the ears are set to — \`en\`, \`es\`, \`pt-BR\` — and a blank one is refused; the prompt's
  own rules are English either way, and the agent answers in the language the caller speaks.
  --greeting sets the words said as the call opens; \`--greeting improvise\` has the model open on
  its prompt, and \`--greeting improvise:'…'\` with an instruction. The caller cannot cut the opening
  short unless --greeting-interruptible on. --hangup any lets the model end the call whenever it
  judges it done. --end-of-turn is who says the caller's turn is over: stt (the ears themselves,
  where they can), livekit or smart-turn (Smart Turn v3). --remember and --forget replace those
  lists whole. A field nobody names is left as it stands. --temperature is the model's, in its vendor's range. --llm-builds names a class of the
  vendor's plugin other than its default (\`responses.LLM\`), and --llm-option key=value one of its
  keyword arguments, repeated, the value read as JSON when it is JSON; --stt-… and --tts-… are the
  same for the ears and the voice. Those two run only on your org's own key for the vendor.
  --judge is the model this agent's calls are judged on, named as --llm is, over the org's
  (\`pinecall judging --model\`) and Pinecall's; --judge-builds and --judge-option are its plugin's,
  as --llm's are — \`--judge openai/qwen3-32b --judge-option base_url=http://gpu:8000/v1\` judges on
  a model of your own. On your org's own key for the vendor its evals are never billed.

  A field the class declares itself (@voice, @llm, @stt, a static field) says \`class\` in every
  corner: the class wins, and a set or clear of it is refused naming the class.

  knowledge is what the agent knows by heart — the business as the org describes it, in Markdown,
  read whole on every call. Alone it prints the corner's text; \`edit\` opens it in $EDITOR and
  saves what you wrote as the next version (an empty file takes it out). It is not the RAG: the
  documents a turn searches are \`pinecall docs\`, attached as \`bases\`.

  clear takes fields out of the corner's own row, so the runtime's default stands for them again;
  with no name, every field. There is no blank value.

  history, diff and rollback are the versions: every one kept, who set it and why; this corner
  against the team's or production's; one version back as the next one — with --prod, production's.
  pull prints the corner's config as JSON; push sends a file as the next version, --team to the
  team's corner.

  list prints every process holding this org's agents in the world asked — one line an app: its id,
  the agents it holds, whose corner, the machine and the address it connected from, the SDK, and
  since when. stop <app> closes that app's socket; a pinecall that hears it exits instead of
  dialling back, so its agents are free — though a supervisor (systemd, pm2) starts it again.

  Examples
    $ pinecall agent
    clinica-norte · sandbox

                    yours           team                        production
      voice         amelia          carolina                    carolina
      tts           —               —                           —
      tts model     —               —                           —
      stt           —               deepgram                    deepgram
      llm           —               anthropic/claude-haiku-5-5  anthropic/claude-haiku-5-5
      language      —               es                          es
      greeting      —               "Thanks for calling Clíni…  "Thanks for calling Clíni…
      hangup        —               when the person has what…   when the person has what…
      turn          —               —                           —
      memory        —               remember 4 · forget 1       remember 4 · forget 1
      record        —               —                           keeps the audio
      knowledge     —               2,140 chars                 2,140 chars
      bases         —               clinica-norte (k 4)         clinica-norte (k 4)

      yours: v3 · m_ana · 2026-09-19 14:32 · "flat on the phone" · team: v11 · m_bruno · 2026-09-18 10:04 · production: v11 · m_ana · 2026-09-12 …

    $ pinecall agent list --prod
    app_7  clinica-norte  the org's · web-1 (34.68.177.78) · pinecall/0.5.1 · since 2026-09-19 14:02`,
  run,
};


/** Output streams, environment and editor overrides, for tests. */
export interface Setting {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Editor for `knowledge edit`; defaults to $EDITOR. */
  editor?: Editor;
}

/** Every flag the sub-verbs take, in one table because parseArgs is strict. */

export async function run(argv: string[], how: Setting = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const llm = values.llm === undefined ? undefined : theModelNamed(values.llm);
  if (values.llm !== undefined && llm === undefined) {
    err.write(`${NOT_A_MODEL(values.llm)}\n`);
    return 2;
  }
  const judge = values.judge === undefined ? undefined : theModelNamed(values.judge);
  if (values.judge !== undefined && judge === undefined) {
    err.write(`${NOT_A_MODEL(values.judge, "--judge")}\n`);
    return 2;
  }
  // Validate before any request, so nothing is read or written.
  for (const flag of ["eot-threshold", "eager-eot-threshold"] as const) {
    const said = values[flag];
    if (said !== undefined && fraction(said) === undefined) {
      err.write(`${NOT_A_CONFIDENCE(flag, said)}\n`);
      return 2;
    }
  }
  if (values.record !== undefined && switched(values.record) === undefined) {
    err.write(`${NOT_ON_OR_OFF(values.record)}\n`);
    return 2;
  }
  if (values["max-duration"] !== undefined && limitOf(values["max-duration"]) === undefined) {
    err.write(`${NOT_A_LIMIT(values["max-duration"])}\n`);
    return 2;
  }
  if (values.language !== undefined && values.language.trim() === "") {
    err.write(`${NO_LANGUAGE}\n`);
    return 2;
  }
  const ending = values["end-of-turn"];
  if (ending !== undefined && !(END_OF_TURN as readonly string[]).includes(ending)) {
    err.write(`${NOT_AN_END_OF_TURN(ending)}\n`);
    return 2;
  }
  const interruptible = values["greeting-interruptible"];
  if (interruptible !== undefined && switched(interruptible) === undefined) {
    err.write(`--greeting-interruptible ${interruptible} is not on or off\n`);
    return 2;
  }
  if (values.temperature !== undefined && temperatureOf(values.temperature) === undefined) {
    err.write(`${NOT_A_TEMPERATURE(values.temperature)}\n`);
    return 2;
  }
  for (const stage of ["llm", "stt", "tts", "judge"] as const) {
    try {
      optionsOf(`${stage}-option`, values[`${stage}-option`]);
    } catch (refused) {
      err.write(`${(refused as Error).message}\n`);
      return 2;
    }
  }
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  const [verb, ...rest] = positionals;
  try {
    if (verb === "list") return await listed(door, out);
    if (verb === "stop") return await stopped(door, rest[0], out, err);
    const aFile = notASlug(values.agent);
    if (aFile !== undefined) {
      err.write(`${aFile}\n`);
      return 2;
    }
    const agent = values.agent ?? agentOfThisDirectory();
    if (agent === null || agent === undefined) {
      err.write(`${USAGE}\n  name the agent, or run this beside an agent file\n`);
      return 2;
    }
    if (verb === undefined) return said(agent, await readSettings(door, agent), values.json === true, out);
    if (verb === "set") {
      const named = { ...(llm === undefined ? {} : { llm }), ...(judge === undefined ? {} : { judge }) };
      return said(agent, await set(door, agent, { ...values, ...named }), values.json === true, out);
    }
    if (verb === "clear") return said(agent, await clear(door, agent, rest, values.team === true), values.json === true, out);
    if (verb === "history" || verb === "diff" || verb === "rollback") {
      return await versionsRun(door, agent, verb, rest, values, out, err);
    }
    if (verb === "pull" || verb === "push") return await filesRun(door, agent, verb, rest, values, out, err);
    if (verb === "knowledge") return await knowledgeRun(door, agent, rest[0], values, out, err, how.editor ?? inTheEditor);
  } catch (refused) {
    // The gateway's refusal message is specific; print it as-is.
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
  err.write(`${USAGE}\n`);
  return 2;
}

function said(agent: string, answer: TuningAnswer, asJson: boolean, out: NodeJS.WritableStream): number {
  out.write(asJson ? `${JSON.stringify(answer)}\n` : `${linesOf(agent, answer).join("\n")}\n`);
  return 0;
}
