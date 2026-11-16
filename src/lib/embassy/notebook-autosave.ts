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
 * It reads a page the way grounding does (v3#249): the stored text with its
 * markup read three ways (pageReadings), and an elided quotation one run of
 * words at a time, in order, all on the same page. Matching the whole
 * quotation against the raw stored text saved nothing for a thread whose
 * answer held three quotations grounding had kept: two had an ellipsis, and
 * the page text carries tags. (6af70498c205a9be6ed8c6bb, 2026-11-13.)
 *
 * PRIOR ART: src/lib/embassy/notebook-claims.ts — strips a false "saved" claim, does not save; add_to_notebook in librarian.ts — model-driven, the gap this fills.
 */
import { blockquoteWords, foldWords, inlineQuotes, pageReadings, plainText, quoteFragments, type GroundingPage } from '@/lib/embassy/grounding';

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

/** Every fragment of the quotation, in order, in ONE reading of the page (` w1 w2 … `). */
const holds = (reading: string, fragments: string[][]): boolean => {
  let from = 0;
  for (const f of fragments) {
    const at = reading.indexOf(` ${f.join(' ')} `, from);
    if (at === -1) return false;
    from = at + f.join(' ').length + 1;
  }
  return true;
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
  const folded = pages.map(p => ({ p, readings: pageReadings(p.text).map(r => ` ${foldWords(r).join(' ')} `) }));
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
    const fragments = quoteFragments(quote);
    if (fragments.length === 0) continue;
    const hit = folded.find(f => f.readings.some(r => holds(r, fragments)));
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
