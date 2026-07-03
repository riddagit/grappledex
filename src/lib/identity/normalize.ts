// Latin letters that do NOT decompose under NFD, so diacritic-stripping alone
// leaves them intact and they'd be dropped by the a-z filter. Map to ASCII.
const TRANSLITERATIONS: Record<string, string> = {
  ł: "l", đ: "d", ø: "o", ħ: "h", ß: "ss",
  æ: "ae", œ: "oe", ð: "d", þ: "th", ı: "i",
};

export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[łđøħßæœðþı]/g, (c) => TRANSLITERATIONS[c] ?? c) // non-decomposing latin
    .replace(/[^a-z0-9\s]/g, " ")    // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(raw: string): string {
  return normalizeName(raw).replace(/\s/g, "-");
}
