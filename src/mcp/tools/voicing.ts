/** The voice tools: a vendor's `voices`, and a `voice_sample` said by the gateway and saved as a file. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { catalogue, defaultVoice, sampled, voicesOf } from "../../voice-sample.js";
import { tool } from "../tool.js";

export const voices = tool({
  name: "voices",
  description: "A voice vendor's voices in a language: the id an agent's voice setting takes, the name, gender and accent.",
  schema: {
    tts: z.string().optional().describe("the vendor; the gateway's own voice vendor when left out"),
    language: z.string().optional().describe("a language tag: en, es, pt-BR…"),
    country: z.string().optional().describe("only voices from this country: ES, MX, US…"),
  },
  manual: "`voices` lists the voices to choose from, the id first; set one with `agent` (`settings.voice`, and `settings.tts` for its vendor). `voice_sample` lets the person hear one first.",
  handler: async (args, session) => ({ voices: await voicesOf(await session.door(), args) }),
});

export const voiceSample = tool({
  name: "voice_sample",
  description: "Have the gateway say a line in a voice, as a call would, and save it as a WAV the person can play; with how long the vendor took.",
  schema: {
    voice: z.string().describe("the voice's id, from `voices`"),
    text: z.string().optional().describe("the words; the gateway's own line in the language when left out"),
    tts: z.string().optional().describe("the vendor; the gateway's own voice vendor when left out"),
    model: z.string().optional().describe("the vendor's model"),
    language: z.string().optional().describe("a language tag"),
  },
  manual: "`voice_sample` says a line through the vendor's own plugin and saves the WAV under the project's `.pinecall/voices/`: this server plays nothing, so the answer is the file's path, for the person to open, with the first-audio and whole-sentence times.",
  handler: async (args, session) => {
    const door = await session.door();
    const tts = args.tts ?? defaultVoice(await catalogue(door));
    const said = await sampled(door, { tts, voice: args.voice, model: args.model ?? null, language: args.language ?? null, text: args.text ?? null });
    const folder = join(await session.project(), ".pinecall", "voices");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${args.voice.replace(/[^A-Za-z0-9_-]/g, "_")}.wav`);
    writeFileSync(file, said.wav);
    return { file, tts, first_audio_ms: said.firstAudioMs, whole_sentence_ms: said.totalMs };
  },
});
