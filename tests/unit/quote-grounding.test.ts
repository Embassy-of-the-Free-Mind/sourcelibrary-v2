import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs worker helper, no types
import { groundQuotes, findBestMatch, pageCouldMatch, quoteSearchWords, buildPageIndex } from '../../scripts/workers/lib/quote-grounding.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { declinedRegion } from '../../scripts/lib/declined-region.mjs';

/**
 * groundQuotes() wedged the enrich-worker's event loop at 99% CPU on a 2,707-page book and killed
 * the whole enrichment lane for five days (#4837). The bounds added here must not change what
 * counts as a match — these tests pin both halves: still finds the quote, no longer unbounded.
 */

const LOREM = 'the philosopher observes that the celestial spheres revolve in perfect harmony while the sublunary world decays';

function page(pageNumber: number, text: string) {
  return { id: `p${pageNumber}`, page_number: pageNumber, page_type: 'text', translation: { data: text } };
}

function filler(n: number) {
  return `page ${n} contains unrelated matter about agriculture husbandry and the tilling of fields in autumn seasons`;
}

describe('pageCouldMatch — the prefilter must be lossless', () => {
  it('never rejects a page that findBestMatch would actually match', () => {
    const quote = LOREM;
    const words = [...quoteSearchWords(quote)].sort((a: string, b: string) => b.length - a.length);
    const sourceText = `preamble words here ${LOREM} and then some trailing matter`;
    const normalized = sourceText.split(/\s+/).join(' ').toLowerCase();

    expect(findBestMatch(quote, sourceText)).not.toBeNull();
    expect(pageCouldMatch(words, normalized)).toBe(true);
  });

  it('rejects a page that cannot reach the 0.8 threshold', () => {
    const words = [...quoteSearchWords(LOREM)].sort((a: string, b: string) => b.length - a.length);
    const unrelated = filler(1).split(/\s+/).join(' ').toLowerCase();

    expect(pageCouldMatch(words, unrelated)).toBe(false);
    expect(findBestMatch(LOREM, filler(1))).toBeNull();
  });
});

describe('groundQuotes', () => {
  it('still finds a quote on a page other than the one the model claimed', async () => {
    const pages = Array.from({ length: 60 }, (_, i) => page(i + 1, i + 1 === 50 ? `${LOREM} and more text follows here.` : filler(i + 1)));
    const quotes = [{ text: LOREM, page: 3, context: 'ctx', significance: 'sig' }];

    const { grounded, unattempted } = await groundQuotes(quotes, pages);

    expect(unattempted).toBe(0);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].page).toBe(50);
    expect(grounded[0].page_id).toBe('p50');
  });

  it('prefers the claimed page when it matches, without scanning the book', async () => {
    const pages = [page(7, `${LOREM} and more text follows here.`), page(8, `${LOREM} duplicated elsewhere too.`)];
    const quotes = [{ text: LOREM, page: 7 }];

    const { grounded } = await groundQuotes(quotes, pages);

    expect(grounded[0].page).toBe(7);
  });

  it('skips non-content pages (index, title page…) as before', async () => {
    const pages = [{ id: 'pi', page_number: 4, page_type: 'index', translation: { data: `${LOREM} listed in the index.` } }];
    const quotes = [{ text: LOREM, page: 4 }];

    const { grounded } = await groundQuotes(quotes, pages);

    expect(grounded).toHaveLength(0);
  });

  it('reports what the budget did not reach instead of returning a quietly short list', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => page(i + 1, filler(i + 1)));
    const quotes = [
      { text: LOREM, page: 1 },
      { text: LOREM, page: 2 },
    ];

    const { grounded, unattempted, deadlineHit } = await groundQuotes(quotes, pages, { deadline: Date.now() - 1 });

    expect(grounded).toHaveLength(0);
    expect(deadlineHit).toBe(true);
    expect(unattempted).toBe(2);
  });

  it('grounds against a large book in seconds — the Abulafia shape (#4837)', async () => {
    // 1,500 pages, a quote that does not match its stated page: the exact fallback that used to
    // scan every page with an O(words × window × quoteWords) slice-and-join per window.
    const pages = Array.from({ length: 1500 }, (_, i) => page(i + 1, i + 1 === 1400 ? `${LOREM} and more text follows here.` : filler(i + 1)));
    const quotes = Array.from({ length: 20 }, () => ({ text: LOREM, page: 2 }));

    const started = Date.now();
    const { grounded, unattempted } = await groundQuotes(quotes, pages, { deadline: Date.now() + 20_000 });
    const elapsed = Date.now() - started;

    expect(grounded).toHaveLength(20);
    expect(unattempted).toBe(0);
    expect(elapsed).toBeLessThan(15_000);
  });

  it('yields, so a timer can fire while grounding runs', async () => {
    const pages = Array.from({ length: 400 }, (_, i) => page(i + 1, filler(i + 1)));
    const quotes = [{ text: LOREM, page: 1 }];

    // A queued macrotask, not a 1 ms timer: on a fast runner the whole run can
    // finish inside a millisecond and the timer never gets its turn, which made
    // this test fail about 3 runs in 4 (#5747). The callback below runs only if
    // groundQuotes hands the loop back at least once before it resolves.
    let timerFired = false;
    const timer = setImmediate(() => { timerFired = true; });

    await groundQuotes(quotes, buildPageIndex(pages));
    clearImmediate(timer);

    // The old synchronous version blocked the loop, so the timer could not run until it finished —
    // which is why the per-book timeout and seven other books' awaits all froze behind one book.
    expect(timerFired).toBe(true);
  });
});

describe('a page whose OCR declined a region is never a featured quote (#4584)', () => {
  // Urkunden IV p.24: the OCR read the German prose and declined the glyphs; the translation rendered
  // the twenty unread lines as English, and line x+3 became a featured quote of the volume.
  const URK_OCR = 'Nur die letzten Zeilen sind erhalten\nx+1\n[Hieroglyphic text lines x+1 through 20]';
  const INVENTED = 'x+3. ...I was one who spoke the truth before the Lord of the Two Lands, and my name shall endure upon this stone.';

  it('does not ground a quote on the declined page, even when it matches its stated page', async () => {
    const pages = [{ id: 'p24', page_number: 24, page_type: 'text', ocr: { data: URK_OCR }, translation: { data: `Only the last lines are preserved. ${INVENTED}` } }];
    const { grounded } = await groundQuotes([{ text: INVENTED, page: 24 }], pages);
    expect(grounded).toHaveLength(0);
  });

  it('still grounds against the book\'s other pages', async () => {
    const pages = [
      { id: 'p24', page_number: 24, page_type: 'text', ocr: { data: URK_OCR }, translation: { data: `${LOREM} on the declined page.` } },
      { id: 'p25', page_number: 25, page_type: 'text', ocr: { data: 'Der Philosoph bemerkt …' }, translation: { data: `${LOREM} and more text follows here.` } },
    ];
    const { grounded } = await groundQuotes([{ text: LOREM, page: 24 }], pages);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].page).toBe(25);
  });

  // Each string is a real OCR bracket from the 2026-10-11 measurement over reading_summary.quotes.
  it.each([
    '[Hieroglyphic text lines 1-14]',
    '[Hieratic text, approximately 15 lines]',
    '[Cuneiform inscription arranged in vertical columns]',
    '[Column 2: Dense Hieratic text]',
    '[<unclear>hieroglyphic text</unclear>]',
    'Regest. <lacuna>three lines of glyphs</lacuna> Ende.',
  ])('declined: %s', (ocr) => expect(declinedRegion(ocr)).toBe(true));

  it.each([
    'Quod ait [illegible] philosophus de caelo.',
    '[The rest of the page contains faint bleed-through text from the reverse side, which is not transcribed]',
    '[The remainder of the page contains significant show-through and faint, untranscribed text]',
    'In principio erat verbum [sic].',
    '',
  ])('not declined: %s', (ocr) => expect(declinedRegion(ocr)).toBe(false));
});
