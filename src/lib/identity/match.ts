import { normalizeName } from "./normalize";

export type Candidate = { id: string; name: string; aliases: string[] };
export type ScoredCandidate = { id: string; name: string; score: number };

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

export function findDuplicateCandidates(
  input: string,
  candidates: Candidate[],
  threshold = 0.82,
): ScoredCandidate[] {
  return candidates
    .map((c) => {
      const score = Math.max(
        nameSimilarity(input, c.name),
        ...c.aliases.map((alias) => nameSimilarity(input, alias)),
      );
      return { id: c.id, name: c.name, score };
    })
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
}
