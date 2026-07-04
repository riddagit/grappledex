// Turn raw user text into a safe prefix tsquery: lowercase, split on anything that is not a
// latin letter or digit, drop empties, append :* to each token, AND them together. User
// input never reaches to_tsquery except as [a-z0-9]+:* tokens.
export function toPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}
