/** Known command-line audio players, the first one on PATH, and a file played on it: the one place audio is played. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * An audio player's arguments for raw 16-bit PCM on stdin (`--listen`) and for a file
 * (`voices play`). `raw` is null for players that only open files, such as `afplay`.
 */
export interface Player {
  name: string;
  raw: ((rate: number, channels: number) => string[]) | null;
  file: string[];
}

export const PLAYERS: readonly Player[] = [
  { name: "afplay", raw: null, file: [] },
  {
    name: "ffplay",
    raw: (rate, channels) => ["-hide_banner", "-loglevel", "error", "-nodisp", "-autoexit", "-f", "s16le", "-ar", String(rate), "-ac", String(channels), "-i", "-"],
    file: ["-hide_banner", "-loglevel", "error", "-nodisp", "-autoexit"],
  },
  { name: "play", raw: (rate, channels) => ["-q", "-t", "raw", "-r", String(rate), "-e", "signed", "-b", "16", "-c", String(channels), "-"], file: ["-q"] },
  { name: "aplay", raw: (rate, channels) => ["-q", "-f", "S16_LE", "-r", String(rate), "-c", String(channels), "-"], file: ["-q"] },
  { name: "pw-play", raw: (rate, channels) => [`--format=s16`, `--rate=${rate}`, `--channels=${channels}`, "-"], file: [] },
];

/** The first player on PATH that supports the given mode, or null. */
export function aPlayerFor(way: "raw" | "file"): Player | null {
  return PLAYERS.find((one) => (way === "file" || one.raw !== null) && onThePath(one.name)) ?? null;
}

/** Whether an executable with this name exists on PATH, without spawning it. */
export function onThePath(name: string): boolean {
  // Skip empty PATH segments, which would resolve to the cwd.
  return (process.env["PATH"] ?? "").split(delimiter).some((where) => where !== "" && existsSync(join(where, name)));
}

/** Result of playing a file: the player used, or why it failed. */
export type Played = { player: string } | { failed: string };

/** Play the file with the first available local player. */
export function playedHere(file: string): Played {
  const player = aPlayerFor("file");
  if (player === null) return { failed: "no player on this machine (afplay, ffplay, play, aplay or pw-play)" };
  const ran = spawnSync(player.name, [...player.file, file], { stdio: "ignore" });
  if (ran.error !== undefined) return { failed: `${player.name} could not start (${ran.error.message})` };
  if (ran.status !== 0) return { failed: `${player.name} could not play it (exit ${ran.status ?? "?"})` };
  return { player: player.name };
}
