/** No secret crosses a model: every answer and every refusal of the MCP server passes here first. */

// A Pinecall key, a server's token or a console's one-use login code, wherever it appears.
const SHAPED = /\b(?:pc_(?:live|test)_|pk_|lc_)[A-Za-z0-9_-]{6,}/g;

export const HIDDEN = "***";

/** The text with every secret it knows of, and every one shaped like a Pinecall key, hidden. */
export function scrubbed(text: string, secrets: readonly string[] = []): string {
  let clean = text;
  for (const secret of secrets) if (secret.length >= 6) clean = clean.replaceAll(secret, HIDDEN);
  return clean.replace(SHAPED, HIDDEN);
}
