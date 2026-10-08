/** A stream a CLI core writes its lines to, kept as text for a tool's answer: never this process's stdout. */

import { Writable } from "node:stream";

/** A writable that keeps what it was given. */
export function collected(): { stream: NodeJS.WritableStream; lines(): string[] } {
  let text = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      text += chunk.toString();
      done();
    },
  });
  return { stream, lines: () => text.split("\n").filter((line) => line.trim() !== "") };
}
