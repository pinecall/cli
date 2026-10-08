/** A vendor's voices as data: the catalogue, the voices in a language, and one sample said by the gateway with its timings. */

import { type VoiceSample, VoicesListedSchema } from "@pinecall/agents/wire";

import { asked, knocked, type Door } from "./testing/gateway.js";

/** The catalogue as the voices read it: the gateway's vendor per stage, and who lists its voices. */
export interface Catalogue {
  providers: { name: string; voices_listed: boolean }[];
  defaults: Record<string, string>;
}

/** One voice of a vendor, as a person picks it. */
export interface Voice {
  id: string;
  name: string;
  gender: string;
  country: string;
  accent: string;
}

/** A synthesized sample and its Server-Timing durations. */
export interface Said {
  wav: Uint8Array;
  firstAudioMs: number | null;
  totalMs: number | null;
}

/** The catalogue the gateway answers with. */
export async function catalogue(door: Door): Promise<Catalogue> {
  return await asked<Catalogue>(door, "/v1/providers");
}

/** The gateway's own voice: what an agent that names no vendor speaks with. */
export function defaultVoice(listed: Catalogue): string {
  const vendor = listed.defaults["tts"];
  if (vendor === undefined) throw new Error("this gateway names no voice of its own: name one with --tts <vendor>");
  return vendor;
}

/** What a vendor whose plugin lists no voices is told, with the vendors that list theirs. */
export function notListed(vendor: string, listing: string[]): string {
  const others = listing.length === 0 ? "no vendor of this gateway lists its voices" : `these list theirs: ${listing.join(", ")} (--tts <vendor>)`;
  return `${vendor} lists no voices: its voice is the vendor's own id, set as it is — ${others}`;
}

/** The vendor's voices in a language, from one country when it is named; throws for a vendor that lists none. */
export async function voicesOf(door: Door, asking: { tts?: string | undefined; language?: string | undefined; country?: string | undefined }): Promise<Voice[]> {
  const listed = await catalogue(door);
  const vendor = asking.tts ?? defaultVoice(listed);
  const listing = listed.providers.filter((one) => one.voices_listed).map((one) => one.name);
  if (listed.providers.some((one) => one.name === vendor) && !listing.includes(vendor)) throw new Error(notListed(vendor, listing));
  const query = new URLSearchParams({ tts: vendor });
  if (asking.language !== undefined) query.set("language", asking.language);
  // Validate, so a non-list 200 (a proxy page, an older gateway) fails instead of reading as empty.
  const voices = VoicesListedSchema.parse(await asked<unknown>(door, `/v1/voices?${query}`)).voices;
  const country = asking.country?.toUpperCase();
  return voices.filter((voice) => country === undefined || voice.country === country);
}

// The response body is the WAV itself, not JSON.
/** The words said in the voice through the vendor's own plugin, as a call would, with how long it took. */
export async function sampled(door: Door, body: VoiceSample): Promise<Said> {
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
