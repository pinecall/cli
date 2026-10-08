/** `pinecall voices`: list a TTS vendor's voices, or play a sample of one locally. */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { type VoiceSample, VoicesListedSchema } from "@pinecall/agents/wire";

import { theDoor } from "./env.js";
import type { Group } from "./groups.js";
import { aPlayerFor } from "./players.js";
import { asColumns } from "./providers.js";
import { asked, knocked, type Door } from "./testing/gateway.js";
import { refusal } from "./whoami.js";

const USAGE = `usage: pinecall voices [--tts <vendor>] [--language es] [--country ES]
       pinecall voices play <voice> ["the words"] [--tts <vendor>] [--model <model>] [--language es] [--save file.wav]`;

/** The catalogue as this verb reads it: Pinecall's vendor per stage, and who lists its voices. */
interface Catalogue {
  providers: { name: string; voices_listed: boolean }[];
  defaults: Record<string, string>;
}

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

/** Result of playing a file: the player used, or why it failed. */
export type Played = { player: string } | { failed: string };

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
    if (playing) return await play(door, parsed as PlayArgs, how.play ?? aSpeaker, out, err);
    return await list(door, parsed as ListArgs, out, err);
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

async function list(door: Door, args: ListArgs, out: NodeJS.WritableStream, err: NodeJS.WritableStream): Promise<number> {
  const catalogue = await asked<Catalogue>(door, "/v1/providers");
  const vendor = args.tts ?? theBoxVoice(catalogue);
  const listing = catalogue.providers.filter((one) => one.voices_listed).map((one) => one.name);
  if (catalogue.providers.some((one) => one.name === vendor) && !listing.includes(vendor)) {
    err.write(`${notListed(vendor, listing)}\n`);
    return 1;
  }
  const query = new URLSearchParams({ tts: vendor });
  if (args.language !== undefined) query.set("language", args.language);
  // Validate, so a non-list 200 (a proxy page, an older gateway) fails instead of reading as empty.
  const listed = VoicesListedSchema.parse(await asked<unknown>(door, `/v1/voices?${query}`));
  const country = args.country?.toUpperCase();
  const voices = listed.voices.filter((voice) => country === undefined || voice.country === country);
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
    tts: args.tts ?? theBoxVoice(await asked<Catalogue>(door, "/v1/providers")),
    voice: args.voice,
    model: args.model ?? null,
    language: args.language ?? null,
    text: args.text ?? null,
  };
  const said = await aSample(door, body);
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

// The box's own voice: what an agent that names no vendor speaks with.
function theBoxVoice(catalogue: Catalogue): string {
  const vendor = catalogue.defaults["tts"];
  if (vendor === undefined) throw new Error("this box names no voice of its own: name one with --tts <vendor>");
  return vendor;
}

/** What a vendor whose plugin lists no voices is told, with the vendors that list theirs. */
export function notListed(vendor: string, listing: string[]): string {
  const others = listing.length === 0 ? "no vendor of this box lists its voices" : `these list theirs: ${listing.join(", ")} (--tts <vendor>)`;
  return `${vendor} lists no voices: its voice is the vendor's own id, set as it is — ${others}`;
}

/** A synthesized sample and its Server-Timing durations. */
export interface Said {
  wav: Uint8Array;
  firstAudioMs: number | null;
  totalMs: number | null;
}

// The response body is the WAV itself, not JSON.
async function aSample(door: Door, body: VoiceSample): Promise<Said> {
  const answered = await knocked(door, "/v1/voices/sample", { method: "POST", body });
  const timing = answered.headers.get("server-timing") ?? "";
  return {
    wav: new Uint8Array(await answered.arrayBuffer()),
    firstAudioMs: aDuration(timing, "first-audio"),
    totalMs: aDuration(timing, "total"),
  };
}

const DURATIONS = {
  "first-audio": /(?:^|,)\s*first-audio;dur=([0-9.]+)/,
  total: /(?:^|,)\s*total;dur=([0-9.]+)/,
};

/** Extract a metric's `dur` from a Server-Timing header, or null. */
export function aDuration(header: string, metric: keyof typeof DURATIONS): number | null {
  const found = DURATIONS[metric].exec(header);
  return found === null ? null : Number(found[1]);
}

/** Play the file with the first available local player. */
function aSpeaker(file: string): Played {
  const player = aPlayerFor("file");
  if (player === null) return { failed: "no player on this machine (afplay, ffplay, play, aplay or pw-play)" };
  const ran = spawnSync(player.name, [...player.file, file], { stdio: "ignore" });
  if (ran.error !== undefined) return { failed: `${player.name} could not start (${ran.error.message})` };
  if (ran.status !== 0) return { failed: `${player.name} could not play it (exit ${ran.status ?? "?"})` };
  return { player: player.name };
}
