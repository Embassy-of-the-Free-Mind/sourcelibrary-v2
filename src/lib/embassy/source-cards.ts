/**
 * What the Librarian page shows AROUND an answer (v3#250): which source cards
 * lead, and which Recent rows are repeats. Pure and client-safe.
 *
 * PRIOR ART: none — src/lib/embassy/citation-pages.ts and citation-fixes.ts
 * repair the citations INSIDE an answer; nothing ordered the card row, which
 * listed every passage any search of the turn returned (22 cards for one
 * answer, seven of them editions of one book, on 2026-11-13).
 */

export interface SourceCardLike {
  bookId: string;
  bookSlug?: string;
  pageNumber?: number;
}

// `/book/<slug>`, `/book/<slug>/page-number/<n>` and `/book/<slug>?page=<n>`:
// the three forms an answer's links take.
const BOOK_REF = /\/book\/([a-z0-9][a-z0-9-]*)(?:\/page-number\/(\d+)|\?page=(\d+))?/gi;

/**
 * Split a turn's source cards into the ones the answer cites and the rest.
 *
 * `cited` holds one card per page the answer links to, in the order the answer
 * cites them, plus one card for a book the answer links to without a page we
 * hold a card for. `other` is every remaining card, without repeats of the
 * same page. A reader should see `cited`; `other` is what the search touched.
 */
export function splitSourceCards<T extends SourceCardLike>(
  sources: readonly T[],
  answerMarkdown: string,
): { cited: T[]; other: T[] } {
  const pageOrder = new Map<string, number>();
  const bookOrder = new Map<string, number>();
  let n = 0;
  for (const m of answerMarkdown.matchAll(BOOK_REF)) {
    const slug = m[1].toLowerCase();
    const page = m[2] ?? m[3];
    if (page && !pageOrder.has(`${slug}#${Number(page)}`)) pageOrder.set(`${slug}#${Number(page)}`, n);
    if (!bookOrder.has(slug)) bookOrder.set(slug, n);
    n++;
  }

  // A card answers to its slug and to its id: links are written with either.
  const names = (c: T) => [c.bookSlug, c.bookId].filter(Boolean).map(s => String(s).toLowerCase());
  const pageKey = (c: T) => `${names(c)[0] ?? ''}#${c.pageNumber ?? ''}`;

  const seen = new Set<string>();
  const unique = sources.filter(c => !seen.has(pageKey(c)) && seen.add(pageKey(c)));

  const ranked: Array<{ card: T; at: number }> = [];
  const taken = new Set<T>();
  for (const c of unique) {
    if (c.pageNumber == null) continue;
    const hits = names(c).map(s => pageOrder.get(`${s}#${c.pageNumber}`)).filter((v): v is number => v !== undefined);
    if (hits.length) { ranked.push({ card: c, at: Math.min(...hits) }); taken.add(c); }
  }
  // A book the answer links to, with no card for the cited page: its first card.
  const booksWithCard = new Set(ranked.flatMap(r => names(r.card)));
  for (const c of unique) {
    if (taken.has(c)) continue;
    const hits = names(c).map(s => bookOrder.get(s)).filter((v): v is number => v !== undefined);
    if (hits.length && !names(c).some(s => booksWithCard.has(s))) {
      ranked.push({ card: c, at: Math.min(...hits) });
      taken.add(c);
      names(c).forEach(s => booksWithCard.add(s));
    }
  }

  return {
    cited: ranked.sort((a, b) => a.at - b.at).map(r => r.card),
    other: unique.filter(c => !taken.has(c)),
  };
}

/**
 * Drop later rows that ask the same question as an earlier one. The list is
 * newest first, so the newest asking stays. Rows with no question are kept.
 */
export function collapseRepeatedQuestions<T extends { preview: { question: string } }>(threads: readonly T[]): T[] {
  const seen = new Set<string>();
  return threads.filter(t => {
    const key = t.preview.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
