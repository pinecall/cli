// Test environments for a verb's key and gateway, passed as process env (`.env` is covered in
// env.test.ts).

/** An environment containing only that gateway and key. */
export function pointingAt(url: string, key: string): NodeJS.ProcessEnv {
  return { PINECALL_KEY: key, PINECALL_URL: url };
}

/**
 * An environment with no key. The verb then searches for a `.env`; this checkout has none since it
 * is git-ignored, and finding one would mean reading someone's real key.
 */
export function pointingNowhere(): NodeJS.ProcessEnv {
  return {};
}
