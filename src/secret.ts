/** Terminal input: a secret without echo, or a line of stdin. */

import { createInterface } from "node:readline";

/**
 * Read one line without echoing it, so a key never lands in the scrollback.
 * Mutes readline by overriding its `_writeToOutput` rather than using raw mode.
 */
export async function typedInSilence(prompt: string, out: NodeJS.WritableStream): Promise<string> {
  const reading = createInterface({ input: process.stdin, output: out, terminal: true });
  (reading as unknown as { _writeToOutput(text: string): void })._writeToOutput = () => {};
  out.write(prompt);
  const secret = await new Promise<string>((typed) => reading.question("", typed));
  reading.close();
  out.write("\n");
  return secret;
}

/** Whether stdin is not a TTY; a prompt then returns "" at once, which callers must report as such. */
export function nobodyIsTyping(): boolean {
  return process.stdin.isTTY !== true;
}

/** Read the first line of piped stdin, e.g. `echo $KEY | pinecall keys add …`. */
export async function aLineOfStdin(): Promise<string> {
  const reading = createInterface({ input: process.stdin });
  for await (const line of reading) {
    reading.close();
    return line;
  }
  return "";
}

/** The whole of piped stdin, its final newline dropped: a value of several lines, a PEM key. */
export async function allOfStdin(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
