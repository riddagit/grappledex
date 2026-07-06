// Deterministic mappers from BJJ Heroes' free-text columns to RollVault enums.
// Ambiguous inputs deliberately return "unknown"/null so the review queue (not a
// guess) resolves them.

const NOGI_KEYWORDS = [
  "adcc", "who's number one", "whos number one", "wno", "ebi",
  "eddie bravo invitational", "polaris", "submission underground", "sug",
  "no-gi", "nogi", "no gi", "quintet", "kinektic", "adww",
];
const GI_KEYWORDS = [
  "ibjjf", "jiu-jitsu world", "world jiu", "pans", "pan-american", "pan american",
  "european championship", "brazilian nationals", "gi ", " gi", "worlds gi",
];

export function classifyFormat(competition: string): "nogi" | "gi" | "unknown" {
  const c = competition.toLowerCase();
  if (NOGI_KEYWORDS.some((k) => c.includes(k))) return "nogi";
  if (GI_KEYWORDS.some((k) => c.includes(k))) return "gi";
  return "unknown";
}

const ROUND_LABELS: Record<string, string> = {
  f: "Final", sf: "Semifinal", qf: "Quarterfinal",
  "4f": "Quarterfinal", "8f": "Round of 16", "16f": "Round of 32",
  r1: "Round 1", r2: "Round 2",
};

export function classifyMatchType(
  stage: string | null,
): { matchType: "BRACKET" | "SUPERFIGHT"; round: string | null } {
  if (!stage) return { matchType: "BRACKET", round: null };
  const s = stage.trim().toLowerCase();
  if (s === "spf" || s.includes("superfight")) {
    return { matchType: "SUPERFIGHT", round: null };
  }
  return { matchType: "BRACKET", round: ROUND_LABELS[s] ?? null };
}

// Non-submission method keywords. Anything else that names a technique is a submission.
const NON_SUBMISSION: Array<{
  test: RegExp;
  method: "POINTS" | "DECISION" | "DQ" | "OVERTIME" | "FORFEIT" | "NC" | "DRAW";
}> = [
  { test: /^pts|points/i, method: "POINTS" },
  { test: /^adv|advantage/i, method: "POINTS" },
  { test: /decision|ref\.?\s*decision/i, method: "DECISION" },
  { test: /^dq|disqualif/i, method: "DQ" },
  { test: /overtime|^ot\b|ebi ot/i, method: "OVERTIME" },
  { test: /forfeit|w\.?o\.?|walkover/i, method: "FORFEIT" },
  { test: /^n\/?a|no contest|^nc\b/i, method: "NC" },
  { test: /draw/i, method: "DRAW" },
];

export function classifyMethod(raw: string): {
  method: "SUBMISSION" | "POINTS" | "DECISION" | "DQ" | "OVERTIME" | "FORFEIT" | "NC" | "DRAW";
  methodDetail: string | null;
} {
  const trimmed = raw.trim();
  for (const rule of NON_SUBMISSION) {
    if (rule.test.test(trimmed)) {
      // Keep detail only when it carries more than the bare category word.
      const bare = /^(pts|points|(referee\s+|ref\.?\s*)?decision|dq|ot|overtime|n\/?a|nc|draw|adv|advantages?)$/i;
      return { method: rule.method, methodDetail: bare.test(trimmed) ? null : trimmed };
    }
  }
  return { method: "SUBMISSION", methodDetail: trimmed || null };
}
