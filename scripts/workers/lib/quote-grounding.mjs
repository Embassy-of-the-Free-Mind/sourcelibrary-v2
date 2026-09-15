/**
 * Quote grounding: match a model-proposed quote back to the page text it came from (#4837).
 *
 * PRIOR ART: these functions lived inline in scripts/workers/enrich-worker.mjs and exist nowhere
 * else in the repo (`git grep findBestMatch`). Moved here verbatim in behaviour so they can be
 * tested and bounded — the matching semantics below are deliberately unchanged.
 *
 * Why it moved: on Abulafia's Complete Writings (2,707 pages) this wedged the enrich-worker's event
 * loop at 99% CPU for an hour and killed the whole lane for five days. A quote whose stated page
 * does not match falls back to scanning EVERY page, and the scan is O(words × window × quoteWords)
 * with a slice().join() per window — order 10^11 synchronous string ops. Nothing could fire while
 * it ran: not the per-book timeout, not the other seven books' awaits, because a blocked loop
 * blocks its own timers too.
 *
 * Three bounds, none of which change what a match IS:
 *   1. A page-level prefilter that is a strict upper bound on any window's score, so a page that
 *      cannot possibly reach the 0.8 threshold is skipped without scanning it. Lossless.
 *   2. A wall-clock deadline for the whole book's grounding. Quotes past it are reported as
 *      unattempted, never silently dropped.
 *   3. Yields between pages, so timers — including the per-book timeout — can actually fire.
 */

const MIN_SCORE = 0.8;
const YIELD_EVERY_PAGES = 64;

export const NON_CONTENT_PAGE_TYPES = new Set([
  'index', 'table_of_contents', 'title_page', 'blank_page', 'colophon', 'errata',
]);

export function cleanTranslationText(text) {
  return text
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

export function cleanExtractedQuote(text) {
  return text
    .replace(/^>\s*/gm, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\*/g, '')
    .replace(/^\d{1,3}\s+/g, '')
    .replace(/\s+\d{1,3}\s*\*?\s*\*/g, '')
    .replace(/<\/?[a-z-]+\/?>/gi, '')
    .replace(/->/g, '')
    .replace(/<-/g, '')
    .replace(/^[IVX]+\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function snapToSentenceBoundaries(words, start, end) {
  const sentenceEnd = /[.!?]["'”’)]*$/;
  const maxExtend = 12;

  let newStart = start;
  let foundStart = false;
  for (let i = start - 1; i >= Math.max(0, start - maxExtend); i--) {
    if (sentenceEnd.test(words[i])) { newStart = i + 1; foundStart = true; break; }
  }
  if (!foundStart) {
    for (let i = start; i < Math.min(words.length, start + maxExtend); i++) {
      if (/^[A-Z“„"'(]/.test(words[i])) { newStart = i; break; }
    }
  }

  let newEnd = end;
  for (let i = end - 1; i < Math.min(words.length, end + maxExtend); i++) {
    if (sentenceEnd.test(words[i])) { newEnd = i + 1; break; }
  }

  return { start: newStart, end: newEnd };
}

/** The words a quote is scored on — the same filter findBestMatch applies. */
export function quoteSearchWords(quoteText) {
  return quoteText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
}

/**
 * Could ANY window of this page reach MIN_SCORE?
 *
 * findBestMatch scores a window by how many quote words appear as substrings of it, and every
 * window is a substring of the whole page's normalized text. So the page-level count is an upper
 * bound on every window's count: if the page itself misses too many words, no window can match.
 * Skipping on that is lossless, and it bails after the first disqualifying miss.
 *
 * Longest words first: they are the ones a wrong page is most likely to lack, so the common
 * "this page is irrelevant" case usually costs two or three substring searches.
 */
export function pageCouldMatch(quoteWordsLongestFirst, pageNormalizedLower) {
  const total = quoteWordsLongestFirst.length;
  if (total === 0) return false;
  const allowedMisses = total - Math.ceil(MIN_SCORE * total);
  let misses = 0;
  for (const w of quoteWordsLongestFirst) {
    if (!pageNormalizedLower.includes(w)) {
      if (++misses > allowedMisses) return false;
    }
  }
  return true;
}

/**
 * Best matching span of `sourceText` for `quoteText`, or null.
 * `prepared` optionally carries the page's pre-split words, so a page scanned for many quotes is
 * only split once.
 */
export function findBestMatch(quoteText, sourceText, prepared = null) {
  const quoteWords = quoteSearchWords(quoteText);
  if (quoteWords.length === 0) return null;

  const sourceWords = prepared?.words || sourceText.split(/\s+/);
  if (sourceWords.length === 0) return null;

  const windowSize = Math.max(quoteWords.length, 5);
  const maxWindow = Math.min(windowSize + Math.ceil(windowSize * 0.5), sourceWords.length);

  let bestScore = 0, bestStart = 0, bestEnd = 0;

  for (let start = 0; start <= sourceWords.length - windowSize; start++) {
    for (let winSize = windowSize; winSize <= maxWindow && start + winSize <= sourceWords.length; winSize++) {
      const windowText = sourceWords.slice(start, start + winSize).join(' ').toLowerCase();
      const matchCount = quoteWords.filter(w => windowText.includes(w)).length;
      const score = matchCount / quoteWords.length;
      if (score > bestScore) { bestScore = score; bestStart = start; bestEnd = start + winSize; }
    }
  }

  if (bestScore < MIN_SCORE) return null;

  const snapped = snapToSentenceBoundaries(sourceWords, bestStart, bestEnd);
  let extractedText = sourceWords.slice(snapped.start, snapped.end).join(' ');
  extractedText = cleanExtractedQuote(extractedText);

  if (extractedText.length > 60 && !/[.!?]["'”’)]*$/.test(extractedText)) {
    const lastSentenceEnd = Math.max(extractedText.lastIndexOf('.'), extractedText.lastIndexOf('!'), extractedText.lastIndexOf('?'));
    if (lastSentenceEnd > extractedText.length * 0.4) {
      extractedText = extractedText.substring(0, lastSentenceEnd + 1);
    }
  }

  if (/^[a-z]/.test(extractedText)) {
    const firstSentenceStart = extractedText.search(/[.!?]\s+[A-Z]/);
    if (firstSentenceStart > 0 && firstSentenceStart < extractedText.length * 0.4) {
      extractedText = extractedText.substring(firstSentenceStart + 2).trim();
    }
  }

  if (extractedText.length < 30) return null;

  return { score: bestScore, extractedText };
}

/** Page number → { text, page_id, words, normalizedLower }, built once per book. */
export function buildPageIndex(pages) {
  const pageIndex = new Map();
  for (const page of pages) {
    if (page.translation?.data && !NON_CONTENT_PAGE_TYPES.has(page.page_type || '')) {
      const text = cleanTranslationText(page.translation.data);
      const words = text.split(/\s+/);
      pageIndex.set(page.page_number, {
        text,
        page_id: page.id,
        words,
        normalizedLower: words.join(' ').toLowerCase(),
      });
    }
  }
  return pageIndex;
}

/**
 * Ground quotes against a book's pages.
 *
 * @param {Array} quotes
 * @param {Array|Map} pages         page docs, or a prebuilt index from buildPageIndex()
 * @param {{ deadline?: number }} opts  absolute ms timestamp after which grounding stops
 * @returns {Promise<{ grounded: Array, unattempted: number, deadlineHit: boolean }>}
 */
export async function groundQuotes(quotes, pages, { deadline = null } = {}) {
  const pageIndex = pages instanceof Map ? pages : buildPageIndex(pages);

  const grounded = [];
  let unattempted = 0;
  let deadlineHit = false;

  for (let qi = 0; qi < quotes.length; qi++) {
    const quote = quotes[qi];
    if (!quote.text || quote.text.length < 30) continue;

    if (deadline && Date.now() > deadline) {
      // Everything from here on is unexamined, and says so. An exhausted budget is a reported
      // outcome, not an empty result that reads like "no quotes matched".
      deadlineHit = true;
      unattempted = quotes.length - qi;
      break;
    }

    const specifiedPage = pageIndex.get(quote.page);
    if (specifiedPage) {
      const match = findBestMatch(quote.text, specifiedPage.text, specifiedPage);
      if (match) {
        grounded.push({ text: match.extractedText, page: quote.page, page_id: specifiedPage.page_id, context: quote.context, significance: quote.significance });
        continue;
      }
    }

    const quoteWordsLongestFirst = [...quoteSearchWords(quote.text)].sort((a, b) => b.length - a.length);

    let bestOverall = null;
    let scanned = 0;
    for (const [pageNum, pageData] of pageIndex) {
      if (pageNum === quote.page) continue;

      if (++scanned % YIELD_EVERY_PAGES === 0) {
        // Let the loop breathe: per-book timeouts, socket reads and the other books' awaits all
        // live on this thread. This is the difference between a slow book and a dead lane.
        await new Promise(resolve => setImmediate(resolve));
        if (deadline && Date.now() > deadline) {
          deadlineHit = true;
          break;
        }
      }

      if (!pageCouldMatch(quoteWordsLongestFirst, pageData.normalizedLower)) continue;

      const match = findBestMatch(quote.text, pageData.text, pageData);
      if (match && (!bestOverall || match.score > bestOverall.score)) {
        bestOverall = { score: match.score, extractedText: match.extractedText, pageNum, pageId: pageData.page_id };
      }
    }

    if (bestOverall) {
      grounded.push({ text: bestOverall.extractedText, page: bestOverall.pageNum, page_id: bestOverall.pageId, context: quote.context, significance: quote.significance });
    }

    if (deadlineHit) {
      unattempted = quotes.length - qi - 1;
      break;
    }
  }

  return { grounded, unattempted, deadlineHit };
}
