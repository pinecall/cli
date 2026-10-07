// Capture a verb's output stream and stderr for assertions.

/** A stream a test can pass to a verb and read back. */
export function written(): { stream: NodeJS.WritableStream; text(): string } {
  const chunks: string[] = [];
  const stream = { write: (chunk: string) => chunks.push(chunk) } as unknown as NodeJS.WritableStream;
  return { stream, text: () => chunks.join("") };
}

/** Captured stderr, so refusals are read instead of printed mid-run. */
export function onStderr(): { text(): string; restore(): void } {
  const kept: string[] = [];
  const before = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => {
    kept.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  return { text: () => kept.join(""), restore: () => (process.stderr.write = before) };
}
