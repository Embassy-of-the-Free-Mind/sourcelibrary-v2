/**
 * Notebook autosave: every quotation that survives grounding goes into the
 * thread's research notebook, with the page it was found on.
 *
 * Why: the notebook only filled when the model chose to call add_to_notebook,
 * and it rarely did — 63 notebooks with 67 findings across 349 threads in the
 * fourteen days to 2026-10-23. Readers opened an empty notebook. The quotes
 * were already in the answer and already checked against a page; saving them
 * needs no model decision.
 *
 * Pure: takes the answer as the reader sees it (grounding edits applied) and
 * the support pages grounding read, returns findings. A quote is kept only
 * when its words appear, in order, on one of those pages — so the notebook
 * never holds a quotation grounding could not place.
 *
 * PRIOR ART: src/lib/embassy/notebook-claims.ts — strips a false "saved" claim, does not save; add_to_notebook in librarian.ts — model-driven, the gap this fills.
 */
import { blockquoteWords, foldWords, inlineQuotes, plainText, type GroundingPage } from '@/lib/embassy/grounding';

export interface AutosaveFinding {
  quote: string;
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  page: number;
}

/** Shorter quotes are phrases or titles, not findings worth keeping. */
export const AUTOSAVE_MIN_WORDS = 8;
/** At most this many findings saved from one answer. */
export const AUTOSAVE_MAX = 8;

const contains = (hay: string[], needle: string[]): boolean => {
  if (needle.length === 0 || needle.length > hay.length) return false;
  const h = ` ${hay.join(' ')} `;
  return h.includes(` ${needle.join(' ')} `);
};

/** Blockquote bodies (consecutive `>` lines joined), without the trailing citation. */
function blockquotes(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*>\s?(.*)$/);
    if (m) { cur.push(m[1]); continue; }
    if (cur.length) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) out.push(cur.join(' '));
  return out.map(b => blockquoteWords(plainText(b)).trim()).filter(Boolean);
}

export function quotedFindings(text: string, pages: GroundingPage[], already: string[] = []): AutosaveFinding[] {
  const folded = pages.map(p => ({ p, words: foldWords(p.text) }));
  const seen = new Set(already.map(q => foldWords(q).join(' ')));
  const out: AutosaveFinding[] = [];
  const outside = text.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
  const candidates = [...blockquotes(text), ...inlineQuotes(outside).map(q => plainText(q.inner).trim())];
  for (const quote of candidates) {
    if (out.length >= AUTOSAVE_MAX) break;
    const words = foldWords(quote);
    if (words.length < AUTOSAVE_MIN_WORDS) continue;
    const key = words.join(' ');
    if (seen.has(key)) continue;
    const hit = folded.find(f => contains(f.words, words));
    if (!hit) continue;
    seen.add(key);
    out.push({
      quote: quote.replace(/\s+/g, ' ').replace(/^["“«]|["”»]$/g, '').trim(),
      bookId: hit.p.bookId,
      bookSlug: hit.p.bookSlug,
      bookTitle: hit.p.bookTitle,
      page: hit.p.page,
    });
  }
  return out;
}
