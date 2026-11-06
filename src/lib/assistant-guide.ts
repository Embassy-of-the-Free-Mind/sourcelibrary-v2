/**
 * One plain line on the pages an assistant lands on, saying where the text is (#8161).
 *
 * Why: told to use sourcelibrary.org, Claude went from the homepage to a collection to a
 * book's landing page, then reported it could read only summaries, on at least 7 of 10
 * questions. No run read /llms.txt, and neither of those pages named it or /search/text
 * (scripts/eval/experiments/2026-11-05-citation-benchmark-baseline-8161.md).
 *
 * It states facts and gives no orders, because a page that instructs a model looks like a
 * prompt injection and a careful model will rightly ignore it. Rendered `sr-only`, like the
 * citation line on reader pages. Main site only: a reading room must not link to the
 * whole-library search (.claude/docs/invariants/tenant-lockdown.md).
 *
 * PRIOR ART: public/llms.txt says all this at length, and nothing links to it from these
 * pages. `citation` in reader (page.tsx) is the same device for one page's citation.
 */
const BASE = 'https://sourcelibrary.org';
const LEAD = 'For assistants and other text readers:';
const HOW_TO = `How to use this site: ${BASE}/llms.txt`;

export function homeAssistantGuide(): string {
  return `${LEAD} search the library at ${BASE}/search/text?q=YOUR+WORDS. Each result links to a page with its text, its scan and a citation. ${HOW_TO}`;
}

/** `null` when the book has no pages, because /read is a 404 until it does. */
export function bookAssistantGuide(book: { id?: string; slug?: string; pages_count?: number }, fallbackId: string): string | null {
  if (!book.pages_count) return null;
  const id = book.id ?? fallbackId;
  const read = `${BASE}/book/${book.slug || id}/read`;
  const api = `${BASE}/api/books/${id}`;
  return `${LEAD} this page describes the book, and the text is elsewhere. The whole book as one document: ${read}. Find a passage in it: ${api}/search?q=YOUR+WORDS. The text and citation of one page: ${api}/quote?page=N. ${HOW_TO}`;
}
