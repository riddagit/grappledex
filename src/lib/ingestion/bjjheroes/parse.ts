import { JSDOM } from "jsdom";

export type BjjHeroesRecord = {
  bjjHeroesId: string;
  opponentName: string;
  outcome: "WON" | "LOST" | "DRAW";
  methodRaw: string;
  competition: string;
  weightLabel: string | null;
  stage: string | null;
  year: number;
};
export type BjjHeroesProfile = {
  slug: string;
  fullName: string;
  formalName: string | null;
  nickname: string | null;
  teamName: string | null;
  weightLabel: string | null;
  records: BjjHeroesRecord[];
};

function slugFromUrl(url: string): string {
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Bio lines are `<p><strong>Label:</strong> value</p>`. Find the <strong> whose
// text starts with the label and return the trailing text of its parent <p>.
function bioValue(doc: Document, label: string): string | null {
  const strongs = Array.from(doc.querySelectorAll("p strong"));
  for (const s of strongs) {
    if ((s.textContent ?? "").trim().toLowerCase().startsWith(label.toLowerCase())) {
      const parentText = (s.parentElement?.textContent ?? "").trim();
      const value = parentText.slice((s.textContent ?? "").length).trim();
      return value.length ? value : null;
    }
  }
  return null;
}

function outcomeFrom(cell: string): "WON" | "LOST" | "DRAW" {
  const v = cell.trim().toUpperCase();
  if (v.startsWith("W")) return "WON";
  if (v.startsWith("D")) return "DRAW";
  return "LOST";
}

// The opponent cell is `<td class='sort'><span>Name</span><a>Name</a></td>`, so
// textContent doubles the name. Prefer the anchor's text, which is the single
// clean display name.
function opponentFrom(cell: Element | undefined): string {
  if (!cell) return "";
  const anchor = cell.querySelector("a");
  return ((anchor?.textContent ?? cell.textContent) ?? "").trim();
}

export function parseProfile(html: string, url: string): BjjHeroesProfile {
  const doc = new JSDOM(html).window.document;

  const fullName = (doc.querySelector('h1[itemprop="name"]')?.textContent ?? "").trim();

  const records: BjjHeroesRecord[] = [];
  for (const tr of Array.from(doc.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll("td"));
    if (cells.length !== 8) continue;
    const id = (cells[0]?.textContent ?? "").trim();
    if (!/^\d+$/.test(id)) continue; // skip header / non-record rows
    const yearNum = Number((cells[7]?.textContent ?? "").trim());
    if (!Number.isFinite(yearNum)) continue;
    records.push({
      bjjHeroesId: id,
      opponentName: opponentFrom(cells[1]),
      outcome: outcomeFrom(cells[2]?.textContent ?? ""),
      methodRaw: (cells[3]?.textContent ?? "").trim(),
      competition: (cells[4]?.textContent ?? "").trim(),
      weightLabel: ((cells[5]?.textContent ?? "").trim()) || null,
      stage: ((cells[6]?.textContent ?? "").trim()) || null,
      year: yearNum,
    });
  }

  return {
    slug: slugFromUrl(url),
    fullName,
    formalName: bioValue(doc, "Full Name:"),
    nickname: bioValue(doc, "Nickname:"),
    teamName: bioValue(doc, "Team/Association:"),
    weightLabel: bioValue(doc, "Weight Division:"),
    records,
  };
}
