/** `pinecall voices`: list a TTS vendor's voices, or play a sample of one locally. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { VoiceSample } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { playedHere, type Played } from "./players.js";
import { asColumns } from "./providers.js";
import type { Door } from "./testing/gateway.js";
import { catalogue, defaultVoice, sampled, voicesOf } from "./voice-sample.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall voices [--tts <vendor>] [--language es] [--country ES]
       pinecall voices play <voice> ["the words"] [--tts <vendor>] [--model <model>] [--language es] [--save file.wav]`;

export const group: Group = {
  purpose: "a voice vendor's voices, and any one of them heard on this machine before it is chosen",
  usage: `${USAGE}

  The vendor is --tts, or Pinecall's own voice when none is named (\`pinecall providers\` says which).

  With nothing after it: the vendor's voices in that language, one per line — the id the agent's
  voice setting takes, the name, gender, and where the accent is from (ES is Spain, MX Mexico), so
  a Spanish agent that should sound like Madrid is not given a voice from Monterrey. --country
  keeps only the voices from there. A vendor whose plugin lists no voices takes its own ids as
  they are: the line says so and names the vendors that list theirs.

  play says the words in that voice, through the vendor's own plugin exactly as a call would, and
  plays them here — afplay, ffplay, play, aplay or pw-play, whichever this machine has — with how
  long the vendor took to start and to finish. With no words, the gateway reads one line in the
  language. It runs on the org's own key for the vendor when it brought one (pinecall providers
  add), and on Pinecall's otherwise. --save keeps the WAV where you say.

  The voice it plays is chosen with pinecall agent set --tts <vendor> --tts-model <model> --voice
  <id>: the model you tried with --model is not kept unless --tts-model says it too.`,
  run,
};

/** Stream, environment and player overrides, for tests. */
export interface Choosing {
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Plays a WAV file; defaults to the local audio player. */
  play?: (file: string) => Played;
}

/** Run `list` (default) or `play`. */
export async function run(argv: string[], how: Choosing = {}): Promise<number> {
  const out = how.out ?? process.stdout;
  const err = how.err ?? process.stderr;
  const door = await theDoor(how.env ?? process.env, err);
  if (door === undefined) return 2;
  // Parsed outside the try so an unknown flag exits 2 via the dispatcher, not as a gateway refusal.
  const playing = argv[0] === "play";
  const parsed = playing ? aPlayParse(argv.slice(1)) : aListParse(argv);
  try {
    if (playing) return await play(door, parsed as PlayArgs, how.play ?? playedHere, out, err);
    return await list(door, parsed as ListArgs, out);
  } catch (refused) {
    err.write(`${refusal(refused)}\n`);
    return 1;
  }
}

type ListArgs = { tts?: string; language?: string; country?: string };
type PlayArgs = { voice?: string; text?: string; extra?: string; tts?: string; model?: string; language?: string; save?: string };

function aListParse(argv: string[]): ListArgs {
  return parseArgs({
    args: argv,
    options: { tts: { type: "string" }, language: { type: "string" }, country: { type: "string" } },
  }).values;
}

function aPlayParse(argv: string[]): PlayArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { tts: { type: "string" }, model: { type: "string" }, language: { type: "string" }, save: { type: "string" } },
  });
  const [voice, text, extra] = positionals;
  return { ...values, ...(voice === undefined ? {} : { voice }), ...(text === undefined ? {} : { text }), ...(extra === undefined ? {} : { extra }) };
}

async function list(door: Door, args: ListArgs, out: NodeJS.WritableStream): Promise<number> {
  const voices = await voicesOf(door, args);
  if (voices.length === 0) {
    out.write("no voice matches: try another --language or --country\n");
    return 0;
  }
  const rows = voices.map((voice) => [voice.id, voice.name, voice.gender, [voice.country, voice.accent].filter((word) => word !== "").join(" ")]);
  for (const line of asColumns(rows)) out.write(`${line}\n`);
  return 0;
}

async function play(door: Door, args: PlayArgs, speaker: (file: string) => Played, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  if (args.voice === undefined || args.extra !== undefined) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  // Without text the gateway picks a sample line in the language.
  const body: VoiceSample = {
    tts: args.tts ?? defaultVoice(await catalogue(door)),
    voice: args.voice,
    model: args.model ?? null,
    language: args.language ?? null,
    text: args.text ?? null,
  };
  const said = await sampled(door, body);
  const kept = args.save === undefined ? null : resolve(args.save);
  const file = kept ?? join(mkdtempSync(join(tmpdir(), "pinecall-voice-")), "sample.wav");
  writeFileSync(file, said.wav);
  const played = speaker(file);
  const wait = said.firstAudioMs === null ? "—" : `${said.firstAudioMs} ms`;
  const whole = said.totalMs === null ? "—" : `${said.totalMs} ms`;
  if ("failed" in played) {
    err.write(`${played.failed}: the sample is ${file}\n`);
    return 1;
  }
  if (kept === null) rmSync(file, { force: true });
  out.write(`${args.voice} · first audio ${wait} · whole sentence ${whole} · ${played.player}${kept === null ? "" : ` · saved ${kept}`}\n`);
  return 0;
}

export type { Played };
