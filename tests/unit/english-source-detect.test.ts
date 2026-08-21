/**
 * english-source-detect: four ways a foreign book reads as English. (#3524, #3459)
 *
 * A first-translation CANDIDATE is any non-English book with no prior found. The
 * cheapest way for that default to be flatly wrong is for the pages to be English
 * already — so this detector is a load-bearing guard, and its errors are
 * asymmetric: a false `english_source` silently DROPS a genuine candidate and
 * nothing downstream revisits it, while a false `foreign_source` merely leaves a
 * candidate to be caught later.
 *
 * Every fixture below is a REAL false positive observed against production on
 * 2026-08-01, reduced to the smallest text that reproduces it. These are
 * behavioural tests: each one fails if the corresponding guard is removed from
 * `english-source-detect.mjs` — verified by deleting each guard and watching the
 * matching case go red. (CLAUDE.md: "a test that greps source is not a guard" —
 * before writing one, ask what code change would make it fail.)
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import {
  classifySourceLanguage,
  englishFraction,
  textWords,
  ENGLISH_SOURCE_THRESHOLD,
  MIN_PAGES_FOR_FREQUENCY_ENGLISH,
  samplePagesForLanguage,
} from '../../scripts/lib/english-source-detect.mjs';

/** A page of real Latin body text — the control for "genuinely foreign". */
const LATIN_PAGE = `<language>Latin</language>
Quod si quis vero animo perpenderit quantum in rebus humanis valeat
consuetudo, atque quam multa non ratione sed usu comprobata sint, is
profecto intelliget quam difficile sit veterem opinionem evellere.`;

/** A page of ordinary English body text. */
const ENGLISH_PAGE = `<language>English</language>
But if any one shall weigh in his mind how much custom avails in human
affairs, and how many things are approved not by reason but by use, he
will surely understand how hard it is to root out an old opinion.`;

describe('the four false-positive modes', () => {
  it('1. an English glossary at the back does not make an Arabic book English', () => {
    // Nicholson's *Kitab al-Luma*: Arabic text, English-Arabic glossary at the
    // back. The old sampler took 8 CONSECUTIVE pages and landed in the glossary.
    // The detector's job here is only to let the body outvote the apparatus when
    // it is given a spread sample — so the fixture is what a spread sample sees.
    const glossaryPage = `<language>English</language>
      English index 146 with to implore the help of God of mystical language
      depth profundity absence used in a mystical sense`;
    const spread = [LATIN_PAGE, LATIN_PAGE, LATIN_PAGE, LATIN_PAGE,
      LATIN_PAGE, LATIN_PAGE, LATIN_PAGE, LATIN_PAGE, glossaryPage];
    expect(classifySourceLanguage(spread).verdict).toBe('foreign_source');
  });

  it('2. scanner boilerplate is English on every book and must not vote', () => {
    // The Zohrab Armenian NT screened english_source on three consecutive pages
    // of the Google Books notice. The sweep filters these before classifying;
    // this pins that the text itself is unmistakably English-scoring, i.e. that
    // the filter is doing real work rather than being decorative.
    const boilerplate = `This is a digital copy of a book that was preserved for
      generations on library shelves before it was carefully scanned by Google as
      part of a project to make the world's books discoverable online.`;
    const frac = englishFraction(boilerplate);
    expect(frac).not.toBeNull();
    expect(frac!).toBeGreaterThan(ENGLISH_SOURCE_THRESHOLD);
  });

  it('3. an English ARTIFACT DESCRIPTION does not make an Akkadian tablet English', () => {
    // The epigraphy schema — <condition>, <period>, <surface>, <genre> — is a
    // second wrapper family that `stripEditorialWrappers` does not know. The
    // <condition> block is a paragraph of English prose about the object.
    const tabletPage = `<surface>full-view</surface>
      <script>Neo-Assyrian</script>
      <language>Akkadian</language>
      <period>ca. 668-631 BC (Library of Ashurbanipal)</period>
      <condition>The image shows multiple fragments (K.2421, K.2511, K.16765) from
      the British Museum collection, joined to form a substantial portion of a
      tablet. The surface is worn and chipped in places, but the script is a fine,
      late Neo-Assyrian hand characteristic of the royal library at Nineveh.</condition>
      <genre>literary</genre>
      <transliteration>a-sar-ri ba-ni i-ne-mi sa-a-ti</transliteration>`;

    // The wrapper prose must not survive tokenisation...
    const words = textWords(tabletPage);
    expect(words).not.toContain('british');
    expect(words).not.toContain('museum');
    expect(words).not.toContain('fragments');

    // ...and the book must not be classified from it.
    expect(classifySourceLanguage([tabletPage]).verdict).toBe('foreign_source');
  });

  it('4. a lone declaration is used, so a one-page record is judged on evidence', () => {
    // The old floor of two declarations meant a single-page record — a tablet, a
    // papyrus, a manuscript leaf — could never use its own declared language and
    // fell through to frequency, which then read the English description.
    const onePage = `<language>Akkadian</language>
      <condition>A fragmentary tablet from the British Museum, worn at the edges
      and chipped along the lower left, with a fine late hand throughout.</condition>`;
    const v = classifySourceLanguage([onePage]);
    expect(v.verdict).toBe('foreign_source');
    expect(v.basis).toBe('declared_language');
  });
});

describe('the asymmetry is enforced, not just intended', () => {
  it('frequency alone cannot return english_source below the page floor', () => {
    const thin = Array.from({ length: MIN_PAGES_FOR_FREQUENCY_ENGLISH - 1 },
      () => ENGLISH_PAGE.replace('<language>English</language>', ''));
    const v = classifySourceLanguage(thin);
    expect(v.verdict).toBe('undetermined');
    expect(v.basis).toBe('insufficient_pages_for_frequency');
  });

  it('but frequency alone CAN return foreign_source on a single page', () => {
    // The cheap direction stays cheap: no corroboration required to keep a book
    // in the candidate pool.
    const v = classifySourceLanguage([LATIN_PAGE.replace('<language>Latin</language>', '')]);
    expect(v.verdict).toBe('foreign_source');
  });

  it('above the floor, frequency still catches a genuinely English source', () => {
    const enough = Array.from({ length: MIN_PAGES_FOR_FREQUENCY_ENGLISH },
      () => ENGLISH_PAGE.replace('<language>English</language>', ''));
    expect(classifySourceLanguage(enough).verdict).toBe('english_source');
  });
});

describe('the controls still hold', () => {
  it('a declared English source is still caught (Ganguli, Avalon)', () => {
    expect(classifySourceLanguage([ENGLISH_PAGE, ENGLISH_PAGE]).verdict).toBe('english_source');
  });

  it('a declared foreign source is kept as a candidate', () => {
    expect(classifySourceLanguage([LATIN_PAGE, LATIN_PAGE]).verdict).toBe('foreign_source');
  });

  it('no judgeable text is undetermined — never a verdict', () => {
    expect(classifySourceLanguage([]).verdict).toBe('undetermined');
    expect(classifySourceLanguage(['   ', '']).verdict).toBe('undetermined');
  });
});

/**
 * The SAMPLER — the code that lived in two places and was wrong in both.
 *
 * A fake `pages` collection, because the three hazards are all about WHICH pages
 * get chosen, which is exactly what a mock can pin and a real database cannot
 * pin cheaply.
 */
function fakePages(docs: Array<{ page_number: number; ocr?: { data: string } }>) {
  return {
    find(filter: any, opts: any = {}) {
      let rows = docs.filter((d) => {
        // NOTE: this mock honours `$gt` only if the caller passes it. That is
      // deliberate — it is what lets the soft-hidden-page test actually fail when
      // the filter is removed from the implementation.
      if (filter.page_number?.$gt !== undefined && !(d.page_number > filter.page_number.$gt)) return false;
        if (filter.page_number?.$in && !filter.page_number.$in.includes(d.page_number)) return false;
        if (filter['ocr.data']?.$exists && !d.ocr?.data) return false;
        return true;
      });
      if (opts.sort?.page_number === 1) rows = [...rows].sort((a, b) => a.page_number - b.page_number);
      return { toArray: async () => rows };
    },
  };
}

describe('samplePagesForLanguage — the three sampling hazards', () => {
  it('never samples a soft-hidden (negative) page number', async () => {
    // The Zohrab Armenian NT: 400 soft-hidden scan-boilerplate pages numbered
    // negatively, then the real book. Sorting ascending and skipping 30% of the
    // page COUNT lands entirely inside the hidden range.
    const docs = [
      ...Array.from({ length: 400 }, (_, i) => ({ page_number: -1400 + i, ocr: { data: 'hidden english boilerplate page' } })),
      ...Array.from({ length: 200 }, (_, i) => ({ page_number: i + 1, ocr: { data: 'ARMENIAN BODY TEXT' } })),
    ];
    const { texts } = await samplePagesForLanguage(fakePages(docs) as any, 'b1');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t: string) => t === 'ARMENIAN BODY TEXT')).toBe(true);
  });

  it('spreads across the MIDDLE, so neither front nor back matter speaks for the book', async () => {
    // Nicholson's *Kitab al-Luma*: an English preface, the Arabic body, an
    // English glossary at the back.
    //
    // ⚠️ The fixture MUST have English at BOTH ends. An earlier version had only
    // the back-matter glossary, and it passed with a deliberately broken
    // front-sampling implementation — because the front of that fixture was the
    // body, so sampling from page 1 got the right answer by accident. A fixture
    // whose wrong strategy still scores correctly tests nothing.
    const docs = [
      ...Array.from({ length: 30 }, (_, i) => ({ page_number: i + 1, ocr: { data: 'ENGLISH_PREFACE' } })),
      ...Array.from({ length: 140 }, (_, i) => ({ page_number: 31 + i, ocr: { data: 'ARABIC' } })),
      ...Array.from({ length: 30 }, (_, i) => ({ page_number: 171 + i, ocr: { data: 'ENGLISH_GLOSSARY' } })),
    ];
    const { texts } = await samplePagesForLanguage(fakePages(docs) as any, 'b2');
    const arabic = texts.filter((t: string) => t === 'ARABIC').length;
    const english = texts.filter((t: string) => t !== 'ARABIC').length;
    expect(arabic).toBeGreaterThan(english);
    // And specifically: neither end may dominate the sample.
    expect(texts.filter((t: string) => t === 'ENGLISH_PREFACE').length).toBeLessThan(arabic);
    expect(texts.filter((t: string) => t === 'ENGLISH_GLOSSARY').length).toBeLessThan(arabic);
  });

  it('offsets over the OCRd pages, not over pages_count', async () => {
    // Sparse OCR: 1,000 pages exist, 10 are OCR'd. An offset over `pages_count`
    // skips past every one of them and returns nothing.
    const docs = Array.from({ length: 10 }, (_, i) => ({ page_number: i * 100 + 1, ocr: { data: 'LATIN' } }));
    const { texts, available } = await samplePagesForLanguage(fakePages(docs) as any, 'b3');
    expect(available).toBe(10);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('reports zero available when nothing is OCRd — never an empty verdict', async () => {
    const { texts, available } = await samplePagesForLanguage(fakePages([]) as any, 'b4');
    expect(available).toBe(0);
    expect(texts).toEqual([]);
  });
});
